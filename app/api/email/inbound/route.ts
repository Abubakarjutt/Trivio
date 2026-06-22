// app/api/email/inbound/route.ts
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  deduplicateIncoming,
  detectDuplicates,
} from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import {
  extractTextFromPdf,
  parseTransactionsFromText,
} from "@/server/services/pdf-statement.service";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";
import { redactPiiText } from "@/server/services/pii-redaction.service";

export const maxDuration = 180;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

interface InboundAttachment {
  filename: string;
  mimeType: string;
  content: number[];
}

interface InboundEmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments: InboundAttachment[];
}

export async function POST(request: NextRequest) {
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  const secret   = request.headers.get("x-webhook-secret");
  if (!expected || !secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Use timingSafeEqual directly; length pre-check leaks secret length as a timing side-channel.
  // timingSafeEqual throws on buffer length mismatch, so we catch and treat as no-match.
  let secretsMatch = false;
  try {
    secretsMatch = timingSafeEqual(Buffer.from(expected), Buffer.from(secret));
  } catch {
    secretsMatch = false;
  }
  if (!secretsMatch) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as InboundEmailPayload;

    const token = payload.to.split("@")[0] ?? "";
    const org = await db.organisation.findFirst({
      where: { emailImportToken: token },
      select: { id: true },
    });

    if (!org) {
      console.info("[email-inbound] no org found for token:", token);
      return NextResponse.json({ ok: true });
    }

    const organisationId = org.id;
    console.info("[email-inbound] processing email for org:", organisationId, "| subject:", payload.subject);

    let rawTransactions;

    const pdfAttachment = payload.attachments.find(
      (a) => a.mimeType === "application/pdf"
    );
    const imageAttachment = payload.attachments.find((a) =>
      IMAGE_MIME_TYPES.has(a.mimeType)
    );

    if (pdfAttachment) {
      console.info("[email-inbound] processing PDF attachment:", pdfAttachment.filename);
      const buffer = Buffer.from(pdfAttachment.content);
      const text = await extractTextFromPdf(buffer);
      rawTransactions = await parseTransactionsFromText(redactPiiText(text));
    } else if (imageAttachment) {
      console.info("[email-inbound] processing image attachment:", imageAttachment.filename);
      const buffer = Buffer.from(imageAttachment.content);
      rawTransactions = await parseTransactionsFromImage(buffer, imageAttachment.mimeType);
    } else {
      console.info("[email-inbound] processing email body text, length:", (payload.text || payload.html).length);
      const bodyText = payload.text || payload.html.replace(/<[^>]+>/g, " ");
      rawTransactions = await parseTransactionsFromText(redactPiiText(bodyText));
    }

    console.info("[email-inbound] raw transactions extracted:", rawTransactions.length);

    const deduped = deduplicateIncoming(rawTransactions);
    if (deduped.length === 0) {
      console.info("[email-inbound] 0 transactions after dedup — skipping");
      return NextResponse.json({ ok: true });
    }

    const existingRaw = await db.statementTransaction.findMany({
      where: { organisationId, importBatch: { status: "DONE" } },
      select: { id: true, date: true, description: true, amount: true },
    });
    const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
    const { safe } = detectDuplicates(deduped, existing);

    if (safe.length === 0) {
      console.info("[email-inbound] all transactions already exist — skipping");
      return NextResponse.json({ ok: true });
    }

    // Clear demo data before saving real transactions
    const orgRecord = await db.organisation.findUnique({ where: { id: organisationId }, select: { hasSampleData: true } });
    if (orgRecord?.hasSampleData) {
      await db.$transaction([
        db.statementTransaction.deleteMany({ where: { organisationId, isSampleData: true } }),
        db.organisation.update({ where: { id: organisationId }, data: { hasSampleData: false } }),
      ]);
    }

    const categorized = await categorizeBatch(safe.map((t) => t.description));

    const batch = await db.statementImportBatch.create({
      data: {
        organisationId,
        filename: payload.subject || `email-${Date.now()}`,
        fileType: "EMAIL",
        status: "DONE",
        transactionCount: safe.length,
      },
    });

    await db.statementTransaction.createMany({
      data: safe.map((txn, i) => ({
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

    console.info("[email-inbound] saved", safe.length, "transactions for org:", organisationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Always return 200 — prevents Cloudflare Worker from retrying on app errors
    console.error("[email-inbound] unhandled error:", err);
    return NextResponse.json({ ok: true });
  }
}
