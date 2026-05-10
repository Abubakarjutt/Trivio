/**
 * AI Extraction Worker
 *
 * Run this in a separate terminal:
 *   npx tsx server/workers/extraction.worker.ts
 *
 * It connects to Redis at localhost:6379 and processes jobs from the
 * "ai-extraction" BullMQ queue.
 */

import "dotenv/config";
import { config as loadEnvLocal } from "dotenv";
import { resolve } from "path";

// Load .env.local (Next.js convention) so standalone worker gets DATABASE_URL etc.
loadEnvLocal({ path: resolve(process.cwd(), ".env.local") });

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { extractDocument } from "@/server/services/extraction.service";
import type { ExtractionJob } from "@/lib/queue";

const connection = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: null });

const prisma = new PrismaClient({
  log: ["error", "warn"],
});

function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const worker = new Worker<ExtractionJob>(
  "ai-extraction",
  async (job) => {
    const { attachmentId, organisationId } = job.data;

    console.log(`[worker] Processing job ${job.id} — attachment ${attachmentId}`);

    // 1. Mark as PROCESSING
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { extractionStatus: "PROCESSING" },
    });

    // 2. Fetch attachment record
    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, organisationId },
    });

    if (!attachment) {
      throw new Error(`Attachment ${attachmentId} not found for org ${organisationId}`);
    }

    // 3. Run extraction (s3Key stores the relative file path)
    const result = await extractDocument(attachment.s3Key, attachment.mimeType);

    // 4. Save result and mark DONE
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        extractionStatus: "DONE",
        extractionResult: result as object,
      },
    });

    // 5. Increment usage counter (upsert so the row always exists)
    await prisma.usageRecord.upsert({
      where: {
        organisationId_month: {
          organisationId,
          month: currentMonth(),
        },
      },
      create: {
        organisationId,
        month: currentMonth(),
        aiExtractionCount: 1,
      },
      update: {
        aiExtractionCount: { increment: 1 },
      },
    });

    console.log(`[worker] Job ${job.id} completed — attachment ${attachmentId} DONE`);
  },
  {
    connection,
    concurrency: 3,
  },
);

worker.on("failed", async (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
  if (job?.data?.attachmentId) {
    try {
      await prisma.attachment.update({
        where: { id: job.data.attachmentId },
        data: { extractionStatus: "FAILED" },
      });
    } catch (updateErr) {
      console.error("[worker] Failed to set FAILED status:", updateErr);
    }
  }
});

worker.on("ready", () => {
  console.log("[worker] AI extraction worker ready — listening on queue 'ai-extraction'");
});

// Graceful shutdown
async function shutdown() {
  console.log("[worker] Shutting down…");
  await worker.close();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
