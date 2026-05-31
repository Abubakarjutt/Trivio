import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { autoDetectColumns, parseCsvBuffer, detectDuplicates } from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import { extractTextFromPdf, parseTransactionsFromText } from "@/server/services/pdf-statement.service";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";

// Allow up to 3 minutes for Gemini inference (PDF/image extraction can be slow)
export const maxDuration = 180;

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { organisationId: true },
  });
  if (!user?.organisationId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }
  const organisationId = user.organisationId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const file = fileField as File;

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large (max 20 MB)` }, { status: 422 });
  }

  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv") || file.type === "text/csv";
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  const isImage = IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) || IMAGE_MIME_TYPES.includes(file.type);

  if (!isCsv && !isPdf && !isImage) {
    return NextResponse.json({ error: "Only PDF, CSV, and image files are supported" }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isCsv) return handleCsvImport(buffer, file.name, organisationId);
  if (isPdf)  return handlePdfImport(buffer, file.name, organisationId);
  return handleImageImport(buffer, file.name, file.type || "image/jpeg", organisationId);
}

async function handleCsvImport(buffer: Buffer, filename: string, organisationId: string) {
  const text = buffer.toString("utf-8");
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  let columnMap;
  try {
    columnMap = autoDetectColumns(headers);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const rawTransactions = parseCsvBuffer(buffer, columnMap);
  if (rawTransactions.length === 0) {
    return NextResponse.json({ error: "No transactions found in CSV" }, { status: 400 });
  }

  const categorized = await categorizeBatch(rawTransactions.map((t) => t.description));

  const existingRaw = await db.statementTransaction.findMany({
    where: { organisationId },
    select: { id: true, date: true, description: true, amount: true },
  });
  const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
  const { duplicates } = detectDuplicates(rawTransactions, existing);

  const batch = await db.statementImportBatch.create({
    data: { organisationId, filename, fileType: "CSV", status: "PENDING", transactionCount: rawTransactions.length },
  });

  await db.statementTransaction.createMany({
    data: rawTransactions.map((txn, i) => ({
      organisationId,
      importBatchId: batch.id,
      date: new Date(txn.date),
      description: txn.description,
      merchantName: categorized[i]?.merchantName ?? txn.description,
      amount: txn.amount,
      type: txn.type,
      category: categorized[i]?.category ?? "Other",
      mccCode: categorized[i]?.mccCode ?? "0000",
      mccLabel: categorized[i]?.mccLabel ?? "Uncategorized",
    })),
  });

  if (duplicates.length > 0) {
    const dupDescs = duplicates.map((d) => d.incoming.description);
    const savedDupes = await db.statementTransaction.findMany({
      where: { importBatchId: batch.id, description: { in: dupDescs } },
      select: { id: true, date: true, description: true, amount: true },
    });
    return NextResponse.json({
      status: "duplicates",
      batchId: batch.id,
      duplicates: savedDupes.map((d) => ({ id: d.id, date: d.date, amount: Number(d.amount), description: d.description })),
    });
  }

  await db.statementImportBatch.update({ where: { id: batch.id }, data: { status: "DONE" } });
  return NextResponse.json({ status: "done", batchId: batch.id, count: rawTransactions.length, skipped: 0 });
}

// Internal type for the shared streaming import helper
type EmitFn = (event: string, data: Record<string, unknown>) => void;

// Shared SSE helper used by both PDF and image handlers
function createSseStream(
  handler: (emit: EmitFn) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit: EmitFn = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await handler(emit);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

/**
 * Shared logic for PDF and image SSE imports: categorize → dedup → save → emit.
 * The caller provides the already-parsed raw transactions and the emit function.
 */
async function runStreamingImport(
  emit: EmitFn,
  rawTransactions: import("@/server/services/statement-parser.service").RawTransaction[],
  organisationId: string,
  batchId: string,
) {
  emit("progress", { step: "categorizing", pct: 50, count: rawTransactions.length });
  const categorized = await categorizeBatch(rawTransactions.map((t) => t.description));

  emit("progress", { step: "deduplicating", pct: 75 });
  const existingRaw = await db.statementTransaction.findMany({
    where: { organisationId },
    select: { id: true, date: true, description: true, amount: true },
  });
  const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
  const { duplicates } = detectDuplicates(rawTransactions, existing);

  emit("progress", { step: "saving", pct: 90 });
  await db.statementTransaction.createMany({
    data: rawTransactions.map((txn, i) => ({
      organisationId,
      importBatchId: batchId,
      date: new Date(txn.date),
      description: txn.description,
      merchantName: categorized[i]?.merchantName ?? txn.description,
      amount: txn.amount,
      type: txn.type,
      category: categorized[i]?.category ?? "Other",
      mccCode: categorized[i]?.mccCode ?? "0000",
      mccLabel: categorized[i]?.mccLabel ?? "Uncategorized",
    })),
  });

  await db.statementImportBatch.update({ where: { id: batchId }, data: { transactionCount: rawTransactions.length } });

  if (duplicates.length > 0) {
    const dupDescs = duplicates.map((d) => d.incoming.description);
    const savedDupes = await db.statementTransaction.findMany({
      where: { importBatchId: batchId, description: { in: dupDescs } },
      select: { id: true, date: true, description: true, amount: true },
    });
    emit("duplicates", {
      count: savedDupes.length,
      items: savedDupes.map((d) => ({ id: d.id, date: d.date, amount: Number(d.amount), description: d.description })),
      batchId,
    });
    return;
  }

  await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
  emit("done", { batchId, count: rawTransactions.length, skipped: 0 });
}

async function handlePdfImport(buffer: Buffer, filename: string, organisationId: string) {
  return createSseStream(async (emit) => {
    let batchId: string | undefined;
    try {
      const batch = await db.statementImportBatch.create({
        data: { organisationId, filename, fileType: "PDF", status: "PROCESSING", transactionCount: 0 },
      });
      batchId = batch.id;

      emit("progress", { step: "extracting", pct: 10 });
      const text = await extractTextFromPdf(buffer);

      emit("progress", { step: "parsing", pct: 30 });
      const rawTransactions = await parseTransactionsFromText(text);

      if (rawTransactions.length === 0) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: "No transactions found" } });
        emit("error", { message: "No transactions found in PDF. The format may not be supported." });
        return;
      }

      await runStreamingImport(emit, rawTransactions, organisationId, batchId);
    } catch (err) {
      if (batchId) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: String(err) } }).catch(() => {});
      }
      emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
    }
  });
}

async function handleImageImport(buffer: Buffer, filename: string, mimeType: string, organisationId: string) {
  return createSseStream(async (emit) => {
    let batchId: string | undefined;
    try {
      const batch = await db.statementImportBatch.create({
        data: { organisationId, filename, fileType: "IMAGE", status: "PROCESSING", transactionCount: 0 },
      });
      batchId = batch.id;

      emit("progress", { step: "parsing", pct: 20 });
      const rawTransactions = await parseTransactionsFromImage(buffer, mimeType);

      if (rawTransactions.length === 0) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: "No transactions found" } });
        emit("error", { message: "No transactions found in image. Ensure the statement is clearly visible and try again." });
        return;
      }

      await runStreamingImport(emit, rawTransactions, organisationId, batchId);
    } catch (err) {
      if (batchId) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: String(err) } }).catch(() => {});
      }
      emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
    }
  });
}
