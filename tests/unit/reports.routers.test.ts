/**
 * reports router unit tests
 *
 * Tests the reportsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked report service — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Minimal stand-in for a Decimal value — only .toFixed() is used by the router. */
function dec(value: string) {
  return { toFixed: (dp: number) => Number(value).toFixed(dp) };
}

// vi.mock is hoisted — must use literals in factory
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

vi.mock("@/server/services/report.service", () => ({
  getProfitAndLoss: vi.fn().mockResolvedValue({
    accounts: [
      { code: "4000", name: "Revenue", type: "INCOME", total: dec("1000.0000") },
      { code: "6000", name: "Rent", type: "EXPENSE", total: dec("500.0000") },
    ],
    totalIncome: dec("1000.0000"),
    totalExpenses: dec("500.0000"),
    netProfit: dec("500.0000"),
  }),
  getBalanceSheet: vi.fn().mockResolvedValue({
    assets: [{ code: "1000", name: "Cash", type: "ASSET", total: dec("5000.0000") }],
    liabilities: [{ code: "2000", name: "Loan", type: "LIABILITY", total: dec("2000.0000") }],
    equity: [{ code: "3000", name: "Capital", type: "EQUITY", total: dec("3000.0000") }],
    totalAssets: dec("5000.0000"),
    totalLiabilities: dec("2000.0000"),
    totalEquity: dec("3000.0000"),
  }),
  getTrialBalance: vi.fn().mockResolvedValue({
    accounts: [
      {
        code: "1000",
        name: "Cash",
        type: "ASSET",
        totalDebit: dec("5000.0000"),
        totalCredit: dec("2000.0000"),
        balance: dec("3000.0000"),
      },
    ],
    totalDebits: dec("5000.0000"),
    totalCredits: dec("5000.0000"),
  }),
  getTaxSummary: vi.fn().mockResolvedValue({
    outputTax: dec("150.0000"),
    inputTax: dec("75.0000"),
    netTaxPayable: dec("75.0000"),
    invoiceCount: 10,
    billCount: 5,
  }),
}));

import { createCallerFactory } from "@/server/trpc";
import { reportsRouter } from "@/server/routers/reports";
import {
  getProfitAndLoss,
  getBalanceSheet,
  getTrialBalance,
  getTaxSummary,
} from "@/server/services/report.service";

const ORG = "org-1";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID, email: "u@test.com" } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(reportsRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── profitAndLoss ────────────────────────────────────────────────────────────

describe("reports.profitAndLoss", () => {
  it("returns accounts with total serialised to 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].total).toBe("1000.0000");
    expect(result.accounts[1].total).toBe("500.0000");
  });

  it("returns totalIncome as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.totalIncome).toBe("1000.0000");
  });

  it("returns totalExpenses as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.totalExpenses).toBe("500.0000");
  });

  it("returns netProfit as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.netProfit).toBe("500.0000");
  });

  it("calls getProfitAndLoss with correct Date objects parsed from ISO strings", async () => {
    const caller = createCaller(makeCtx());
    await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(getProfitAndLoss).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      {
        from: new Date("2026-01-01"),
        to: new Date("2026-12-31"),
      }
    );
  });

  it("passes organisationId to service", async () => {
    const caller = createCaller(makeCtx());
    await caller.profitAndLoss({ from: "2026-06-01", to: "2026-06-30" });
    expect(getProfitAndLoss).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.anything()
    );
  });

  it("preserves account metadata (code, name, type)", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.profitAndLoss({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.accounts[0].code).toBe("4000");
    expect(result.accounts[0].name).toBe("Revenue");
    expect(result.accounts[0].type).toBe("INCOME");
  });
});

// ─── balanceSheet ─────────────────────────────────────────────────────────────

describe("reports.balanceSheet", () => {
  it("returns assets with total serialised to 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.balanceSheet({ asOf: "2026-12-31" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].total).toBe("5000.0000");
  });

  it("returns liabilities with total serialised to 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.balanceSheet({ asOf: "2026-12-31" });
    expect(result.liabilities[0].total).toBe("2000.0000");
  });

  it("returns equity with total serialised to 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.balanceSheet({ asOf: "2026-12-31" });
    expect(result.equity[0].total).toBe("3000.0000");
  });

  it("returns totalAssets, totalLiabilities, totalEquity as strings", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.balanceSheet({ asOf: "2026-12-31" });
    expect(result.totalAssets).toBe("5000.0000");
    expect(result.totalLiabilities).toBe("2000.0000");
    expect(result.totalEquity).toBe("3000.0000");
  });

  it("calls getBalanceSheet with correct Date object parsed from ISO string", async () => {
    const caller = createCaller(makeCtx());
    await caller.balanceSheet({ asOf: "2026-06-30" });
    expect(getBalanceSheet).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      new Date("2026-06-30")
    );
  });

  it("passes organisationId to getBalanceSheet", async () => {
    const caller = createCaller(makeCtx());
    await caller.balanceSheet({ asOf: "2026-12-31" });
    expect(getBalanceSheet).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.any(Date)
    );
  });
});

// ─── trialBalance ─────────────────────────────────────────────────────────────

describe("reports.trialBalance", () => {
  it("returns accounts with totalDebit and totalCredit as 4-decimal strings", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].totalDebit).toBe("5000.0000");
    expect(result.accounts[0].totalCredit).toBe("2000.0000");
  });

  it("returns accounts with balance as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.accounts[0].balance).toBe("3000.0000");
  });

  it("returns totalDebits and totalCredits as 4-decimal strings", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.totalDebits).toBe("5000.0000");
    expect(result.totalCredits).toBe("5000.0000");
  });

  it("calls getTrialBalance with correct Date objects", async () => {
    const caller = createCaller(makeCtx());
    await caller.trialBalance({ from: "2026-03-01", to: "2026-03-31" });
    expect(getTrialBalance).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      {
        from: new Date("2026-03-01"),
        to: new Date("2026-03-31"),
      }
    );
  });

  it("passes organisationId to getTrialBalance", async () => {
    const caller = createCaller(makeCtx());
    await caller.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    expect(getTrialBalance).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.anything()
    );
  });
});

// ─── taxSummary ───────────────────────────────────────────────────────────────

describe("reports.taxSummary", () => {
  it("returns outputTax as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.taxSummary({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.outputTax).toBe("150.0000");
  });

  it("returns inputTax as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.taxSummary({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.inputTax).toBe("75.0000");
  });

  it("returns netTaxPayable as 4-decimal string", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.taxSummary({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.netTaxPayable).toBe("75.0000");
  });

  it("returns invoiceCount and billCount as numbers", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.taxSummary({ from: "2026-01-01", to: "2026-12-31" });
    expect(result.invoiceCount).toBe(10);
    expect(result.billCount).toBe(5);
  });

  it("calls getTaxSummary with correct Date objects", async () => {
    const caller = createCaller(makeCtx());
    await caller.taxSummary({ from: "2026-04-01", to: "2026-06-30" });
    expect(getTaxSummary).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      {
        from: new Date("2026-04-01"),
        to: new Date("2026-06-30"),
      }
    );
  });

  it("passes organisationId to getTaxSummary", async () => {
    const caller = createCaller(makeCtx());
    await caller.taxSummary({ from: "2026-01-01", to: "2026-12-31" });
    expect(getTaxSummary).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.anything()
    );
  });
});
