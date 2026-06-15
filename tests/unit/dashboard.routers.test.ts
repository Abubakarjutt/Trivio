/**
 * Dashboard router tests
 *
 * Tests getKPIs, getIncomeExpenseTrend, getExpenseBreakdown,
 * getRecentTransactions, and getOutstandingInvoices via createCallerFactory
 * with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ── Mocks (must be hoisted before imports) ───────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
    journalLine: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    bill: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } }),
    },
    journalEntry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createCallerFactory } from "@/server/trpc";
import { dashboardRouter } from "@/server/routers/dashboard";
import { db } from "@/lib/db";

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockJournalLineFindMany = db.journalLine.findMany as ReturnType<typeof vi.fn>;
const mockInvoiceAggregate = db.invoice.aggregate as ReturnType<typeof vi.fn>;
const mockBillAggregate = db.bill.aggregate as ReturnType<typeof vi.fn>;
const mockJournalEntryFindMany = db.journalEntry.findMany as ReturnType<typeof vi.fn>;
const mockInvoiceFindMany = db.invoice.findMany as ReturnType<typeof vi.fn>;

// ── Caller factory ────────────────────────────────────────────────────────────

const createCaller = createCallerFactory(dashboardRouter);

function makeCaller() {
  return createCaller({
    session: { user: { id: "user-1" } } as any,
    db: db as any,
    organisationId: "org-1",
    organisation: { id: "org-1", name: "Test Org" } as any,
    user: { id: "user-1", organisationId: "org-1" } as any,
  } as any);
}

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// dashboardRouter.getKPIs
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboardRouter.getKPIs", () => {
  it("returns all 6 KPI fields", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);
    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    expect(result).toHaveProperty("monthlyIncome");
    expect(result).toHaveProperty("monthlyExpenses");
    expect(result).toHaveProperty("netProfit");
    expect(result).toHaveProperty("outstandingAR");
    expect(result).toHaveProperty("outstandingAP");
    expect(result).toHaveProperty("cashPosition");
  });

  it("returns '0.0000' for all fields when no data", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);
    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    expect(result.monthlyIncome).toBe("0.0000");
    expect(result.monthlyExpenses).toBe("0.0000");
    expect(result.netProfit).toBe("0.0000");
    expect(result.outstandingAR).toBe("0.0000");
    expect(result.outstandingAP).toBe("0.0000");
    expect(result.cashPosition).toBe("0.0000");
  });

  it("correctly computes income as credits minus debits (credit-normal)", async () => {
    // 3 income journal lines: two credits, one debit
    const incomeLines = [
      { debit: dec(0), credit: dec("3000") },
      { debit: dec("500"), credit: dec("0") },
      { debit: dec(0), credit: dec("1500") },
    ];

    // Return income lines on first call, empty for expenses/cash (calls 2 and 3)
    mockJournalLineFindMany
      .mockResolvedValueOnce(incomeLines) // income
      .mockResolvedValueOnce([])           // expenses
      .mockResolvedValueOnce([]);          // cash

    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    // income = 3000 - 500 + 1500 - 0 = 4000
    expect(result.monthlyIncome).toBe("4000.0000");
  });

  it("correctly computes expenses as debits minus credits (debit-normal)", async () => {
    const expenseLines = [
      { debit: dec("2000"), credit: dec("0") },
      { debit: dec("500"), credit: dec("200") },
    ];

    mockJournalLineFindMany
      .mockResolvedValueOnce([])          // income
      .mockResolvedValueOnce(expenseLines) // expenses
      .mockResolvedValueOnce([]);          // cash

    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    // expenses = (2000-0) + (500-200) = 2300
    expect(result.monthlyExpenses).toBe("2300.0000");
  });

  it("correctly computes netProfit = income - expenses", async () => {
    const incomeLines = [{ debit: dec(0), credit: dec("5000") }];
    const expenseLines = [{ debit: dec("2000"), credit: dec("0") }];

    mockJournalLineFindMany
      .mockResolvedValueOnce(incomeLines)
      .mockResolvedValueOnce(expenseLines)
      .mockResolvedValueOnce([]);

    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    expect(result.netProfit).toBe("3000.0000");
  });

  it("computes AR as totalAmount minus amountPaid", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);
    mockInvoiceAggregate.mockResolvedValue({
      _sum: { totalAmount: dec("10000"), amountPaid: dec("3000") },
    });
    mockBillAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });

    const result = await makeCaller().getKPIs();

    expect(result.outstandingAR).toBe("7000.0000");
  });

  it("computes AP as totalAmount minus amountPaid", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);
    mockInvoiceAggregate.mockResolvedValue({ _sum: { totalAmount: null, amountPaid: null } });
    mockBillAggregate.mockResolvedValue({
      _sum: { totalAmount: dec("4000"), amountPaid: dec("1000") },
    });

    const result = await makeCaller().getKPIs();

    expect(result.outstandingAP).toBe("3000.0000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dashboardRouter.getIncomeExpenseTrend
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboardRouter.getIncomeExpenseTrend", () => {
  it("returns exactly 12 months of data", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);

    const result = await makeCaller().getIncomeExpenseTrend();

    expect(result).toHaveLength(12);
  });

  it("each item has month (YYYY-MM format), income, and expenses strings", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);

    const result = await makeCaller().getIncomeExpenseTrend();

    for (const item of result) {
      expect(item).toHaveProperty("month");
      expect(item).toHaveProperty("income");
      expect(item).toHaveProperty("expenses");
      // month must match YYYY-MM
      expect(item.month).toMatch(/^\d{4}-\d{2}$/);
      // income and expenses must be numeric strings
      expect(() => parseFloat(item.income)).not.toThrow();
      expect(() => parseFloat(item.expenses)).not.toThrow();
    }
  });

  it("months are ordered chronologically oldest to newest", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);

    const result = await makeCaller().getIncomeExpenseTrend();
    const months = result.map((r) => r.month);

    // Each consecutive month should be >= previous
    for (let i = 1; i < months.length; i++) {
      expect(months[i] >= months[i - 1]).toBe(true);
    }
  });

  it("aggregates income lines into correct month buckets", async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based

    // A journal line with a date in the current month
    const dateInCurrentMonth = new Date(currentYear, currentMonth, 15);
    const incomeLines = [
      {
        debit: dec(0),
        credit: dec("1000"),
        journalEntry: { date: dateInCurrentMonth },
      },
    ];

    mockJournalLineFindMany
      .mockResolvedValueOnce(incomeLines) // income
      .mockResolvedValueOnce([]);          // expenses

    const result = await makeCaller().getIncomeExpenseTrend();
    const currentLabel = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
    const currentMonthItem = result.find((r) => r.month === currentLabel);

    expect(currentMonthItem).toBeDefined();
    expect(currentMonthItem!.income).toBe("1000.0000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dashboardRouter.getExpenseBreakdown
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboardRouter.getExpenseBreakdown", () => {
  it("returns empty array when no expense lines", async () => {
    mockJournalLineFindMany.mockResolvedValue([]);

    const result = await makeCaller().getExpenseBreakdown();

    expect(result).toEqual([]);
  });

  it("returns categories sorted by total descending", async () => {
    const lines = [
      { debit: dec("200"), credit: dec(0), account: { name: "Utilities" } },
      { debit: dec("1000"), credit: dec(0), account: { name: "Rent" } },
      { debit: dec("500"), credit: dec(0), account: { name: "Salaries" } },
    ];
    mockJournalLineFindMany.mockResolvedValue(lines);

    const result = await makeCaller().getExpenseBreakdown();

    expect(result[0].name).toBe("Rent");
    expect(result[1].name).toBe("Salaries");
    expect(result[2].name).toBe("Utilities");
  });

  it("returns at most 6 categories", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      debit: dec(String((10 - i) * 100)),
      credit: dec(0),
      account: { name: `Category ${i}` },
    }));
    mockJournalLineFindMany.mockResolvedValue(lines);

    const result = await makeCaller().getExpenseBreakdown();

    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("aggregates multiple lines for the same account", async () => {
    const lines = [
      { debit: dec("300"), credit: dec(0), account: { name: "Rent" } },
      { debit: dec("400"), credit: dec(0), account: { name: "Rent" } },
    ];
    mockJournalLineFindMany.mockResolvedValue(lines);

    const result = await makeCaller().getExpenseBreakdown();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Rent");
    expect(result[0].total).toBe("700.0000");
  });

  it("each item has name and total string", async () => {
    mockJournalLineFindMany.mockResolvedValue([
      { debit: dec("100"), credit: dec(0), account: { name: "Office" } },
    ]);

    const result = await makeCaller().getExpenseBreakdown();

    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("total");
    expect(typeof result[0].total).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dashboardRouter.getRecentTransactions
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboardRouter.getRecentTransactions", () => {
  it("returns up to 10 entries", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `je-${i}`,
      date: new Date(),
      description: `Entry ${i}`,
      source: "MANUAL" as const,
      lines: [],
    }));
    mockJournalEntryFindMany.mockResolvedValue(entries);

    const result = await makeCaller().getRecentTransactions();

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("returns entries with id, date, description, source, totalDebit fields", async () => {
    const entry = {
      id: "je-1",
      date: new Date("2024-06-01T00:00:00.000Z"),
      description: "Test entry",
      source: "IMPORT",
      lines: [{ debit: dec("500") }, { debit: dec("300") }],
    };
    mockJournalEntryFindMany.mockResolvedValue([entry]);

    const result = await makeCaller().getRecentTransactions();

    expect(result[0]).toMatchObject({
      id: "je-1",
      description: "Test entry",
      source: "IMPORT",
    });
    expect(result[0]).toHaveProperty("date");
    expect(result[0]).toHaveProperty("totalDebit");
  });

  it("computes totalDebit as sum of debit lines", async () => {
    const entry = {
      id: "je-2",
      date: new Date(),
      description: "Debit sum test",
      source: "MANUAL",
      lines: [
        { debit: dec("1000") },
        { debit: dec("500") },
        { debit: null },
      ],
    };
    mockJournalEntryFindMany.mockResolvedValue([entry]);

    const result = await makeCaller().getRecentTransactions();

    expect(result[0].totalDebit).toBe("1500.0000");
  });

  it("returns empty array when no entries", async () => {
    mockJournalEntryFindMany.mockResolvedValue([]);

    const result = await makeCaller().getRecentTransactions();

    expect(result).toEqual([]);
  });

  it("date is serialised as ISO string", async () => {
    const isoDate = "2024-03-15T00:00:00.000Z";
    const entry = {
      id: "je-3",
      date: new Date(isoDate),
      description: "Date test",
      source: "MANUAL",
      lines: [],
    };
    mockJournalEntryFindMany.mockResolvedValue([entry]);

    const result = await makeCaller().getRecentTransactions();

    expect(result[0].date).toBe(isoDate);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dashboardRouter.getOutstandingInvoices
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboardRouter.getOutstandingInvoices", () => {
  it("returns empty array when no outstanding invoices", async () => {
    mockInvoiceFindMany.mockResolvedValue([]);

    const result = await makeCaller().getOutstandingInvoices();

    expect(result).toEqual([]);
  });

  it("returns open invoices with amountDue = totalAmount - amountPaid", async () => {
    const invoice = {
      id: "inv-1",
      number: "INV-001",
      status: "SENT",
      totalAmount: dec("5000"),
      amountPaid: dec("1500"),
      dueDate: new Date("2024-07-31T00:00:00.000Z"),
      contact: { name: "Acme Corp" },
    };
    mockInvoiceFindMany.mockResolvedValue([invoice]);

    const result = await makeCaller().getOutstandingInvoices();

    expect(result[0].amountDue).toBe("3500.0000");
  });

  it("each invoice has id, number, contactName, dueDate, amountDue, status", async () => {
    const invoice = {
      id: "inv-2",
      number: "INV-002",
      status: "OVERDUE",
      totalAmount: dec("2000"),
      amountPaid: dec("0"),
      dueDate: new Date("2024-05-01T00:00:00.000Z"),
      contact: { name: "Beta LLC" },
    };
    mockInvoiceFindMany.mockResolvedValue([invoice]);

    const result = await makeCaller().getOutstandingInvoices();

    expect(result[0]).toMatchObject({
      id: "inv-2",
      number: "INV-002",
      contactName: "Beta LLC",
      status: "OVERDUE",
    });
    expect(result[0]).toHaveProperty("dueDate");
    expect(result[0]).toHaveProperty("amountDue");
  });

  it("returns amountDue as a fixed-4 decimal string", async () => {
    const invoice = {
      id: "inv-3",
      number: "INV-003",
      status: "PARTIAL",
      totalAmount: dec("1000.5"),
      amountPaid: dec("250.25"),
      dueDate: new Date(),
      contact: { name: "Gamma Inc" },
    };
    mockInvoiceFindMany.mockResolvedValue([invoice]);

    const result = await makeCaller().getOutstandingInvoices();

    expect(result[0].amountDue).toBe("750.2500");
    expect(typeof result[0].amountDue).toBe("string");
  });
});
