import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  buildIncomeEntry,
  buildExpenseEntry,
  type JournalLineInput,
} from "@/server/services/accounting.service";

// ─── Balance invariant helper (mirrors AccountingService internals) ─────────

function assertBalanced(lines: JournalLineInput[]): void {
  const totalDebits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  const diff = Math.abs(totalDebits - totalCredits);
  if (diff > 0.0001) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unbalanced: debits ${totalDebits} ≠ credits ${totalCredits}`,
    });
  }
}

// ─── Balance validation ──────────────────────────────────────────────────────

describe("Double-entry balance validation", () => {
  it("accepts a perfectly balanced entry", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 500 },
      { accountId: "acc-2", credit: 500 },
    ];
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it("rejects when debits exceed credits", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 600 },
      { accountId: "acc-2", credit: 500 },
    ];
    expect(() => assertBalanced(lines)).toThrow(TRPCError);
  });

  it("rejects when credits exceed debits", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 400 },
      { accountId: "acc-2", credit: 500 },
    ];
    expect(() => assertBalanced(lines)).toThrow(TRPCError);
  });

  it("accepts multi-line balanced entry", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 1000 },
      { accountId: "acc-2", credit: 600 },
      { accountId: "acc-3", credit: 400 },
    ];
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it("accepts entries balanced to sub-cent precision", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 33.333 },
      { accountId: "acc-2", credit: 33.333 },
    ];
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it("rejects if imbalance is exactly 0.01", () => {
    const lines: JournalLineInput[] = [
      { accountId: "acc-1", debit: 100.01 },
      { accountId: "acc-2", credit: 100.00 },
    ];
    expect(() => assertBalanced(lines)).toThrow(TRPCError);
  });
});

// ─── buildIncomeEntry ────────────────────────────────────────────────────────

describe("buildIncomeEntry", () => {
  const base = {
    date: new Date("2026-01-15"),
    description: "Client payment",
    amount: 1000,
    incomeAccountId: "income-acc",
    cashAccountId: "cash-acc",
  };

  it("debits cash and credits income for basic income", () => {
    const entry = buildIncomeEntry(base);
    expect(entry.lines).toHaveLength(2);
    const cashLine = entry.lines.find((l) => l.accountId === "cash-acc");
    const incomeLine = entry.lines.find((l) => l.accountId === "income-acc");
    expect(cashLine?.debit).toBe(1000);
    expect(incomeLine?.credit).toBe(1000);
  });

  it("entry is balanced without tax", () => {
    const entry = buildIncomeEntry(base);
    expect(() => assertBalanced(entry.lines)).not.toThrow();
  });

  it("includes tax lines and remains balanced", () => {
    const entry = buildIncomeEntry({ ...base, taxAmount: 200, taxAccountId: "tax-acc" });
    expect(entry.lines).toHaveLength(3);
    // Cash debit should include tax
    const cashLine = entry.lines.find((l) => l.accountId === "cash-acc");
    expect(cashLine?.debit).toBe(1200);
    // Income credit = net amount
    const incomeLine = entry.lines.find((l) => l.accountId === "income-acc");
    expect(incomeLine?.credit).toBe(1000);
    // Tax credit
    const taxLine = entry.lines.find((l) => l.accountId === "tax-acc");
    expect(taxLine?.credit).toBe(200);
    expect(() => assertBalanced(entry.lines)).not.toThrow();
  });
});

// ─── buildExpenseEntry ───────────────────────────────────────────────────────

describe("buildExpenseEntry", () => {
  const base = {
    date: new Date("2026-02-01"),
    description: "Office supplies",
    amount: 250,
    expenseAccountId: "expense-acc",
    cashAccountId: "cash-acc",
  };

  it("debits expense and credits cash for basic expense", () => {
    const entry = buildExpenseEntry(base);
    expect(entry.lines).toHaveLength(2);
    const expenseLine = entry.lines.find((l) => l.accountId === "expense-acc");
    const cashLine = entry.lines.find((l) => l.accountId === "cash-acc");
    expect(expenseLine?.debit).toBe(250);
    expect(cashLine?.credit).toBe(250);
  });

  it("entry is balanced without tax", () => {
    const entry = buildExpenseEntry(base);
    expect(() => assertBalanced(entry.lines)).not.toThrow();
  });

  it("includes input tax and remains balanced", () => {
    const entry = buildExpenseEntry({ ...base, taxAmount: 50, taxAccountId: "tax-input-acc" });
    expect(entry.lines).toHaveLength(3);
    const cashLine = entry.lines.find((l) => l.accountId === "cash-acc");
    expect(cashLine?.credit).toBe(300); // 250 + 50 tax
    expect(() => assertBalanced(entry.lines)).not.toThrow();
  });
});

// ─── Reversal / void logic ───────────────────────────────────────────────────

describe("Void / reversal entry construction", () => {
  const original: JournalLineInput[] = [
    { accountId: "cash", debit: 500 },
    { accountId: "income", credit: 500 },
  ];

  function buildReversal(lines: JournalLineInput[]): JournalLineInput[] {
    return lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
    }));
  }

  it("reversal swaps debit and credit on each line", () => {
    const reversal = buildReversal(original);
    expect(reversal.find((l) => l.accountId === "cash")?.credit).toBe(500);
    expect(reversal.find((l) => l.accountId === "income")?.debit).toBe(500);
  });

  it("reversal is balanced", () => {
    const reversal = buildReversal(original);
    expect(() => assertBalanced(reversal)).not.toThrow();
  });

  it("original + reversal net to zero", () => {
    const reversal = buildReversal(original);
    const allLines = [...original, ...reversal];
    const totalDebits = allLines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredits = allLines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits).toBe(1000); // 500 original + 500 reversal each side
  });
});

// ─── Account balance calculation ─────────────────────────────────────────────

describe("Account balance calculation", () => {
  type TestLine = { debit?: number; credit?: number };

  function calcBalance(lines: TestLine[], normalBalance: "DEBIT" | "CREDIT"): number {
    const totalDebits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    return normalBalance === "DEBIT" ? totalDebits - totalCredits : totalCredits - totalDebits;
  }

  it("asset account with more debits shows positive balance", () => {
    const lines = [{ debit: 1000 }, { credit: 200 }];
    expect(calcBalance(lines, "DEBIT")).toBe(800);
  });

  it("income account with more credits shows positive balance", () => {
    const lines = [{ credit: 5000 }, { debit: 100 }];
    expect(calcBalance(lines, "CREDIT")).toBe(4900);
  });

  it("expense account accumulates debits", () => {
    const lines = [{ debit: 300 }, { debit: 150 }, { credit: 50 }];
    expect(calcBalance(lines, "DEBIT")).toBe(400);
  });

  it("liability account shows positive balance when credited", () => {
    const lines = [{ credit: 2000 }, { debit: 500 }];
    expect(calcBalance(lines, "CREDIT")).toBe(1500);
  });
});
