import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { autoDetectColumns, parseCsvBuffer, detectDuplicates, deduplicateIncoming } from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import { extractPdfPages, parsePageTransactions } from "@/server/services/pdf-statement.service";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";
import { createRateLimiter } from "@/server/middleware/rateLimit";

// Allow up to 5 minutes — per-page Gemini calls on long PDFs can add up
export const maxDuration = 300;

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

// 5 imports per minute per user — protects against AI cost amplification attacks
const importRateLimiter = createRateLimiter(5, 60_000);

// Magic byte signatures for accepted file types
function validateFileMagicBytes(buf: Buffer, declaredType: "pdf" | "image" | "csv"): boolean {
  if (buf.length < 4) return false;
  if (declaredType === "csv") return true; // CSV is plain text; no magic bytes to check
  if (declaredType === "pdf") {
    return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
  }
  // Image: JPEG, PNG, WebP (HEIC/HEIF have varied signatures — allow if first bytes match any known image format)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
                 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  // HEIC/HEIF: ftyp box at offset 4 containing 'heic', 'heix', 'mif1', or 'msf1'
  const isHeic = buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  return isJpeg || isPng || isWebp || isHeic;
}

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

  // Rate limit: 5 imports per minute per user to prevent AI cost amplification
  try {
    await importRateLimiter(`pf-import:${session.user.id}`);
  } catch {
    return NextResponse.json({ error: "Too many import requests. Please wait a moment and try again." }, { status: 429 });
  }

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

  // Validate magic bytes — reject files whose content doesn't match their declared type
  const declaredKind = isCsv ? "csv" : isPdf ? "pdf" : "image";
  if (!validateFileMagicBytes(buffer, declaredKind)) {
    return NextResponse.json({ error: "File content does not match the declared file type." }, { status: 422 });
  }

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

  const rawTransactions = deduplicateIncoming(parseCsvBuffer(buffer, columnMap));
  if (rawTransactions.length === 0) {
    return NextResponse.json({ error: "No transactions found in CSV" }, { status: 400 });
  }

  const categorized = await categorizeBatch(rawTransactions.map((t) => t.description));

  const existingRaw = await db.statementTransaction.findMany({
    where: { organisationId, importBatch: { status: "DONE" } },
    select: { id: true, date: true, description: true, amount: true },
  });
  const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
  const { safe, duplicates } = detectDuplicates(rawTransactions, existing);

  // Build categorized row data indexed by description for the pending-duplicates store
  const categorizedByIdx = (txn: typeof rawTransactions[number], i: number) => ({
    date: new Date(txn.date),
    description: txn.description,
    merchantName: categorized[i]?.merchantName ?? txn.description,
    amount: txn.amount,
    type: txn.type,
    category: categorized[i]?.category ?? "Other",
    mccCode: categorized[i]?.mccCode ?? "0000",
    mccLabel: categorized[i]?.mccLabel ?? "Uncategorized",
  });

  const pendingDuplicatesData = duplicates.map((d) => {
    const idx = rawTransactions.indexOf(d.incoming);
    return categorizedByIdx(d.incoming, idx);
  });

  const batch = await db.statementImportBatch.create({
    data: {
      organisationId,
      filename,
      fileType: "CSV",
      status: "PENDING",
      transactionCount: safe.length,
      pendingDuplicatesJson: pendingDuplicatesData.length > 0 ? pendingDuplicatesData : undefined,
    },
  });

  if (safe.length > 0) {
    await db.statementTransaction.createMany({
      data: safe.map((txn) => ({
        organisationId,
        importBatchId: batch.id,
        ...categorizedByIdx(txn, rawTransactions.indexOf(txn)),
      })),
    });
  }

  if (duplicates.length > 0) {
    return NextResponse.json({
      status: "duplicates",
      batchId: batch.id,
      duplicates: pendingDuplicatesData.map((d) => ({ date: d.date, amount: d.amount, description: d.description })),
    });
  }

  await db.statementImportBatch.update({ where: { id: batch.id }, data: { status: "DONE" } });
  return NextResponse.json({ status: "done", batchId: batch.id, count: safe.length, skipped: 0 });
}

// Internal type for the shared streaming import helper
type EmitFn = (event: string, data: Record<string, unknown>) => void;

// Shared SSE helper used by both PDF and image handlers
function createSseStream(
  handler: (emit: EmitFn) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit: EmitFn = (event: string, data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await handler(emit);
      } finally {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }
    },
    cancel() {
      // Client disconnected — mark closed so emit() becomes a no-op.
      // The handler keeps running to completion so the DB batch is updated correctly.
      closed = true;
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
  rawTxnsBeforeDedup: import("@/server/services/statement-parser.service").RawTransaction[],
  organisationId: string,
  batchId: string,
) {
  const rawTransactions = deduplicateIncoming(rawTxnsBeforeDedup);
  console.log(`[import] runStreamingImport start: ${rawTransactions.length} txns, batchId: ${batchId}`);

  emit("progress", { step: "categorizing", pct: 50, count: rawTransactions.length, extracted: rawTxnsBeforeDedup.length });
  console.log("[import] calling categorizeBatch...");
  // Gemini can take up to 30s when rate-limited. Ping the SSE stream every 5s so
  // Caddy / browser proxies don't close the idle connection before we emit results.
  const keepaliveId = setInterval(() => emit("progress", { step: "categorizing", pct: 50, count: rawTransactions.length }), 5_000);
  const categorized = await categorizeBatch(rawTransactions.map((t) => t.description)).finally(() => clearInterval(keepaliveId));
  console.log("[import] categorizeBatch done, results:", categorized.length);

  emit("progress", { step: "deduplicating", pct: 75, count: rawTransactions.length });
  console.log("[import] fetching existing transactions for dedup...");
  const existingRaw = await db.statementTransaction.findMany({
    where: { organisationId, importBatch: { status: "DONE" } },
    select: { id: true, date: true, description: true, amount: true },
  });
  console.log("[import] existing txns fetched:", existingRaw.length);
  const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
  const { safe, duplicates } = detectDuplicates(rawTransactions, existing);
  console.log(`[import] dedup done: ${safe.length} safe, ${duplicates.length} duplicates`);

  const pendingDuplicatesData = duplicates.map((d) => {
    const idx = rawTransactions.indexOf(d.incoming);
    return {
      date: new Date(d.incoming.date),
      description: d.incoming.description,
      merchantName: categorized[idx]?.merchantName ?? d.incoming.description,
      amount: d.incoming.amount,
      type: d.incoming.type,
      category: categorized[idx]?.category ?? "Other",
      mccCode: categorized[idx]?.mccCode ?? "0000",
      mccLabel: categorized[idx]?.mccLabel ?? "Uncategorized",
    };
  });

  emit("progress", { step: "saving", pct: 90 });

  // Clear demo data before saving real transactions
  console.log("[import] checking hasSampleData...");
  const org = await db.organisation.findUnique({ where: { id: organisationId }, select: { hasSampleData: true } });
  console.log("[import] hasSampleData:", org?.hasSampleData);
  if (org?.hasSampleData) {
    console.log("[import] deleting sample data...");
    await db.$transaction([
      db.statementTransaction.deleteMany({ where: { organisationId, isSampleData: true } }),
      db.organisation.update({ where: { id: organisationId }, data: { hasSampleData: false } }),
    ]);
    console.log("[import] sample data deleted");
  }

  if (safe.length > 0) {
    console.log("[import] inserting", safe.length, "transactions...");
    await db.statementTransaction.createMany({
      data: safe.map((txn) => {
        const idx = rawTransactions.indexOf(txn);
        return {
          organisationId,
          importBatchId: batchId,
          date: new Date(txn.date),
          description: txn.description,
          merchantName: categorized[idx]?.merchantName ?? txn.description,
          amount: txn.amount,
          type: txn.type,
          category: categorized[idx]?.category ?? "Other",
          mccCode: categorized[idx]?.mccCode ?? "0000",
          mccLabel: categorized[idx]?.mccLabel ?? "Uncategorized",
        };
      }),
    });
    console.log("[import] transactions inserted");
  }

  console.log("[import] updating batch record...");
  await db.statementImportBatch.update({
    where: { id: batchId },
    data: {
      transactionCount: safe.length,
      pendingDuplicatesJson: pendingDuplicatesData.length > 0 ? pendingDuplicatesData : undefined,
    },
  });
  console.log("[import] batch record updated");

  if (duplicates.length > 0) {
    emit("duplicates", {
      count: duplicates.length,
      items: pendingDuplicatesData.map((d) => ({ date: d.date, amount: d.amount, description: d.description })),
      batchId,
    });
    return;
  }

  console.log("[import] marking batch DONE...");
  await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
  console.log("[import] batch DONE, emitting done event");
  emit("done", { batchId, count: safe.length, skipped: 0 });
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
      console.log("[import] calling extractPdfPages, batchId:", batchId, "bufferSize:", buffer.length);
      const pages = await extractPdfPages(buffer);
      console.log("[import] extractPdfPages returned", pages.length, "pages");

      const allRawTransactions: import("@/server/services/statement-parser.service").RawTransaction[] = [];
      for (let i = 0; i < pages.length; i++) {
        const pct = 15 + Math.round(((i + 1) / pages.length) * 25);
        emit("progress", { step: "parsing", pct, page: i + 1, totalPages: pages.length });
        // Keep SSE alive during Gemini page-parse call (up to 30s per page when rate-limited).
        const pageKeepaliveId = setInterval(() => emit("progress", { step: "parsing", pct, page: i + 1, totalPages: pages.length }), 5_000);
        const pageTxns = await parsePageTransactions(pages[i]).finally(() => clearInterval(pageKeepaliveId));
        allRawTransactions.push(...pageTxns);
        console.log(`[import] Page ${i + 1}/${pages.length}: extracted ${pageTxns.length} transactions`);
      }

      if (allRawTransactions.length === 0) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: "No transactions found" } });
        emit("error", { message: "No transactions found in PDF. The format may not be supported." });
        return;
      }

      console.log(`[import] Total extracted: ${allRawTransactions.length} transactions from ${pages.length} pages`);
      await runStreamingImport(emit, allRawTransactions, organisationId, batchId);
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
