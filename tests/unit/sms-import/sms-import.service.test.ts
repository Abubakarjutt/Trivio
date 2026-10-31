import { beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ parseTransactionsFromText: vi.fn() }));
vi.mock("@/server/services/pdf-statement.service", () => pdf);
const cat = vi.hoisted(() => ({ categorizeBatch: vi.fn() }));
vi.mock("@/server/services/statement-categorization.service", () => cat);
const pii = vi.hoisted(() => ({ redactPiiText: vi.fn((s: string) => s.replace(/\d{4} \d{4}/g, "[CARD]")) }));
vi.mock("@/server/services/pii-redaction.service", () => pii);

import { loadExistingForDedup, processSms, resolveDate } from "@/server/services/sms/sms-import.service";

const RECEIVED = new Date(2026, 9, 30, 14, 5); // 30 Oct 2026 14:05 local
const kfc = { date: "2026-10-30", description: "KFC DHA", amount: 1450, type: "DEBIT" as const };
const catKfc = { description: "KFC DHA", merchantName: "KFC", mccCode: "5814", mccLabel: "Fast Food", category: "Food & Dining" };

beforeEach(() => {
  pdf.parseTransactionsFromText.mockReset();
  cat.categorizeBatch.mockReset();
});

describe("processSms", () => {
  it("redacts, parses and categorises into PENDING_REVIEW", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    cat.categorizeBatch.mockResolvedValue([catKfc]);
    const r = await processSms("Card 1234 5678 used PKR 1,450 at KFC DHA", RECEIVED, []);
    expect(pdf.parseTransactionsFromText).toHaveBeenCalledWith("Card [CARD] used PKR 1,450 at KFC DHA");
    expect(r).toEqual({
      status: "PENDING_REVIEW",
      redactedText: "Card [CARD] used PKR 1,450 at KFC DHA",
      parsed: [{ date: "2026-10-30", description: "KFC DHA", merchantName: "KFC", amount: 1450, type: "DEBIT",
                 category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food", possibleDuplicate: false }],
    });
  });

  it("returns NO_TRANSACTION for an OTP or promo", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([]);
    const r = await processSms("Your OTP is 482913. Do not share.", RECEIVED, []);
    expect(r.status).toBe("NO_TRANSACTION");
    expect(cat.categorizeBatch).not.toHaveBeenCalled();
  });

  it("returns FAILED with the error when the parser throws", async () => {
    pdf.parseTransactionsFromText.mockRejectedValue(new Error("Gemini 503"));
    expect(await processSms("PKR 10 at X", RECEIVED, [])).toMatchObject({ status: "FAILED", error: "Gemini 503", parsed: [] });
  });

  it("flags, but keeps, a transaction that already exists", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    cat.categorizeBatch.mockResolvedValue([catKfc]);
    const r = await processSms("PKR 1,450 at KFC DHA", RECEIVED, [
      { id: "t1", date: "2026-10-30", description: "KFC DHA", amount: 1450 },
    ]);
    expect(r.status).toBe("PENDING_REVIEW");
    expect(r.parsed[0]!.possibleDuplicate).toBe(true);
  });

  it("keeps both transactions from a two-transaction SMS", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc, { ...kfc, description: "REFUND DARAZ", amount: 900, type: "CREDIT" }]);
    cat.categorizeBatch.mockResolvedValue([catKfc, { ...catKfc, description: "REFUND DARAZ", merchantName: "Daraz", category: "Shopping" }]);
    const r = await processSms("two txns", RECEIVED, []);
    expect(r.parsed.map((p) => [p.merchantName, p.type])).toEqual([["KFC", "DEBIT"], ["Daraz", "CREDIT"]]);
  });
});

describe("resolveDate", () => {
  it("keeps a plausible parsed date", () => {
    expect(resolveDate("2026-10-29", RECEIVED)).toBe("2026-10-29");
  });
  it("falls back to the received date for a wrong year", () => {
    expect(resolveDate("2023-10-30", RECEIVED)).toBe("2026-10-30");
  });
  it("falls back for garbage", () => {
    expect(resolveDate("30-Oct", RECEIVED)).toBe("2026-10-30");
    expect(resolveDate("", RECEIVED)).toBe("2026-10-30");
  });
});

describe("loadExistingForDedup", () => {
  it("loads the org's last 90 days as plain numbers", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "a", date: new Date("2026-10-01"), description: "X", amount: { toString: () => "12.5000" } }]);
    const rows = await loadExistingForDedup({ statementTransaction: { findMany } } as never, "org-1", new Date("2026-10-30T00:00:00Z"));
    expect(findMany.mock.calls[0]![0].where).toEqual({ organisationId: "org-1", date: { gte: new Date("2026-08-01T00:00:00Z") } });
    expect(rows).toEqual([{ id: "a", date: new Date("2026-10-01"), description: "X", amount: 12.5 }]);
  });
});
