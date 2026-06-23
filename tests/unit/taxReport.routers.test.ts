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
        { category: "Business Revenue", _sum: { amount: new Prisma.Decimal("3000") }, _count: { id: 2 } },
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
