/**
 * taxReport router tests
 *
 * Tests get, availableYears, and sectionTransactions procedures via
 * createCallerFactory with fully mocked Prisma and tax/sections module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mocks (must be hoisted before imports) ───────────────────────────────────

vi.mock("@/lib/tax/sections", () => ({
  JURISDICTIONS: {
    PAK: {
      code: "PAK",
      name: "Pakistan",
      sections: [
        {
          id: "income",
          label: "Business Income",
          type: "income",
          reference: "Sec 18",
          categories: ["Salary", "Business Revenue"],
        },
        {
          id: "deductions",
          label: "Deductions",
          type: "deduction",
          reference: "Sec 60",
          categories: ["Rent", "Utilities"],
        },
      ],
      fiscalYearStart: (year: number) => new Date(year, 6, 1),
      fiscalYearEnd: (year: number) => new Date(year + 1, 5, 30),
    },
  },
  dateToFiscalYear: vi.fn().mockReturnValue(2024),
  getSection: vi.fn().mockReturnValue({
    id: "income",
    type: "income",
    categories: ["Salary", "Business Revenue"],
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
    organisation: {
      findFirst: vi.fn(),
    },
    statementTransaction: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    invoice: {
      aggregate: vi.fn(),
    },
    bill: {
      aggregate: vi.fn(),
    },
    invoiceLine: {
      groupBy: vi.fn(),
    },
    billLine: {
      groupBy: vi.fn(),
    },
    taxRegime: {
      findMany: vi.fn(),
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { Prisma } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { taxReportRouter } from "@/server/routers/taxReport";
import { db } from "@/lib/db";
import { getSection } from "@/lib/tax/sections";

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockOrgFindFirst = db.organisation.findFirst as ReturnType<typeof vi.fn>;
const mockGroupBy = db.statementTransaction.groupBy as ReturnType<typeof vi.fn>;
const mockAggregate = db.statementTransaction.aggregate as ReturnType<typeof vi.fn>;
const mockFindMany = db.statementTransaction.findMany as ReturnType<typeof vi.fn>;
const mockCount = db.statementTransaction.count as ReturnType<typeof vi.fn>;
const mockGetSection = getSection as ReturnType<typeof vi.fn>;

const mockInvoiceAggregate = db.invoice.aggregate as ReturnType<typeof vi.fn>;
const mockBillAggregate = db.bill.aggregate as ReturnType<typeof vi.fn>;
const mockInvoiceLineGroupBy = db.invoiceLine.groupBy as ReturnType<typeof vi.fn>;
const mockBillLineGroupBy = db.billLine.groupBy as ReturnType<typeof vi.fn>;
const mockTaxRegimeFindMany = db.taxRegime.findMany as ReturnType<typeof vi.fn>;

// ── Caller factory ────────────────────────────────────────────────────────────

const createCaller = createCallerFactory(taxReportRouter);

function makeCaller() {
  return createCaller({
    session: { user: { id: "user-1" } } as any,
    db: db as any,
    organisationId: "org-1",
  } as any);
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// taxReportRouter.get
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.get", () => {
  it("throws BAD_REQUEST when org has no taxJurisdiction", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: null });

    await expect(makeCaller().get({ fiscalYear: 2024 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tax jurisdiction not configured",
    });
  });

  it("throws BAD_REQUEST for unknown jurisdiction code", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "UNKNOWN_CODE" });

    await expect(makeCaller().get({ fiscalYear: 2024 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns report with sections, summary fields, and periodStart/periodEnd", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });

    // groupBy called twice (credits then debits)
    mockGroupBy
      .mockResolvedValueOnce([
        { category: "Salary", _sum: { amount: new Prisma.Decimal("5000") }, _count: { id: 3 } },
        {
          category: "Business Revenue",
          _sum: { amount: new Prisma.Decimal("3000") },
          _count: { id: 2 },
        },
      ])
      .mockResolvedValueOnce([
        { category: "Rent", _sum: { amount: new Prisma.Decimal("1200") }, _count: { id: 1 } },
        { category: "Utilities", _sum: { amount: new Prisma.Decimal("300") }, _count: { id: 1 } },
      ]);

    const result = await makeCaller().get({ fiscalYear: 2024 });

    expect(result.jurisdiction).toBe("PAK");
    expect(result.jurisdictionName).toBe("Pakistan");
    expect(result.fiscalYear).toBe(2024);
    expect(result.periodStart).toBe("2024-07-01");
    expect(result.periodEnd).toBe("2025-06-30");
    expect(result.summary).toMatchObject({
      totalIncome: 8000,
      totalDeductions: 1500,
      taxableIncome: 6500,
    });
    expect(result.sections).toHaveLength(2);
  });

  it("income section sums credits (CREDIT groupBy rows)", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });

    mockGroupBy
      .mockResolvedValueOnce([
        { category: "Salary", _sum: { amount: new Prisma.Decimal("4000") }, _count: { id: 2 } },
      ])
      .mockResolvedValueOnce([]);

    const result = await makeCaller().get({ fiscalYear: 2024 });
    const incomeSection = result.sections.find((s) => s.type === "income");
    expect(incomeSection?.total).toBe(4000);
  });

  it("deduction section sums debits (DEBIT groupBy rows)", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });

    mockGroupBy
      .mockResolvedValueOnce([]) // no credits
      .mockResolvedValueOnce([
        { category: "Rent", _sum: { amount: new Prisma.Decimal("900") }, _count: { id: 1 } },
      ]);

    const result = await makeCaller().get({ fiscalYear: 2024 });
    const deductionSection = result.sections.find((s) => s.type === "deduction");
    expect(deductionSection?.total).toBe(900);
  });

  it("returns zeroes for categories with no transactions", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });

    // No rows for any category
    mockGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await makeCaller().get({ fiscalYear: 2024 });
    expect(result.summary.totalIncome).toBe(0);
    expect(result.summary.totalDeductions).toBe(0);
    expect(result.summary.taxableIncome).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// taxReportRouter.availableYears
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.availableYears", () => {
  it("returns {years:[]} when org has no jurisdiction set", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: null });

    const result = await makeCaller().availableYears();
    expect(result).toEqual({ years: [] });
  });

  it("returns {years:[]} when no transactions exist", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockAggregate.mockResolvedValue({ _min: { date: null }, _max: { date: null } });

    const result = await makeCaller().availableYears();
    expect(result).toEqual({ years: [] });
  });

  it("returns array of fiscal years in descending order", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockAggregate.mockResolvedValue({
      _min: { date: new Date("2022-08-01") },
      _max: { date: new Date("2024-09-15") },
    });

    // dateToFiscalYear is mocked globally to return 2024; override for min call
    const { dateToFiscalYear } = await import("@/lib/tax/sections");
    const mockDtFY = dateToFiscalYear as ReturnType<typeof vi.fn>;
    // First call: min date → year 2022, second call: max date → 2024
    mockDtFY.mockReturnValueOnce(2022).mockReturnValueOnce(2024);

    const result = await makeCaller().availableYears();
    expect(result.years).toEqual([2024, 2023, 2022]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// taxReportRouter.sectionTransactions
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.sectionTransactions", () => {
  const baseInput = { fiscalYear: 2024, sectionId: "income", page: 1, pageSize: 10 };

  it("throws BAD_REQUEST when no jurisdiction is configured", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: null });

    await expect(makeCaller().sectionTransactions(baseInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tax jurisdiction not configured",
    });
  });

  it("throws BAD_REQUEST for unknown sectionId", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockGetSection.mockReturnValueOnce(null);

    await expect(
      makeCaller().sectionTransactions({ ...baseInput, sectionId: "bogus" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns paginated transactions with total and page info", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockGetSection.mockReturnValue({
      id: "income",
      type: "income",
      categories: ["Salary"],
    });

    const txns = [
      { id: "tx-1", category: "Salary", amount: "1000", date: new Date(), type: "CREDIT" },
      { id: "tx-2", category: "Salary", amount: "500", date: new Date(), type: "CREDIT" },
    ];
    mockFindMany.mockResolvedValue(txns);
    mockCount.mockResolvedValue(2);

    const result = await makeCaller().sectionTransactions(baseInput);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it("returns empty items when no transactions match", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockGetSection.mockReturnValue({
      id: "income",
      type: "income",
      categories: ["Salary"],
    });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const result = await makeCaller().sectionTransactions(baseInput);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("uses CREDIT type for income sections and DEBIT for deduction sections", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockGetSection.mockReturnValue({
      id: "deductions",
      type: "deduction",
      categories: ["Rent"],
    });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await makeCaller().sectionTransactions({
      ...baseInput,
      sectionId: "deductions",
    });

    const findManyCall = mockFindMany.mock.calls[0][0];
    expect(findManyCall.where.type).toBe("DEBIT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// taxReportRouter.salesTax   (sales tax for business accounting)
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.salesTax", () => {
  function lineGroup(
    taxRegimeId: string | null,
    taxRateCode: string | null,
    taxAmount: string,
    count: number
  ) {
    return {
      taxRegimeId,
      taxRateCode,
      _sum: { taxAmount: new Prisma.Decimal(taxAmount) },
      _count: { id: count },
    };
  }

  it("sums output/input tax, computes net, and enriches byRate with regime names", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockInvoiceAggregate.mockResolvedValue({
      _sum: { taxAmount: new Prisma.Decimal("100") },
      _count: { id: 2 },
    });
    mockBillAggregate.mockResolvedValue({
      _sum: { taxAmount: new Prisma.Decimal("40") },
      _count: { id: 1 },
    });
    mockInvoiceLineGroupBy.mockResolvedValue([
      lineGroup("regime-uk", "STANDARD", "60", 1),
      lineGroup("regime-eu", "REDUCED", "40", 1),
      lineGroup(null, null, "0", 1),
    ]);
    mockBillLineGroupBy.mockResolvedValue([
      lineGroup("regime-uk", "STANDARD", "25", 1),
      lineGroup("regime-eu", "ZERO", "15", 1),
    ]);
    mockTaxRegimeFindMany.mockResolvedValue([
      { id: "regime-uk", name: "UK VAT" },
      { id: "regime-eu", name: "EU VAT" },
    ]);

    const result = await makeCaller().salesTax({ fiscalYear: 2024 });

    expect(result.fiscalYear).toBe(2024);
    // PAK fiscal year: 1 Jul 2024 -> 30 Jun 2025
    expect(result.periodStart).toBe("2024-07-01");
    expect(result.periodEnd).toBe("2025-06-30");
    expect(result.summary).toEqual({
      outputTax: 100,
      inputTax: 40,
      netTaxPayable: 60,
      invoiceCount: 2,
      billCount: 1,
    });

    const byRate = result.byRate;
    // Sorted by net descending.
    expect(byRate[0].net).toBeGreaterThanOrEqual(byRate[byRate.length - 1].net);

    const ukStd = byRate.find((b) => b.regime === "UK VAT" && b.rateCode === "STANDARD");
    expect(ukStd).toMatchObject({ output: 60, input: 25, net: 35, invoiceCount: 1, billCount: 1 });

    const euReduced = byRate.find((b) => b.regime === "EU VAT" && b.rateCode === "REDUCED");
    expect(euReduced).toMatchObject({ output: 40, input: 0, net: 40 });

    // Null regime / null rate collapse into an "Unassigned" bucket with an em dash code.
    const unassigned = byRate.find((b) => b.regime === "Unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned?.rateCode).toBe("\u2014");
    expect(unassigned?.output).toBe(0);
  });

  it("falls back to a calendar year when no jurisdiction is configured", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: null });
    mockInvoiceAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockBillAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockInvoiceLineGroupBy.mockResolvedValue([]);
    mockBillLineGroupBy.mockResolvedValue([]);
    mockTaxRegimeFindMany.mockResolvedValue([]);

    const result = await makeCaller().salesTax({ fiscalYear: 2023 });

    expect(result.periodStart).toBe("2023-01-01");
    expect(result.periodEnd).toBe("2023-12-31");
    expect(result.summary).toEqual({
      outputTax: 0,
      inputTax: 0,
      netTaxPayable: 0,
      invoiceCount: 0,
      billCount: 0,
    });
    expect(result.byRate).toEqual([]);
  });

  it("treats a negative net as a refund and keeps per-rate buckets stable", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockInvoiceAggregate.mockResolvedValue({
      _sum: { taxAmount: new Prisma.Decimal("10") },
      _count: { id: 1 },
    });
    mockBillAggregate.mockResolvedValue({
      _sum: { taxAmount: new Prisma.Decimal("30") },
      _count: { id: 1 },
    });
    mockInvoiceLineGroupBy.mockResolvedValue([lineGroup("regime-a", "STANDARD", "10", 1)]);
    mockBillLineGroupBy.mockResolvedValue([lineGroup("regime-a", "STANDARD", "30", 1)]);
    mockTaxRegimeFindMany.mockResolvedValue([{ id: "regime-a", name: "Regime A" }]);

    const result = await makeCaller().salesTax({ fiscalYear: 2024 });

    expect(result.summary.netTaxPayable).toBe(-20);
    expect(result.byRate).toHaveLength(1);
    expect(result.byRate[0]).toMatchObject({
      regime: "Regime A",
      rateCode: "STANDARD",
      output: 10,
      input: 30,
      net: -20,
    });
  });

  it("excludes VOID invoices/bills from the period filter", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockInvoiceAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockBillAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockInvoiceLineGroupBy.mockResolvedValue([]);
    mockBillLineGroupBy.mockResolvedValue([]);
    mockTaxRegimeFindMany.mockResolvedValue([]);

    await makeCaller().salesTax({ fiscalYear: 2024 });

    const invoiceWhere = mockInvoiceAggregate.mock.calls[0][0].where;
    expect(invoiceWhere.status).toEqual({ not: "VOID" });
    expect(invoiceWhere.organisationId).toBe("org-1");

    const lineWhere = mockInvoiceLineGroupBy.mock.calls[0][0].where;
    expect(lineWhere.invoice.status).toEqual({ not: "VOID" });
  });

  it("falls back to a calendar-year window when the jurisdiction code is unknown", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "BOGUS" });
    mockInvoiceAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockBillAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockInvoiceLineGroupBy.mockResolvedValue([]);
    mockBillLineGroupBy.mockResolvedValue([]);
    mockTaxRegimeFindMany.mockResolvedValue([]);

    const result = await makeCaller().salesTax({ fiscalYear: 2021 });

    expect(result.periodStart).toBe("2021-01-01");
    expect(result.periodEnd).toBe("2021-12-31");
    expect(result.summary.outputTax).toBe(0);
    expect(result.byRate).toEqual([]);
  });

  it("labels a line whose regime is unmapped as 'Unassigned' and keeps its rate code", async () => {
    mockOrgFindFirst.mockResolvedValue({ taxJurisdiction: "PAK" });
    mockInvoiceAggregate.mockResolvedValue({
      _sum: { taxAmount: new Prisma.Decimal("10") },
      _count: { id: 1 },
    });
    mockBillAggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: { id: 0 } });
    mockInvoiceLineGroupBy.mockResolvedValue([lineGroup("regime-ghost", "STANDARD", "10", 1)]);
    mockBillLineGroupBy.mockResolvedValue([]);
    mockTaxRegimeFindMany.mockResolvedValue([{ id: "regime-uk", name: "UK VAT" }]);

    const result = await makeCaller().salesTax({ fiscalYear: 2024 });

    const bucket = result.byRate.find((b) => b.rateCode === "STANDARD");
    expect(bucket).toBeDefined();
    expect(bucket?.regime).toBe("Unassigned");
    expect(bucket?.rateCode).toBe("STANDARD");
    expect(bucket?.output).toBe(10);
  });
});
