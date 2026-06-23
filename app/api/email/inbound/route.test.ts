// app/api/email/inbound/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    organisation: { findFirst: vi.fn(), findUnique: vi.fn() },
    statementImportBatch: { create: vi.fn() },
    statementTransaction: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/server/services/pdf-statement.service", () => ({
  extractTextFromPdf: vi.fn().mockResolvedValue("statement text"),
  parseTransactionsFromText: vi.fn().mockResolvedValue([
    { date: "2024-01-15", description: "Starbucks", amount: 12.5, type: "DEBIT" },
  ]),
}));

vi.mock("@/server/services/image-statement.service", () => ({
  parseTransactionsFromImage: vi.fn().mockResolvedValue([
    { date: "2024-01-15", description: "Amazon", amount: 45.0, type: "DEBIT" },
  ]),
}));

vi.mock("@/server/services/statement-parser.service", () => ({
  deduplicateIncoming: vi.fn().mockImplementation((txns: unknown[]) => txns),
  detectDuplicates: vi.fn().mockReturnValue({ safe: [
    { date: "2024-01-15", description: "Starbucks", amount: 12.5, type: "DEBIT" },
  ], duplicates: [] }),
  parseTransactionsFromText: vi.fn().mockResolvedValue([
    { date: "2024-01-15", description: "Starbucks", amount: 12.5, type: "DEBIT" },
  ]),
}));

vi.mock("@/server/services/statement-categorization.service", () => ({
  categorizeBatch: vi.fn().mockResolvedValue([
    { merchantName: "Starbucks", category: "Food & Dining", mccCode: "5814", mccLabel: "Coffee" },
  ]),
}));

vi.mock("@/server/services/pii-redaction.service", () => ({
  redactPiiText: vi.fn().mockImplementation((t: string) => t),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from "@/app/api/email/inbound/route";
import { db } from "@/lib/db";
import { extractTextFromPdf, parseTransactionsFromText as parsePdfText } from "@/server/services/pdf-statement.service";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-secret-xyz";
process.env.EMAIL_WEBHOOK_SECRET = VALID_SECRET;

const ORG = { id: "org-1", emailImportToken: "abc123" };

function makeReq(body: object, secret = VALID_SECRET) {
  return new NextRequest("http://localhost/api/email/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify(body),
  });
}

const TEXT_EMAIL = {
  to: "abc123@import.trivio-ai.com",
  from: "bank@example.com",
  subject: "Transaction alert",
  text: "You spent $12.50 at Starbucks",
  html: "",
  attachments: [],
};

const PDF_EMAIL = {
  ...TEXT_EMAIL,
  attachments: [{
    filename: "statement.pdf",
    mimeType: "application/pdf",
    content: Array.from(new TextEncoder().encode("%PDF-1.4")),
  }],
};

const IMAGE_EMAIL = {
  ...TEXT_EMAIL,
  attachments: [{
    filename: "statement.jpg",
    mimeType: "image/jpeg",
    content: Array.from(new TextEncoder().encode("fake-jpeg")),
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/email/inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.organisation.findFirst).mockResolvedValue(ORG as never);
    vi.mocked(db.organisation.findUnique).mockResolvedValue({ hasSampleData: false } as never);
    vi.mocked(db.statementImportBatch.create).mockResolvedValue({ id: "batch-1" } as never);
    vi.mocked(db.statementTransaction.findMany).mockResolvedValue([]);
    vi.mocked(db.statementTransaction.createMany).mockResolvedValue({ count: 1 } as never);
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 on missing secret", async () => {
    const req = new NextRequest("http://localhost/api/email/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TEXT_EMAIL),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 on wrong secret", async () => {
    const res = await POST(makeReq(TEXT_EMAIL, "wrong-secret"));
    expect(res.status).toBe(401);
  });

  // ── Token lookup ──────────────────────────────────────────────────────────

  it("returns 200 silently when token is not found (prevents Worker retries)", async () => {
    vi.mocked(db.organisation.findFirst).mockResolvedValue(null as never);
    const res = await POST(makeReq(TEXT_EMAIL));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.createMany)).not.toHaveBeenCalled();
  });

  it("extracts token from the local part of the to address", async () => {
    await POST(makeReq({ ...TEXT_EMAIL, to: "mytoken@import.trivio-ai.com" }));
    expect(vi.mocked(db.organisation.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { emailImportToken: "mytoken" } })
    );
  });

  // ── Pipeline routing ──────────────────────────────────────────────────────

  it("routes text-only email through parseTransactionsFromText", async () => {
    await POST(makeReq(TEXT_EMAIL));
    expect(vi.mocked(parsePdfText)).toHaveBeenCalled();
    expect(vi.mocked(parseTransactionsFromImage)).not.toHaveBeenCalled();
  });

  it("routes PDF attachment through extractTextFromPdf → parseTransactionsFromText", async () => {
    await POST(makeReq(PDF_EMAIL));
    expect(vi.mocked(extractTextFromPdf)).toHaveBeenCalled();
    expect(vi.mocked(parseTransactionsFromImage)).not.toHaveBeenCalled();
  });

  it("routes image attachment through parseTransactionsFromImage", async () => {
    await POST(makeReq(IMAGE_EMAIL));
    expect(vi.mocked(parseTransactionsFromImage)).toHaveBeenCalled();
    expect(vi.mocked(extractTextFromPdf)).not.toHaveBeenCalled();
  });

  // ── Save ──────────────────────────────────────────────────────────────────

  it("creates batch with fileType EMAIL and status DONE", async () => {
    await POST(makeReq(TEXT_EMAIL));
    expect(vi.mocked(db.statementImportBatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileType: "EMAIL", status: "DONE" }),
      })
    );
  });

  it("inserts safe transactions via createMany", async () => {
    await POST(makeReq(TEXT_EMAIL));
    expect(vi.mocked(db.statementTransaction.createMany)).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and silently drops when 0 transactions parsed", async () => {
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    vi.mocked(parseTransactionsFromText).mockResolvedValueOnce([]);
    const { detectDuplicates } = await import("@/server/services/statement-parser.service");
    vi.mocked(detectDuplicates).mockReturnValueOnce({ safe: [], duplicates: [] });
    const res = await POST(makeReq(TEXT_EMAIL));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.createMany)).not.toHaveBeenCalled();
  });

  it("always returns 200 even on application error", async () => {
    vi.mocked(db.organisation.findFirst).mockRejectedValueOnce(new Error("DB down") as never);
    const res = await POST(makeReq(TEXT_EMAIL));
    expect(res.status).toBe(200);
  });
});
