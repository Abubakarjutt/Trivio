import { describe, it, expect } from "vitest";
import {
  autoDetectColumns,
  normalizeAmount,
  parseCsvBuffer,
  detectDuplicates,
  levenshteinSimilarity,
} from "@/server/services/statement-parser.service";

// ─── autoDetectColumns ────────────────────────────────────────────────────────

describe("autoDetectColumns", () => {
  it("detects standard date/description/amount headers", () => {
    const map = autoDetectColumns(["Date", "Description", "Amount"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.amount).toBe(2);
  });

  it("detects debit/credit split columns", () => {
    const map = autoDetectColumns(["Txn Date", "Narration", "Debit", "Credit"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.debit).toBe(2);
    expect(map.credit).toBe(3);
    expect(map.amount).toBe(-1);
  });

  it("is case-insensitive", () => {
    const map = autoDetectColumns(["DATE", "MEMO", "WITHDRAWAL", "DEPOSIT"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.debit).toBe(2);
    expect(map.credit).toBe(3);
  });

  it("throws when date column is missing", () => {
    expect(() => autoDetectColumns(["Description", "Amount"])).toThrow(
      "Could not detect date column"
    );
  });

  it("throws when description column is missing", () => {
    expect(() => autoDetectColumns(["Date", "Amount"])).toThrow(
      "Could not detect description column"
    );
  });

  it("throws when no amount column of any kind", () => {
    expect(() => autoDetectColumns(["Date", "Description"])).toThrow(
      "Could not detect amount column"
    );
  });
});

// ─── normalizeAmount ──────────────────────────────────────────────────────────

describe("normalizeAmount", () => {
  it("parses plain positive number as CREDIT", () => {
    expect(normalizeAmount("1234.56")).toEqual({ amount: 1234.56, type: "CREDIT" });
  });

  it("strips currency symbol", () => {
    expect(normalizeAmount("$45.00")).toEqual({ amount: 45.00, type: "CREDIT" });
  });

  it("strips commas", () => {
    expect(normalizeAmount("1,234.56")).toEqual({ amount: 1234.56, type: "CREDIT" });
  });

  it("handles negative sign as DEBIT", () => {
    expect(normalizeAmount("-67.50")).toEqual({ amount: 67.50, type: "DEBIT" });
  });

  it("handles parentheses format as DEBIT", () => {
    expect(normalizeAmount("(123.00)")).toEqual({ amount: 123.00, type: "DEBIT" });
  });

  it("handles $-prefixed negative", () => {
    expect(normalizeAmount("$-99.99")).toEqual({ amount: 99.99, type: "DEBIT" });
  });

  it("throws on non-numeric input", () => {
    expect(() => normalizeAmount("not a number")).toThrow("Cannot parse amount");
  });
});

// ─── parseCsvBuffer ───────────────────────────────────────────────────────────

describe("parseCsvBuffer", () => {
  it("parses a simple single-amount CSV", () => {
    const csv = `Date,Description,Amount\n2026-05-01,Starbucks,$6.40\n2026-05-02,Salary,3200.00`;
    const buf = Buffer.from(csv);
    const map = autoDetectColumns(["Date", "Description", "Amount"]);
    const txns = parseCsvBuffer(buf, map);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "CREDIT" });
    expect(txns[1]).toMatchObject({ date: "2026-05-02", description: "Salary", amount: 3200.00, type: "CREDIT" });
  });

  it("parses debit/credit split columns", () => {
    const csv = `Date,Memo,Debit,Credit\n2026-05-01,Netflix,15.99,\n2026-05-02,Payroll,,3200.00`;
    const buf = Buffer.from(csv);
    const map = autoDetectColumns(["Date", "Memo", "Debit", "Credit"]);
    const txns = parseCsvBuffer(buf, map);
    expect(txns[0]).toMatchObject({ amount: 15.99, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ amount: 3200.00, type: "CREDIT" });
  });

  it("handles MM/DD/YYYY date format", () => {
    const csv = `Date,Description,Amount\n05/15/2026,Amazon,43.99`;
    const txns = parseCsvBuffer(Buffer.from(csv), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns[0].date).toBe("2026-05-15");
  });

  it("skips rows with missing date or description", () => {
    const csv = `Date,Description,Amount\n,Starbucks,6.40\n2026-05-01,,10.00\n2026-05-02,Valid,5.00`;
    const txns = parseCsvBuffer(Buffer.from(csv), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Valid");
  });

  it("returns empty array for header-only CSV", () => {
    const txns = parseCsvBuffer(Buffer.from("Date,Description,Amount"), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns).toHaveLength(0);
  });
});

// ─── levenshteinSimilarity ────────────────────────────────────────────────────

describe("levenshteinSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(levenshteinSimilarity("starbucks", "starbucks")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    const sim = levenshteinSimilarity("abc", "xyz");
    expect(sim).toBeLessThan(0.1);
  });

  it("returns high similarity for minor differences", () => {
    const sim = levenshteinSimilarity("SQ *STARBUCKS", "SQ *STARBUCKS #2");
    expect(sim).toBeGreaterThan(0.8);
  });
});

// ─── detectDuplicates ─────────────────────────────────────────────────────────

describe("detectDuplicates", () => {
  const existing = [
    { id: "ex-1", date: new Date("2026-05-01"), description: "Starbucks", amount: 6.40 },
    { id: "ex-2", date: new Date("2026-05-02"), description: "Netflix", amount: 15.99 },
  ];

  it("flags exact match as duplicate", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].existingId).toBe("ex-1");
  });

  it("flags fuzzy description match on same date+amount", () => {
    const incoming = [{ date: "2026-05-02", description: "NETFLIX.COM", amount: 15.99, type: "DEBIT" as const }];
    const { duplicates } = detectDuplicates(incoming, existing);
    expect(duplicates).toHaveLength(1);
  });

  it("does not flag same description on different date", () => {
    const incoming = [{ date: "2026-06-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });

  it("does not flag same date+description with different amount", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 7.00, type: "DEBIT" as const }];
    const { safe } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(1);
  });

  it("returns all safe when existing is empty", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, []);
    expect(safe).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});
