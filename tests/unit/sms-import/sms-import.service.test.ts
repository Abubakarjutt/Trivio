import { beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ parseTransactionsFromText: vi.fn() }));
vi.mock("@/server/services/pdf-statement.service", () => pdf);
const pii = vi.hoisted(() => ({ redactPiiText: vi.fn((s: string) => s.replace(/\d{4} \d{4}/g, "[CARD]")) }));
vi.mock("@/server/services/pii-redaction.service", () => pii);

import type { ImportCategorizer, RuleCategorization } from "@/server/services/categorize/category-rules.service";
import { isRealIsoDate, loadExistingForDedup, processSms, resolveDate } from "@/server/services/sms/sms-import.service";

const RECEIVED = new Date(2026, 9, 30, 14, 5); // 30 Oct 2026 14:05 local
const kfc = { date: "2026-10-30", description: "KFC DHA", amount: 1450, type: "DEBIT" as const };

const catRow = (over: Partial<RuleCategorization> = {}): RuleCategorization => ({
  merchantName: "KFC", category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food",
  needsCategory: false, ruleKey: { kind: "MERCHANT", matchKey: "kfc", label: "KFC" }, ruleApplied: false, ...over,
});
function fakeCategorizer(rows: RuleCategorization[] = [catRow()]) {
  return {
    tokenize: vi.fn((t: string) => t.replace("03001234567", "[PHONE ••4567 #0123456789ab]")),
    categorize: vi.fn(async (_rows: unknown[]) => rows),
  } satisfies ImportCategorizer;
}

beforeEach(() => {
  pdf.parseTransactionsFromText.mockReset();
});

describe("processSms", () => {
  it("redacts, parses and categorises into PENDING_REVIEW", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    const r = await processSms("Card 1234 5678 used PKR 1,450 at KFC DHA", RECEIVED, [], fakeCategorizer());
    expect(pdf.parseTransactionsFromText).toHaveBeenCalledWith("Card [CARD] used PKR 1,450 at KFC DHA");
    expect(r).toEqual({
      status: "PENDING_REVIEW",
      redactedText: "Card [CARD] used PKR 1,450 at KFC DHA",
      parsed: [{ date: "2026-10-30", description: "KFC DHA", merchantName: "KFC", amount: 1450, type: "DEBIT",
                 category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food", possibleDuplicate: false,
                 needsCategory: false, ruleKey: { kind: "MERCHANT", matchKey: "kfc", label: "KFC" }, ruleApplied: false,
                 rememberRule: true, userCategorized: false }],
    });
  });

  it("returns NO_TRANSACTION for an OTP or promo", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([]);
    const c = fakeCategorizer();
    const r = await processSms("Your OTP is 482913. Do not share.", RECEIVED, [], c);
    expect(r.status).toBe("NO_TRANSACTION");
    expect(c.categorize).not.toHaveBeenCalled();
  });

  it("returns FAILED with the error when the parser throws", async () => {
    pdf.parseTransactionsFromText.mockRejectedValue(new Error("Gemini 503"));
    expect(await processSms("PKR 10 at X", RECEIVED, [], fakeCategorizer())).toMatchObject({ status: "FAILED", error: "Gemini 503", parsed: [] });
  });

  it("flags, but keeps, a transaction that already exists", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    const r = await processSms("PKR 1,450 at KFC DHA", RECEIVED, [
      { id: "t1", date: "2026-10-30", description: "KFC DHA", amount: 1450 },
    ], fakeCategorizer());
    expect(r.status).toBe("PENDING_REVIEW");
    expect(r.parsed[0]!.possibleDuplicate).toBe(true);
  });

  it("drops rows with a non-finite or out-of-range amount and keeps amounts positive", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([
      { ...kfc, description: "NAN", amount: NaN },
      { ...kfc, description: "HUGE", amount: 1e15 },
      { ...kfc, amount: -1450 },
    ]);
    const c = fakeCategorizer();
    const r = await processSms("PKR 1,450 at KFC DHA", RECEIVED, [], c);
    expect(c.categorize).toHaveBeenCalledWith([{ description: "KFC DHA" }]);
    expect(r.parsed.map((p) => [p.description, p.amount])).toEqual([["KFC DHA", 1450]]);
  });

  it("returns NO_TRANSACTION when every parsed amount is unusable", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([{ ...kfc, amount: NaN }, { ...kfc, description: "INF", amount: Infinity }]);
    const c = fakeCategorizer();
    const r = await processSms("PKR ??? at KFC", RECEIVED, [], c);
    expect(r.status).toBe("NO_TRANSACTION");
    expect(c.categorize).not.toHaveBeenCalled();
  });

  it("falls back to the description when the merchant name is empty", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    const c = fakeCategorizer([catRow({ merchantName: "" })]);
    const r = await processSms("PKR 1,450 at KFC DHA", RECEIVED, [], c);
    expect(r.parsed[0]!.merchantName).toBe("KFC DHA");
  });

  it("keeps both transactions from a two-transaction SMS", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc, { ...kfc, description: "REFUND DARAZ", amount: 900, type: "CREDIT" }]);
    const c = fakeCategorizer([catRow(), catRow({ merchantName: "Daraz", category: "Shopping" })]);
    const r = await processSms("two txns", RECEIVED, [], c);
    expect(r.parsed.map((p) => [p.merchantName, p.type])).toEqual([["KFC", "DEBIT"], ["Daraz", "CREDIT"]]);
  });
});

describe("processSms rules", () => {
  it("tokenizes before redacting and stores the categorizer's flags", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" }]);
    const c = fakeCategorizer([catRow({ category: "Transfers", needsCategory: true, ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" } })]);
    const r = await processSms("Raast PKR 5,000 to 03001234567", RECEIVED, [], c);
    expect(r.redactedText).toContain("[PHONE ••4567 #0123456789ab]");
    expect(r.redactedText).not.toContain("03001234567");
    expect(r.parsed[0]).toMatchObject({ needsCategory: true, ruleApplied: false, rememberRule: true, userCategorized: false,
      ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab" } });
  });

  it("passes the SMS's single token as a hint when the parser dropped it", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast transfer", amount: 5000, type: "DEBIT" }]);
    const c = fakeCategorizer();
    await processSms("Raast PKR 5,000 to 03001234567", RECEIVED, [], c);
    expect(c.categorize).toHaveBeenCalledWith([{ description: "Raast transfer", counterpartyHint: "[PHONE ••4567 #0123456789ab]" }]);
  });

  it("prefers the single phone token as the hint when an account token is also present", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast transfer", amount: 5000, type: "DEBIT" }]);
    const c = fakeCategorizer();
    c.tokenize.mockImplementation((t: string) =>
      t.replace("03001234567", "[PHONE ••4567 #0123456789ab]").replace("11112222333344", "[ACCT ••3344 #aaaaaaaaaaaa]"));
    await processSms("Raast PKR 5,000 from A/C 11112222333344 to 03001234567", RECEIVED, [], c);
    expect(c.categorize.mock.calls[0]![0]).toEqual([{ description: "Raast transfer", counterpartyHint: "[PHONE ••4567 #0123456789ab]" }]);
  });

  it("tokenizes existing descriptions before duplicate detection", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" }]);
    const r = await processSms("Raast PKR 5,000 to 03001234567", RECEIVED,
      [{ id: "e1", date: new Date("2026-10-30"), description: "Raast 03001234567", amount: 5000 }], fakeCategorizer());
    expect(r.parsed[0]!.possibleDuplicate).toBe(true);
  });
});

describe("resolveDate", () => {
  it("keeps a plausible parsed date", () => {
    expect(resolveDate("2026-10-29", RECEIVED)).toBe("2026-10-29");
  });
  it("falls back to the received date for a wrong year", () => {
    expect(resolveDate("2023-10-30", RECEIVED)).toBe("2026-10-30");
  });
  it("falls back for a date that does not exist", () => {
    const march1 = new Date(2026, 2, 1, 9, 0);
    expect(resolveDate("2026-02-30", march1)).toBe("2026-03-01");
    expect(resolveDate("2026-02-29", march1)).toBe("2026-03-01");
  });
  it("falls back for garbage", () => {
    expect(resolveDate("30-Oct", RECEIVED)).toBe("2026-10-30");
    expect(resolveDate("", RECEIVED)).toBe("2026-10-30");
  });
});

describe("isRealIsoDate", () => {
  it("accepts only real calendar dates in YYYY-MM-DD form", () => {
    expect(isRealIsoDate("2026-10-30")).toBe(true);
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-00-10")).toBe(false);
    expect(isRealIsoDate("9999-99-99")).toBe(false);
    expect(isRealIsoDate("30-10-2026")).toBe(false);
    expect(isRealIsoDate("")).toBe(false);
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
