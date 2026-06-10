# Image Statement Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to upload a photo (JPEG, PNG, WEBP, HEIC) of a bank or credit card statement and have transactions extracted automatically using Ollama's vision API.

**Architecture:** Image files follow the same SSE-streaming pipeline as PDFs — the browser uploads the file, the server streams back progress events, and Ollama's multimodal (vision) API extracts the transaction list from the image as base64. A new `image-statement.service.ts` wraps the Ollama vision call, mirroring the structure of `pdf-statement.service.ts`. The `StatementFileType` Prisma enum gains an `IMAGE` variant to track image imports in the DB.

**Tech Stack:** Ollama `/api/chat` vision API (base64 images in message), Prisma enum migration, Next.js SSE (ReadableStream), pnpm/vitest for tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/image-statement.service.ts` | **Create** | Ollama vision extraction: takes a Buffer, sends base64 to Ollama, returns `RawTransaction[]` |
| `tests/unit/image-statement.service.test.ts` | **Create** | Unit tests for the service (mock `fetch`) |
| `prisma/schema.prisma` | **Modify** | Add `IMAGE` to `StatementFileType` enum |
| `prisma/migrations/20260527200000_add_image_filetype/migration.sql` | **Create** | `ALTER TYPE "StatementFileType" ADD VALUE 'IMAGE'` |
| `app/api/pf/import/route.ts` | **Modify** | Detect image MIME/extension, add `handleImageImport()` SSE handler |
| `app/(app)/pf/transactions/_components/import-dialog.tsx` | **Modify** | Accept images in file input, update validation, labels, and progress UI |

---

### Task 1: ImageStatementService (TDD)

**Files:**
- Create: `server/services/image-statement.service.ts`
- Create: `tests/unit/image-statement.service.test.ts`

The service calls Ollama's `/api/chat` endpoint with the image as base64 embedded in the `images` field of the user message. The response is parsed identically to `pdf-statement.service.ts`. Health-check and error paths follow the same fallback-to-empty-array pattern.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/image-statement.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";

describe("parseTransactionsFromImage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty array when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(result).toEqual([]);
  });

  it("parses valid Ollama vision response into RawTransactions", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)          // health check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { date: "2026-05-01", description: "Woolworths", amount: 45.20, type: "DEBIT" },
              { date: "2026-05-03", description: "Salary", amount: 4000.00, type: "CREDIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Woolworths", amount: 45.20, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ type: "CREDIT" });
  });

  it("strips markdown fences from response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "```json\n[{\"date\":\"2026-05-01\",\"description\":\"Uber\",\"amount\":18.90,\"type\":\"DEBIT\"}]\n```",
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("filters out items with missing required fields", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", amount: 6.40, type: "DEBIT" }, // missing date
              { date: "2026-05-01", description: "Uber", amount: 18.90, type: "DEBIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("returns empty array on unparseable Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "I cannot read this image." } }),
      } as Response);

    const result = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(result).toEqual([]);
  });

  it("sends image as base64 in Ollama request body", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "[]" } }),
      } as Response);

    const imageBuffer = Buffer.from("test-image-data");
    await parseTransactionsFromImage(imageBuffer);

    const chatCall = fetchSpy.mock.calls[1];
    const body = JSON.parse(chatCall![1]!.body as string);
    expect(body.messages[0].images).toHaveLength(1);
    expect(body.messages[0].images[0]).toBe(imageBuffer.toString("base64"));
  });
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
npx vitest run tests/unit/image-statement.service.test.ts
```

Expected: 5 tests fail with "Cannot find module '@/server/services/image-statement.service'"

- [ ] **Step 3: Create the service**

Create `server/services/image-statement.service.ts`:

```typescript
/**
 * ImageStatementService
 * Uses Ollama's vision API to extract transactions from a bank statement image.
 * Mirrors the fallback pattern from pdf-statement.service.ts.
 */
import type { RawTransaction } from "./statement-parser.service";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

const IMAGE_PARSE_PROMPT = `You are a bank statement parser. Extract all financial transactions visible in this bank or credit card statement image.

Return ONLY a valid JSON array. No markdown fences, no commentary.

Required shape:
[{ "date": "YYYY-MM-DD", "description": "merchant or description", "amount": 123.45, "type": "DEBIT" or "CREDIT" }]

Rules:
- date: YYYY-MM-DD format only
- amount: positive number
- type: DEBIT = money leaving account, CREDIT = money entering account
- Skip: header rows, running balance rows, opening/closing balance lines
- If a line is not a transaction, omit it`;

export async function parseTransactionsFromImage(buffer: Buffer): Promise<RawTransaction[]> {
  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[image-statement.service] Ollama not reachable — returning empty transaction list.");
    return [];
  }

  try {
    const base64Image = buffer.toString("base64");

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "user",
            content: IMAGE_PARSE_PROMPT,
            images: [base64Image],
          },
        ],
        stream: false,
        options: { temperature: 0.1, num_predict: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) return [];

    const data = await response.json() as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let parsed: unknown;
    try { parsed = JSON.parse(match[0]); } catch { return []; }
    if (!Array.isArray(parsed)) return [];

    return (parsed as Array<Partial<RawTransaction>>)
      .filter((item) => item.date && item.description && item.amount != null && item.type)
      .map((item) => ({
        date: String(item.date),
        description: String(item.description),
        amount: Number(item.amount),
        type: item.type as "DEBIT" | "CREDIT",
      }));
  } catch {
    console.warn("[image-statement.service] Ollama request failed — returning empty transaction list.");
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
npx vitest run tests/unit/image-statement.service.test.ts
```

Expected: 5/5 pass

- [ ] **Step 5: Commit**

```bash
git add server/services/image-statement.service.ts tests/unit/image-statement.service.test.ts
git commit -m "feat: add ImageStatementService using Ollama vision API"
```

---

### Task 2: Prisma schema + migration — add IMAGE enum value

**Files:**
- Modify: `prisma/schema.prisma` (line ~603 — the `StatementFileType` enum)
- Create: `prisma/migrations/20260527200000_add_image_filetype/migration.sql`

- [ ] **Step 1: Update the schema**

In `prisma/schema.prisma`, change the `StatementFileType` enum (currently around line 603) from:

```prisma
enum StatementFileType {
  PDF
  CSV
}
```

to:

```prisma
enum StatementFileType {
  PDF
  CSV
  IMAGE
}
```

- [ ] **Step 2: Create the migration directory and SQL file**

```bash
mkdir -p prisma/migrations/20260527200000_add_image_filetype
```

Create `prisma/migrations/20260527200000_add_image_filetype/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "StatementFileType" ADD VALUE 'IMAGE';
```

- [ ] **Step 3: Apply the migration**

```bash
npx prisma migrate deploy
```

Expected output: "1 migration applied successfully" (or "already applied" for any previous ones)

- [ ] **Step 4: Verify Prisma client is regenerated**

```bash
npx prisma generate
```

Expected: "Generated Prisma Client" with no errors

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260527200000_add_image_filetype/
git commit -m "feat: add IMAGE variant to StatementFileType enum"
```

---

### Task 3: Update import API route to handle image files

**Files:**
- Modify: `app/api/pf/import/route.ts`

Add image file detection (JPEG, PNG, WEBP, HEIC) and an `handleImageImport` function that follows the exact same SSE streaming pattern as `handlePdfImport` but calls `parseTransactionsFromImage` instead.

- [ ] **Step 1: Update the import route**

Replace the entire `app/api/pf/import/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { autoDetectColumns, parseCsvBuffer, detectDuplicates } from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import { extractTextFromPdf, parseTransactionsFromText } from "@/server/services/pdf-statement.service";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";

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
  const isImage = IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) || file.type.startsWith("image/");

  if (!isCsv && !isPdf && !isImage) {
    return NextResponse.json({ error: "Only PDF, CSV, and image files are supported" }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isCsv) return handleCsvImport(buffer, file.name, organisationId);
  if (isPdf)  return handlePdfImport(buffer, file.name, organisationId);
  return handleImageImport(buffer, file.name, organisationId);
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

// Shared SSE helper used by both PDF and image handlers
function createSseStream(
  handler: (emit: (event: string, data: object) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: object) => {
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
          importBatchId: batchId!,
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
    } catch (err) {
      if (batchId) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: String(err) } }).catch(() => {});
      }
      emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
    }
  });
}

async function handleImageImport(buffer: Buffer, filename: string, organisationId: string) {
  return createSseStream(async (emit) => {
    let batchId: string | undefined;
    try {
      const batch = await db.statementImportBatch.create({
        data: { organisationId, filename, fileType: "IMAGE", status: "PROCESSING", transactionCount: 0 },
      });
      batchId = batch.id;

      emit("progress", { step: "parsing", pct: 20 });
      const rawTransactions = await parseTransactionsFromImage(buffer);

      if (rawTransactions.length === 0) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: "No transactions found" } });
        emit("error", { message: "No transactions found in image. Ensure the statement is clearly visible and try again." });
        return;
      }

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
          importBatchId: batchId!,
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
    } catch (err) {
      if (batchId) {
        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: String(err) } }).catch(() => {});
      }
      emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
    }
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add app/api/pf/import/route.ts
git commit -m "feat: add image file support to import API route"
```

---

### Task 4: Update ImportDialog to accept image files

**Files:**
- Modify: `app/(app)/pf/transactions/_components/import-dialog.tsx`

Changes needed:
1. Update `STEP_LABELS` — image steps skip "extracting" (no text extraction step)
2. Add a helper `fileCategory(file)` that returns `"csv" | "pdf" | "image"`
3. Update `handleFile` to accept image extensions
4. Update `handleImport` to treat images like PDFs (SSE path)
5. Update `<input accept>` to include image MIME types
6. Update UI copy from "PDF or CSV" to "PDF, CSV, or image"
7. Show the correct progress steps for image (no "Extracting text" step)

- [ ] **Step 1: Replace the entire import dialog**

Replace `app/(app)/pf/transactions/_components/import-dialog.tsx` with:

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, XCircle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

type ImportState = "idle" | "uploading" | "duplicates" | "done" | "error";
type FileCategory = "csv" | "pdf" | "image";

interface DuplicateItem { id: string; date: string | Date; amount: number; description: string; }
interface ProgressStep { step: string; pct: number; count?: number; }

const PDF_STEP_LABELS: Record<string, string> = {
  extracting:    "Extracting text from PDF",
  parsing:       "Parsing transactions",
  categorizing:  "Categorizing with AI",
  deduplicating: "Checking for duplicates",
  saving:        "Saving transactions",
};

const IMAGE_STEP_LABELS: Record<string, string> = {
  parsing:       "Reading statement image with AI",
  categorizing:  "Categorizing with AI",
  deduplicating: "Checking for duplicates",
  saving:        "Saving transactions",
};

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

function getFileCategory(file: File): FileCategory | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) || file.type.startsWith("image/")) return "image";
  return null;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function ImportDialog({ open, onOpenChange, onComplete }: ImportDialogProps) {
  const [state, setState] = useState<ImportState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ProgressStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState("idle");
    setFile(null);
    setProgress(null);
    setCompletedSteps([]);
    setDuplicates([]);
    setBatchId(null);
    setResultCount(0);
    setErrorMsg("");
  };

  const handleFile = (f: File) => {
    if (!getFileCategory(f)) {
      toast.error("Only PDF, CSV, and image files (JPEG, PNG, WEBP) are supported");
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setState("uploading");
    setCompletedSteps([]);
    setProgress(null);

    const formData = new FormData();
    formData.append("file", file);

    const category = getFileCategory(file);

    if (category === "csv") {
      // CSV: synchronous JSON response
      try {
        const res = await fetch("/api/pf/import", { method: "POST", body: formData });
        const data = await res.json() as { status: string; batchId?: string; count?: number; duplicates?: DuplicateItem[]; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? "Import failed");

        if (data.status === "duplicates" && data.batchId && data.duplicates) {
          setBatchId(data.batchId);
          setDuplicates(data.duplicates);
          setState("duplicates");
        } else {
          setResultCount(data.count ?? 0);
          setState("done");
          onComplete();
          toast.success(`${data.count} transactions imported`);
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Unknown error");
        setState("error");
      }
      return;
    }

    // PDF and image: SSE stream
    const stepLabels = category === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;

    try {
      const res = await fetch("/api/pf/import", { method: "POST", body: formData });
      if (!res.ok) { throw new Error(`Upload failed: ${res.statusText}`); }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
          } else if (trimmed.startsWith("data: ")) {
            try {
              const d = JSON.parse(trimmed.slice(6));
              if (currentEvent === "progress") {
                setProgress(d as ProgressStep);
                if (d.step && d.pct > 10) {
                  setCompletedSteps(() => {
                    const steps = Object.keys(stepLabels);
                    const currentIdx = steps.indexOf(d.step as string);
                    return steps.slice(0, currentIdx);
                  });
                }
              } else if (currentEvent === "duplicates") {
                setBatchId(d.batchId);
                setDuplicates(d.items ?? []);
                setState("duplicates");
              } else if (currentEvent === "done") {
                setResultCount(d.count ?? 0);
                setState("done");
                onComplete();
                toast.success(`${d.count} transactions imported`);
              } else if (currentEvent === "error") {
                throw new Error(d.message ?? "Import error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
            currentEvent = "";
          }
        }
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const handleConfirm = async (skipDuplicates: boolean) => {
    if (!batchId) return;
    setState("uploading");
    try {
      const url = `/api/pf/import/${batchId}/confirm?skip=${skipDuplicates}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateIds: duplicates.map((d) => d.id) }),
      });
      const data = await res.json() as { count: number; skipped: number };
      setResultCount(data.count);
      setState("done");
      onComplete();
      toast.success(`${data.count} transactions imported${data.skipped ? `, ${data.skipped} duplicates skipped` : ""}`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const activeStepLabels = file && getFileCategory(file) === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;
  const activeStepKeys = Object.keys(activeStepLabels);
  const fileCategory = file ? getFileCategory(file) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state === "duplicates" ? "Possible Duplicates Found" :
             state === "done" ? "Import Complete" :
             state === "error" ? "Import Failed" : "Import Statement"}
          </DialogTitle>
        </DialogHeader>

        {/* IDLE */}
        {state === "idle" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Upload a bank or credit card statement (PDF, CSV, or photo).</p>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors
                ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}`}
            >
              {fileCategory === "image"
                ? <ImageIcon className="h-8 w-8 text-muted-foreground/40 mb-2" />
                : <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
              }
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Drop PDF, CSV, or image here</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">JPEG · PNG · WEBP · PDF · CSV · max 20 MB</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.csv,.jpg,.jpeg,.png,.webp,.heic,.heif,image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!file} onClick={handleImport}>Import</Button>
            </div>
          </div>
        )}

        {/* UPLOADING / PROCESSING */}
        {state === "uploading" && (
          <div className="flex flex-col gap-4">
            {fileCategory === "csv" ? (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Importing CSV…</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {activeStepKeys.map((key, idx) => {
                    const isDone = completedSteps.includes(key);
                    const isActive = progress?.step === key;
                    const isPending = !isDone && !isActive;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div className={`h-5 w-5 rounded-full flex items-center justify-center text-xs flex-shrink-0
                          ${isDone ? "bg-emerald-500 text-white" : isActive ? "bg-primary" : "bg-muted border"}`}>
                          {isDone ? <CheckCircle2 className="h-3 w-3" /> :
                           isActive ? <Loader2 className="h-3 w-3 animate-spin text-white" /> :
                           <span className="text-muted-foreground">{idx + 1}</span>}
                        </div>
                        <div>
                          <p className={`text-sm ${isPending ? "text-muted-foreground" : "text-foreground"}`}>{activeStepLabels[key]}</p>
                          {isActive && progress?.count && <p className="text-xs text-primary">{progress.count} transactions found</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {progress && (
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress.pct}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* DUPLICATES */}
        {state === "duplicates" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{duplicates.length} transaction{duplicates.length !== 1 ? "s" : ""} may already exist in your records.</p>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {duplicates.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{d.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-red-500">−${Number(d.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => handleConfirm(true)}>
                Skip duplicates — import new transactions only
              </Button>
              <Button onClick={() => handleConfirm(false)}>
                Import all — keep duplicates
              </Button>
            </div>
          </div>
        )}

        {/* DONE */}
        {state === "done" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="text-center">
              <p className="font-medium">{resultCount} transactions imported</p>
              <p className="text-sm text-muted-foreground mt-1">Categories have been auto-assigned. Edit any row in the table.</p>
            </div>
            <Button onClick={() => { onOpenChange(false); reset(); }}>View Transactions</Button>
          </div>
        )}

        {/* ERROR */}
        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <XCircle className="h-12 w-12 text-red-500" />
            <div className="text-center">
              <p className="font-medium text-red-500">Import failed</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={reset}>Try again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add app/(app)/pf/transactions/_components/import-dialog.tsx
git commit -m "feat: update ImportDialog to accept image files"
```

---

## Self-Review

### 1. Spec coverage

- ✅ Upload a picture of bank/credit card statement → Task 1 (service) + Task 3 (route) + Task 4 (dialog)
- ✅ Transactions extracted automatically → Ollama vision in `parseTransactionsFromImage`
- ✅ Same SSE progress UI as PDF → `handleImageImport` uses `createSseStream` helper
- ✅ Category auto-assignment → same `categorizeBatch` call
- ✅ Duplicate detection → same `detectDuplicates` call
- ✅ DB tracking of file type → IMAGE enum value added in Task 2
- ✅ Error handling / fallback-to-empty → mirrors PDF service pattern

### 2. Placeholder scan

None found — all steps have complete code.

### 3. Type consistency

- `RawTransaction` imported from `statement-parser.service` in `image-statement.service.ts` — consistent with pdf service
- `FileCategory` type used in dialog matches `getFileCategory()` return — consistent
- `IMAGE_EXTENSIONS` defined once in both route and dialog — the route uses `IMAGE_EXTENSIONS` constant, dialog mirrors it — no drift
- `IMAGE_STEP_LABELS` keys (`parsing`, `categorizing`, `deduplicating`, `saving`) match the `step` values emitted by `handleImageImport` — consistent
