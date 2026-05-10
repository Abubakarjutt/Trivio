import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProfitAndLoss, getBalanceSheet, getTrialBalance, getTaxSummary } from "@/server/services/report.service";
import { Prisma } from "@prisma/client";

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    journalLine: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null, credit: null } }),
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } }),
    },
    bill: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } }),
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ORG = "org-123";
const RANGE = { from: new Date("2026-01-01"), to: new Date("2026-01-31") };

// ─── getProfitAndLoss ─────────────────────────────────────────────────────────

describe("getProfitAndLoss", () => {
  it("returns zeros when no journal lines", async () => {
    const prisma = makePrisma();
    const result = await getProfitAndLoss(prisma, ORG, RANGE);
    expect(result.totalIncome.toNumber()).toBe(0);
    expect(result.totalExpenses.toNumber()).toBe(0);
    expect(result.netProfit.toNumber()).toBe(0);
    expect(result.accounts).toHaveLength(0);
  });

  it("correctly sums income (credit-normal)", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "inc-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(1000), account: { code: "4000", name: "Revenue", type: "INCOME" } },
          { accountId: "inc-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(500),  account: { code: "4000", name: "Revenue", type: "INCOME" } },
        ]),
      },
    });
    const result = await getProfitAndLoss(prisma, ORG, RANGE);
    expect(result.totalIncome.toNumber()).toBe(1500);
    expect(result.netProfit.toNumber()).toBe(1500);
    expect(result.accounts).toHaveLength(1);
  });

  it("correctly sums expenses (debit-normal)", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "exp-1", debit: new Prisma.Decimal(300), credit: new Prisma.Decimal(0), account: { code: "5000", name: "Rent", type: "EXPENSE" } },
          { accountId: "exp-2", debit: new Prisma.Decimal(200), credit: new Prisma.Decimal(0), account: { code: "5100", name: "Utilities", type: "EXPENSE" } },
        ]),
      },
    });
    const result = await getProfitAndLoss(prisma, ORG, RANGE);
    expect(result.totalExpenses.toNumber()).toBe(500);
    expect(result.netProfit.toNumber()).toBe(-500);
    expect(result.accounts).toHaveLength(2);
  });

  it("calculates net profit = income - expenses", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "inc-1", debit: new Prisma.Decimal(0),   credit: new Prisma.Decimal(2000), account: { code: "4000", name: "Revenue",    type: "INCOME"  } },
          { accountId: "exp-1", debit: new Prisma.Decimal(800), credit: new Prisma.Decimal(0),    account: { code: "5000", name: "Expenses",   type: "EXPENSE" } },
        ]),
      },
    });
    const result = await getProfitAndLoss(prisma, ORG, RANGE);
    expect(result.totalIncome.toNumber()).toBe(2000);
    expect(result.totalExpenses.toNumber()).toBe(800);
    expect(result.netProfit.toNumber()).toBe(1200);
  });

  it("aggregates multiple lines for same account", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "inc-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100), account: { code: "4000", name: "Revenue", type: "INCOME" } },
          { accountId: "inc-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(200), account: { code: "4000", name: "Revenue", type: "INCOME" } },
          { accountId: "inc-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(700), account: { code: "4000", name: "Revenue", type: "INCOME" } },
        ]),
      },
    });
    const result = await getProfitAndLoss(prisma, ORG, RANGE);
    expect(result.accounts).toHaveLength(1); // same accountId merged
    expect(result.totalIncome.toNumber()).toBe(1000);
  });
});

// ─── getBalanceSheet ──────────────────────────────────────────────────────────

describe("getBalanceSheet", () => {
  const AS_OF = new Date("2026-01-31");

  it("returns empty balance sheet when no data", async () => {
    const prisma = makePrisma();
    const result = await getBalanceSheet(prisma, ORG, AS_OF);
    expect(result.totalAssets.toNumber()).toBe(0);
    expect(result.totalLiabilities.toNumber()).toBe(0);
    expect(result.totalEquity.toNumber()).toBe(0);
  });

  it("correctly computes asset balance (debit-normal)", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "asset-1", debit: new Prisma.Decimal(5000), credit: new Prisma.Decimal(0),    account: { code: "1000", name: "Cash", type: "ASSET" } },
          { accountId: "asset-1", debit: new Prisma.Decimal(0),    credit: new Prisma.Decimal(1000), account: { code: "1000", name: "Cash", type: "ASSET" } },
        ]),
      },
    });
    const result = await getBalanceSheet(prisma, ORG, AS_OF);
    expect(result.totalAssets.toNumber()).toBe(4000); // 5000 - 1000
    expect(result.assets).toHaveLength(1);
  });

  it("correctly computes liability balance (credit-normal)", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "liab-1", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(3000), account: { code: "2000", name: "Accounts Payable", type: "LIABILITY" } },
        ]),
      },
    });
    const result = await getBalanceSheet(prisma, ORG, AS_OF);
    expect(result.totalLiabilities.toNumber()).toBe(3000);
    expect(result.liabilities).toHaveLength(1);
  });

  it("correctly separates assets, liabilities, equity", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "a", debit: new Prisma.Decimal(1000), credit: new Prisma.Decimal(0), account: { code: "1000", name: "Cash",    type: "ASSET"     } },
          { accountId: "l", debit: new Prisma.Decimal(0),    credit: new Prisma.Decimal(600),  account: { code: "2000", name: "Loans",   type: "LIABILITY" } },
          { accountId: "e", debit: new Prisma.Decimal(0),    credit: new Prisma.Decimal(400),  account: { code: "3000", name: "Equity",  type: "EQUITY"    } },
        ]),
      },
    });
    const result = await getBalanceSheet(prisma, ORG, AS_OF);
    expect(result.totalAssets.toNumber()).toBe(1000);
    expect(result.totalLiabilities.toNumber()).toBe(600);
    expect(result.totalEquity.toNumber()).toBe(400);
    // A = L + E → 1000 = 600 + 400 ✓
    expect(result.totalAssets.toNumber()).toBe(result.totalLiabilities.plus(result.totalEquity).toNumber());
  });
});

// ─── getTrialBalance ──────────────────────────────────────────────────────────

describe("getTrialBalance", () => {
  it("returns empty trial balance when no data", async () => {
    const prisma = makePrisma();
    const result = await getTrialBalance(prisma, ORG, RANGE);
    expect(result.totalDebits.toNumber()).toBe(0);
    expect(result.totalCredits.toNumber()).toBe(0);
    expect(result.accounts).toHaveLength(0);
  });

  it("trial balance totals debits = credits (accounting identity)", async () => {
    const prisma = makePrisma({
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "cash",   debit: new Prisma.Decimal(1000), credit: new Prisma.Decimal(0),    account: { code: "1000", name: "Cash",    type: "ASSET"   } },
          { accountId: "income", debit: new Prisma.Decimal(0),    credit: new Prisma.Decimal(1000), account: { code: "4000", name: "Revenue", type: "INCOME"  } },
        ]),
      },
    });
    const result = await getTrialBalance(prisma, ORG, RANGE);
    expect(result.totalDebits.toNumber()).toBe(result.totalCredits.toNumber());
    expect(result.totalDebits.toNumber()).toBe(1000);
  });
});

// ─── getTaxSummary ────────────────────────────────────────────────────────────

describe("getTaxSummary", () => {
  it("returns zeros when no invoices or bills", async () => {
    const prisma = makePrisma();
    const result = await getTaxSummary(prisma, ORG, RANGE);
    expect(result.outputTax.toNumber()).toBe(0);
    expect(result.inputTax.toNumber()).toBe(0);
    expect(result.netTaxPayable.toNumber()).toBe(0);
    expect(result.invoiceCount).toBe(0);
    expect(result.billCount).toBe(0);
  });

  it("correctly computes net tax payable = output - input", async () => {
    const prisma = makePrisma({
      invoice: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: new Prisma.Decimal(500) }, _count: { id: 3 } }),
      },
      bill: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: new Prisma.Decimal(200) }, _count: { id: 2 } }),
      },
    });
    const result = await getTaxSummary(prisma, ORG, RANGE);
    expect(result.outputTax.toNumber()).toBe(500);
    expect(result.inputTax.toNumber()).toBe(200);
    expect(result.netTaxPayable.toNumber()).toBe(300);
    expect(result.invoiceCount).toBe(3);
    expect(result.billCount).toBe(2);
  });

  it("net tax payable can be negative (input > output)", async () => {
    const prisma = makePrisma({
      invoice: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: new Prisma.Decimal(100) }, _count: { id: 1 } }),
      },
      bill: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { taxAmount: new Prisma.Decimal(400) }, _count: { id: 5 } }),
      },
    });
    const result = await getTaxSummary(prisma, ORG, RANGE);
    expect(result.netTaxPayable.toNumber()).toBe(-300);
  });
});
