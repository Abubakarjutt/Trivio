import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { db } from "@/lib/db";
import { JURISDICTIONS, dateToFiscalYear, getSection } from "@/lib/tax/sections";
import { Prisma } from "@prisma/client";

export const taxReportRouter = createTRPCRouter({
  get: orgProcedure
    .input(z.object({ fiscalYear: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx;
      const { fiscalYear } = input;

      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      });
      if (!org?.taxJurisdiction) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tax jurisdiction not configured" });
      }

      const config = JURISDICTIONS[org.taxJurisdiction];
      if (!config) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown jurisdiction: ${org.taxJurisdiction}`,
        });
      }

      const periodStart = config.fiscalYearStart(fiscalYear);
      const periodEnd = config.fiscalYearEnd(fiscalYear);

      const [creditRows, debitRows] = await Promise.all([
        db.statementTransaction.groupBy({
          by: ["category"],
          where: {
            organisationId,
            type: "CREDIT",
            date: { gte: periodStart, lte: periodEnd },
            isExcluded: false,
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
        db.statementTransaction.groupBy({
          by: ["category"],
          where: {
            organisationId,
            type: "DEBIT",
            date: { gte: periodStart, lte: periodEnd },
            isExcluded: false,
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ]);

      type Row = {
        category: string;
        _sum: { amount: { toNumber(): number } | null };
        _count: { id: number };
      };
      const toMap = (rows: Row[]) =>
        Object.fromEntries(
          rows.map((r) => [
            r.category,
            { total: r._sum.amount?.toNumber() ?? 0, count: r._count.id },
          ])
        );

      const creditMap = toMap(creditRows as Row[]);
      const debitMap = toMap(debitRows as Row[]);

      const sections = config.sections.map((section) => {
        const map = section.type === "income" ? creditMap : debitMap;
        const cats = section.categories.map((cat) => ({
          name: cat,
          total: map[cat]?.total ?? 0,
          count: map[cat]?.count ?? 0,
        }));
        const total = cats.reduce((sum, c) => sum + c.total, 0);
        const transactionCount = cats.reduce((sum, c) => sum + c.count, 0);
        return {
          id: section.id,
          label: section.label,
          type: section.type,
          reference: section.reference,
          total,
          transactionCount,
          categories: cats,
        };
      });

      const totalIncome = sections
        .filter((s) => s.type === "income")
        .reduce((sum, s) => sum + s.total, 0);
      const totalDeductions = sections
        .filter((s) => s.type === "deduction")
        .reduce((sum, s) => sum + s.total, 0);

      const toLocalDateStr = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      return {
        jurisdiction: config.code,
        jurisdictionName: config.name,
        fiscalYear,
        periodStart: toLocalDateStr(periodStart),
        periodEnd: toLocalDateStr(periodEnd),
        summary: { totalIncome, totalDeductions, taxableIncome: totalIncome - totalDeductions },
        sections,
      };
    }),

  salesTax: orgProcedure
    .input(z.object({ fiscalYear: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx;
      const { fiscalYear } = input;

      // Sales tax (output/input) is period-based. Prefer the configured
      // jurisdiction's fiscal year; fall back to a calendar year so the view
      // is always usable even before a jurisdiction is picked.
      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      });
      const config = org?.taxJurisdiction ? JURISDICTIONS[org.taxJurisdiction] : undefined;
      const periodStart = config ? config.fiscalYearStart(fiscalYear) : new Date(fiscalYear, 0, 1);
      const periodEnd = config
        ? config.fiscalYearEnd(fiscalYear)
        : new Date(fiscalYear, 11, 31, 23, 59, 59);

      const inPeriod = {
        organisationId,
        status: { not: "VOID" as const },
        date: { gte: periodStart, lte: periodEnd },
      };

      const [invoiceAgg, billAgg, rawInvoiceLines, rawBillLines, regimes] = await Promise.all([
        db.invoice.aggregate({ where: inPeriod, _sum: { taxAmount: true }, _count: { id: true } }),
        db.bill.aggregate({ where: inPeriod, _sum: { taxAmount: true }, _count: { id: true } }),
        db.invoiceLine.groupBy({
          by: ["taxRegimeId", "taxRateCode"],
          where: { invoice: inPeriod },
          _sum: { taxAmount: true },
          _count: { id: true },
        }),
        db.billLine.groupBy({
          by: ["taxRegimeId", "taxRateCode"],
          where: { bill: inPeriod },
          _sum: { taxAmount: true },
          _count: { id: true },
        }),
        db.taxRegime.findMany({ select: { id: true, name: true } }),
      ]);

      type LineGroup = {
        taxRegimeId: string | null;
        taxRateCode: string | null;
        _sum: { taxAmount: Prisma.Decimal | null };
        _count: { id: number };
      };
      const invoiceLines = rawInvoiceLines as unknown as LineGroup[];
      const billLines = rawBillLines as unknown as LineGroup[];

      const outputTax = new Prisma.Decimal(invoiceAgg._sum.taxAmount ?? 0).toNumber();
      const inputTax = new Prisma.Decimal(billAgg._sum.taxAmount ?? 0).toNumber();
      const netTaxPayable = outputTax - inputTax;

      // Per-rate breakdown, enriched with the regime name.
      const regimeName = new Map(regimes.map((r) => [r.id, r.name]));
      type Bucket = {
        key: string;
        regime: string;
        rateCode: string;
        output: number;
        input: number;
        net: number;
        invoiceCount: number;
        billCount: number;
      };
      const buckets = new Map<string, Bucket>();
      const ensure = (regimeId: string | null, rateCode: string | null): Bucket => {
        const key = `${regimeId ?? "none"}\u0000${rateCode ?? "none"}`;
        let b = buckets.get(key);
        if (!b) {
          b = {
            key,
            regime: regimeId ? (regimeName.get(regimeId) ?? "Unassigned") : "Unassigned",
            rateCode: rateCode ?? "\u2014",
            output: 0,
            input: 0,
            net: 0,
            invoiceCount: 0,
            billCount: 0,
          };
          buckets.set(key, b);
        }
        return b;
      };
      for (const g of invoiceLines) {
        const b = ensure(g.taxRegimeId, g.taxRateCode);
        b.output += g._sum.taxAmount?.toNumber() ?? 0;
        b.invoiceCount += g._count.id;
      }
      for (const g of billLines) {
        const b = ensure(g.taxRegimeId, g.taxRateCode);
        b.input += g._sum.taxAmount?.toNumber() ?? 0;
        b.billCount += g._count.id;
      }
      const byRate = [...buckets.values()]
        .map((b) => ({ ...b, net: b.output - b.input }))
        .sort((a, b) => b.net - a.net);

      const toLocalDateStr = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      return {
        fiscalYear,
        periodStart: toLocalDateStr(periodStart),
        periodEnd: toLocalDateStr(periodEnd),
        summary: {
          outputTax,
          inputTax,
          netTaxPayable,
          invoiceCount: invoiceAgg._count.id,
          billCount: billAgg._count.id,
        },
        byRate,
      };
    }),
  availableYears: orgProcedure.query(async ({ ctx }) => {
    const { organisationId } = ctx;

    const org = await db.organisation.findFirst({
      where: { id: organisationId },
      select: { taxJurisdiction: true },
    });
    if (!org?.taxJurisdiction) return { years: [] };

    const config = JURISDICTIONS[org.taxJurisdiction];
    if (!config) return { years: [] };

    const agg = await db.statementTransaction.aggregate({
      where: { organisationId },
      _min: { date: true },
      _max: { date: true },
    });

    if (!agg._min.date || !agg._max.date) return { years: [] };

    const minYear = dateToFiscalYear(new Date(agg._min.date), config);
    const maxYear = dateToFiscalYear(new Date(agg._max.date), config);

    const years: number[] = [];
    for (let y = maxYear; y >= minYear; y--) years.push(y);
    return { years };
  }),

  sectionTransactions: orgProcedure
    .input(
      z.object({
        fiscalYear: z.number().int().min(2000).max(2100),
        sectionId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx;
      const { fiscalYear, sectionId, page, pageSize } = input;

      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      });
      if (!org?.taxJurisdiction)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tax jurisdiction not configured" });

      const config = JURISDICTIONS[org.taxJurisdiction];
      if (!config) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown jurisdiction" });

      const section = getSection(org.taxJurisdiction, sectionId);
      if (!section)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown section: ${sectionId}` });

      const periodStart = config.fiscalYearStart(fiscalYear);
      const periodEnd = config.fiscalYearEnd(fiscalYear);
      const txnType = section.type === "income" ? "CREDIT" : "DEBIT";

      const where = {
        organisationId,
        category: { in: section.categories },
        type: txnType as "CREDIT" | "DEBIT",
        date: { gte: periodStart, lte: periodEnd },
        isExcluded: false,
      };

      const [items, total] = await Promise.all([
        db.statementTransaction.findMany({
          where,
          orderBy: { date: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.statementTransaction.count({ where }),
      ]);

      return { items, total, page, pageSize };
    }),
});
