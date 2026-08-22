/**
 * Integration tests for the tax-report module (server/routers/taxReport.ts).
 *
 * These run against the real PostgreSQL database and exercise the FULL stack:
 * real Prisma writes → real tRPC orgProcedure (which looks up the user's org)
 * → real JURISDICTIONS config from lib/tax/sections.
 *
 * Coverage:
 *  - Income tax (personal finance): get / availableYears / sectionTransactions
 *      * income section sums CREDITs, deduction section sums DEBITs
 *      * taxableIncome = income − deductions
 *      * availableYears spans the real transaction range in descending order
 *      * sectionTransactions paginates real rows and is period-scoped
 *      * get throws BAD_REQUEST when the org has no jurisdiction
 *  - Sales tax (business accounting): salesTax
 *      * output tax = Σ invoice taxAmount, input tax = Σ bill taxAmount
 *      * netTaxPayable = output − input, VOID invoices/bills excluded
 *      * byRate per-rate breakdown enriched with regime names, sorted by net desc
 *      * no-jurisdiction fallback uses a calendar-year window
 *
 * Requires the dev database:
 *   docker compose up -d
 * Run via:  npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type StatementTransactionType } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { taxReportRouter } from "@/server/routers/taxReport";

const db = new PrismaClient();

// ── Shared test state ─────────────────────────────────────────────────────────

const RUN = Date.now();
const FISCAL_YEAR = 2024; // USA = calendar year

let orgId: string; // main org: jurisdiction "USA" + a sales-tax regime
let userId: string;

let noJurOrgId: string; // org with no jurisdiction (calendar-year fallback)
let noJurUserId: string;

let regimeId: string;
let customerId: string;
let supplierId: string;

function makeCaller(userOrgId: string, callerUserId: string) {
  return createCallerFactory(taxReportRouter)({
    session: {
      user: { id: callerUserId, email: "x@x.com", name: "X" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    db,
    organisationId: userOrgId,
  } as never);
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function createBatch(org: string, filename: string) {
  return db.statementImportBatch.create({
    data: { organisationId: org, filename, fileType: "CSV", status: "DONE", transactionCount: 0 },
  });
}

async function createTxns(
  org: string,
  batchId: string,
  rows: Array<{ date: string; type: StatementTransactionType; category: string; amount: number }>
) {
  await db.statementTransaction.createMany({
    data: rows.map((r) => ({
      organisationId: org,
      importBatchId: batchId,
      date: new Date(r.date),
      description: `${r.category} @ ${r.date}`,
      merchantName: r.category,
      amount: r.amount,
      type: r.type,
      category: r.category,
      mccCode: "0000",
      mccLabel: "Uncategorized",
    })),
  });
}

async function createInvoice(
  org: string,
  contactId: string,
  number: string,
  opts: {
    date: string;
    status: "PAID" | "VOID";
    lines: Array<{ code: string; tax: number; unitPrice?: number }>;
  }
) {
  const taxTotal = opts.lines.reduce((s, l) => s + l.tax, 0);
  return db.invoice.create({
    data: {
      organisationId: org,
      contactId,
      number,
      date: new Date(opts.date),
      dueDate: new Date(opts.date),
      status: opts.status,
      subtotal: 100,
      taxAmount: taxTotal,
      totalAmount: 100 + taxTotal,
      amountPaid: 100 + taxTotal,
      lines: {
        create: opts.lines.map((l, i) => ({
          description: `line ${i + 1}`,
          quantity: 1,
          unitPrice: l.unitPrice ?? 100,
          amount: 100,
          taxRegimeId: regimeId,
          taxRateCode: l.code,
          taxAmount: l.tax,
          sortOrder: i,
        })),
      },
    },
    select: { id: true },
  });
}

async function createBill(
  org: string,
  contactId: string,
  number: string,
  opts: {
    date: string;
    status: "PAID" | "VOID";
    lines: Array<{ code: string; tax: number; unitPrice?: number }>;
  }
) {
  const taxTotal = opts.lines.reduce((s, l) => s + l.tax, 0);
  return db.bill.create({
    data: {
      organisationId: org,
      contactId,
      number,
      date: new Date(opts.date),
      dueDate: new Date(opts.date),
      status: opts.status,
      subtotal: 100,
      taxAmount: taxTotal,
      totalAmount: 100 + taxTotal,
      amountPaid: 100 + taxTotal,
      lines: {
        create: opts.lines.map((l, i) => ({
          description: `bill line ${i + 1}`,
          quantity: 1,
          unitPrice: l.unitPrice ?? 100,
          amount: 100,
          taxRegimeId: regimeId,
          taxRateCode: l.code,
          taxAmount: l.tax,
          sortOrder: i,
        })),
      },
    },
    select: { id: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Sales-tax regime (used for per-rate breakdown + name enrichment).
  const regime = await db.taxRegime.create({
    data: {
      code: `TEST_SALES_TAX_${RUN}`,
      name: "Test Sales Tax",
      country: "TEST",
      rates: {
        create: [
          { code: "STANDARD", name: "Standard (8.75%)", rate: 0.0875 },
          { code: "REDUCED", name: "Reduced (4%)", rate: 0.04 },
        ],
      },
    },
    select: { id: true },
  });
  regimeId = regime.id;

  // Main org — USA jurisdiction + the sales-tax regime.
  const org = await db.organisation.create({
    data: {
      name: "Tax Integration Org",
      currency: "USD",
      taxJurisdiction: "USA",
      taxRegimeId: regimeId,
    },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: { email: `tax-int-${RUN}@test.example`, hashedPassword: "x", organisationId: orgId },
  });
  userId = user.id;

  const cust = await db.contact.create({
    data: { organisationId: orgId, type: "CUSTOMER", name: "Acme Customer" },
  });
  customerId = cust.id;
  const supp = await db.contact.create({
    data: { organisationId: orgId, type: "SUPPLIER", name: "Beta Supplier" },
  });
  supplierId = supp.id;

  // Income tax (PF) — statement transactions in FY2024 (calendar year).
  const batch = await createBatch(orgId, `income-${RUN}.csv`);
  await createTxns(orgId, batch.id, [
    { date: "2024-01-15", type: "CREDIT", category: "Salary & Employment", amount: 8000 },
    { date: "2024-06-20", type: "CREDIT", category: "Freelance & Services", amount: 3000 },
    { date: "2024-02-10", type: "DEBIT", category: "Office Supplies", amount: 1000 },
    { date: "2024-03-10", type: "DEBIT", category: "Software & Subscriptions", amount: 500 },
  ]);
  // A prior-year transaction so availableYears spans two fiscal years.
  await createTxns(orgId, batch.id, [
    { date: "2023-03-10", type: "CREDIT", category: "Salary & Employment", amount: 2000 },
  ]);

  // Sales tax (business) — invoices/bills in FY2024 + a VOID invoice to exclude.
  await createInvoice(orgId, customerId, `INV-${RUN}-1`, {
    date: "2024-05-01",
    status: "PAID",
    lines: [
      { code: "STANDARD", tax: 10 },
      { code: "REDUCED", tax: 5 },
    ],
  });
  await createBill(orgId, supplierId, `BILL-${RUN}-1`, {
    date: "2024-05-10",
    status: "PAID",
    lines: [{ code: "STANDARD", tax: 4 }],
  });
  await createInvoice(orgId, customerId, `INV-${RUN}-VOID`, {
    date: "2024-05-01",
    status: "VOID",
    lines: [{ code: "STANDARD", tax: 999 }],
  });

  // No-jurisdiction org (calendar-year fallback) with one invoice in FY2023.
  const noJur = await db.organisation.create({ data: { name: "No Jur Org", currency: "USD" } });
  noJurOrgId = noJur.id;
  const noJurUser = await db.user.create({
    data: { email: `tax-nj-${RUN}@test.example`, hashedPassword: "x", organisationId: noJurOrgId },
  });
  noJurUserId = noJurUser.id;
  await createInvoice(noJurOrgId, customerId, `INV-${RUN}-NJ`, {
    date: "2023-06-01",
    status: "PAID",
    lines: [{ code: "STANDARD", tax: 7 }],
  });
});

afterAll(async () => {
  const orgs = [orgId, noJurOrgId];
  await db.statementTransaction.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.statementImportBatch.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.invoice.deleteMany({ where: { organisationId: { in: orgs } } }); // cascades invoiceLine
  await db.bill.deleteMany({ where: { organisationId: { in: orgs } } }); // cascades billLine
  await db.contact.deleteMany({ where: { organisationId: { in: orgs } } });
  await db.user.deleteMany({ where: { organisationId: { in: orgs } } });
  // Break the org → regime FK before deleting the regime.
  await db.organisation.updateMany({
    where: { taxRegimeId: regimeId },
    data: { taxRegimeId: null },
  });
  await db.taxRate.deleteMany({ where: { taxRegimeId: regimeId } });
  await db.taxRegime.delete({ where: { id: regimeId } });
  await db.organisation.deleteMany({ where: { id: { in: orgs } } });
  await db.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// Income tax (personal finance) — get / availableYears / sectionTransactions
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.get (income tax, PF)", () => {
  it("sums income from CREDITs and deductions from DEBITs, and computes taxable income", async () => {
    const result = await makeCaller(orgId, userId).get({ fiscalYear: FISCAL_YEAR });

    expect(result.jurisdiction).toBe("USA");
    expect(result.fiscalYear).toBe(FISCAL_YEAR);
    expect(result.periodStart).toBe("2024-01-01");
    expect(result.periodEnd).toBe("2024-12-31");

    expect(result.summary.totalIncome).toBe(11000); // 8000 + 3000
    expect(result.summary.totalDeductions).toBe(1500); // 1000 + 500
    expect(result.summary.taxableIncome).toBe(9500); // 11000 − 1500
  });

  it("returns one section per configured jurisdiction section (income + deduction)", async () => {
    const result = await makeCaller(orgId, userId).get({ fiscalYear: FISCAL_YEAR });
    const income = result.sections.filter((s) => s.type === "income");
    const deductions = result.sections.filter((s) => s.type === "deduction");
    expect(income.length).toBeGreaterThan(0);
    expect(deductions.length).toBeGreaterThan(0);

    // The salary category should land in the W-2 / Salary income section.
    const salarySection = result.sections.find((s) =>
      s.categories.some((c) => c.name === "Salary & Employment")
    );
    expect(salarySection).toBeDefined();
    expect(salarySection!.total).toBe(8000);
    expect(salarySection!.transactionCount).toBe(1);
  });

  it("throws BAD_REQUEST when the org has no tax jurisdiction", async () => {
    await expect(
      makeCaller(noJurOrgId, noJurUserId).get({ fiscalYear: FISCAL_YEAR })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tax jurisdiction not configured",
    });
  });
});

describe("taxReportRouter.availableYears", () => {
  it("returns fiscal years in descending order spanning the real transaction range", async () => {
    const result = await makeCaller(orgId, userId).availableYears();
    expect(result.years).toEqual([2024, 2023]);
  });

  it("returns an empty array when the org has no jurisdiction", async () => {
    const result = await makeCaller(noJurOrgId, noJurUserId).availableYears();
    expect(result).toEqual({ years: [] });
  });
});

describe("taxReportRouter.sectionTransactions", () => {
  it("paginates real rows for a section, scoped to the fiscal-year period", async () => {
    const result = await makeCaller(orgId, userId).sectionTransactions({
      fiscalYear: FISCAL_YEAR,
      sectionId: "usa_w2",
      page: 1,
      pageSize: 10,
    });

    // Only the 2024 "Salary & Employment" credit belongs to FY2024 — the 2023 one is excluded.
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("Salary & Employment");
    expect(result.items[0].type).toBe("CREDIT");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it("throws BAD_REQUEST for an unknown section", async () => {
    await expect(
      makeCaller(orgId, userId).sectionTransactions({
        fiscalYear: FISCAL_YEAR,
        sectionId: "does_not_exist",
        page: 1,
        pageSize: 10,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sales tax (business accounting) — salesTax
// ─────────────────────────────────────────────────────────────────────────────

describe("taxReportRouter.salesTax (sales tax, business)", () => {
  it("sums output/input tax, computes net, and excludes VOID invoices", async () => {
    const result = await makeCaller(orgId, userId).salesTax({ fiscalYear: FISCAL_YEAR });

    expect(result.fiscalYear).toBe(FISCAL_YEAR);
    expect(result.periodStart).toBe("2024-01-01");
    expect(result.periodEnd).toBe("2024-12-31");

    // Output = INV-1 (15); VOID INV excluded. Input = BILL-1 (4). Net = 11.
    expect(result.summary.outputTax).toBe(15);
    expect(result.summary.inputTax).toBe(4);
    expect(result.summary.netTaxPayable).toBe(11);
    expect(result.summary.invoiceCount).toBe(1); // VOID invoice not counted
    expect(result.summary.billCount).toBe(1);
  });

  it("produces a per-rate breakdown enriched with regime names, sorted by net desc", async () => {
    const result = await makeCaller(orgId, userId).salesTax({ fiscalYear: FISCAL_YEAR });
    const byRate = result.byRate;

    expect(byRate.length).toBe(2);
    // Sorted by net descending: STANDARD (10−4=6) before REDUCED (5−0=5).
    expect(byRate[0].rateCode).toBe("STANDARD");
    expect(byRate[0].regime).toBe("Test Sales Tax");
    expect(byRate[0].output).toBe(10);
    expect(byRate[0].input).toBe(4);
    expect(byRate[0].net).toBe(6);
    expect(byRate[0].invoiceCount).toBe(1);
    expect(byRate[0].billCount).toBe(1);

    expect(byRate[1].rateCode).toBe("REDUCED");
    expect(byRate[1].regime).toBe("Test Sales Tax");
    expect(byRate[1].output).toBe(5);
    expect(byRate[1].input).toBe(0);
    expect(byRate[1].net).toBe(5);
  });

  it("falls back to a calendar-year window when no jurisdiction is configured", async () => {
    const result = await makeCaller(noJurOrgId, noJurUserId).salesTax({ fiscalYear: 2023 });

    expect(result.periodStart).toBe("2023-01-01");
    expect(result.periodEnd).toBe("2023-12-31");
    expect(result.summary.outputTax).toBe(7);
    expect(result.summary.inputTax).toBe(0);
    expect(result.summary.netTaxPayable).toBe(7);
    expect(result.summary.invoiceCount).toBe(1);
  });
});
