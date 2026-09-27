import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { createManualPfTransaction } from "@/server/services/pf-transaction.service";
import { buildInsights } from "@/server/services/pf-insights.service";
import {
  dateOf,
  listPeriods,
  localToday,
  periodLabel,
} from "@/server/services/pf-cycle.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

/**
 * Convert a "YYYY-MM" string into an inclusive [gte, lt) date range.
 * `date` is a DATE column and Prisma sends a bound's UTC calendar date, so the
 * bounds must be UTC midnight — local-midnight bounds east of UTC (e.g.
 * Pakistan) become "last day of the previous month", dropping the month's
 * final day from its own view.
 */
function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)),
  };
}

export const statementTransactionsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        /** "YYYY-MM" month filter — takes precedence over dateFrom/dateTo when set */
        month: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        category: z.string().optional(),
        type: z.enum(["DEBIT", "CREDIT"]).optional(),
        search: z.string().optional(),
        includeExcluded: z.boolean().default(false),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organisationId: ctx.organisationId };
      if (!input.includeExcluded) where.isExcluded = false;
      if (input.category) where.category = input.category;
      if (input.type) where.type = input.type;
      if (input.search) where.merchantName = { contains: input.search, mode: "insensitive" };

      if (input.month) {
        where.date = monthRange(input.month);
      } else if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }

      const skip = input.cursor ? parseInt(input.cursor, 10) : 0;
      const items = await ctx.db.statementTransaction.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: input.limit + 1,
        skip,
      });

      let nextCursor: string | undefined;
      if (items.length > input.limit) {
        items.pop();
        nextCursor = String(skip + input.limit);
      }
      return { items, nextCursor };
    }),

  create: orgProcedure
    .input(
      z.object({
        date: z.string(),
        description: z.string().min(1).max(200),
        merchantName: z.string().min(1).max(200),
        amount: z.number().positive(),
        type: z.enum(["DEBIT", "CREDIT"]),
        category: z.string().min(1),
        mccCode: z.string().optional(),
        mccLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createManualPfTransaction(ctx.db, ctx.organisationId, {
        ...input,
        date: new Date(input.date),
      });
    }),

  updateCategory: orgProcedure
    .input(
      z.object({
        id: z.string(),
        category: z.string(),
        mccCode: z.string().optional(),
        mccLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const txn = await ctx.db.statementTransaction.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.statementTransaction.update({
        where: { id: input.id },
        data: {
          category: input.category,
          ...(input.mccCode !== undefined ? { mccCode: input.mccCode } : {}),
          ...(input.mccLabel !== undefined ? { mccLabel: input.mccLabel } : {}),
        },
      });
    }),

  toggleExclude: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const txn = await ctx.db.statementTransaction.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.statementTransaction.update({
        where: { id: input.id },
        data: { isExcluded: !txn.isExcluded },
      });
    }),

  deleteTransaction: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const txn = await ctx.db.statementTransaction.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.statementTransaction.delete({ where: { id: input.id } });
      return { success: true };
    }),

  deleteByBatch: orgProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await ctx.db.statementImportBatch.findFirst({
        where: { id: input.batchId, organisationId: ctx.organisationId },
      });
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.statementTransaction.deleteMany({
        where: { importBatchId: input.batchId, organisationId: ctx.organisationId },
      });
      await ctx.db.statementImportBatch.delete({ where: { id: input.batchId } });
      return { success: true };
    }),

  pendingBatch: orgProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const batch = await ctx.db.statementImportBatch.findFirst({
        where: { id: input.batchId, organisationId: ctx.organisationId },
        select: { id: true, pendingDuplicatesJson: true },
      });
      if (!batch) return null;
      const raw = batch.pendingDuplicatesJson as
        | {
            date: string;
            description: string;
            amount: number;
          }[]
        | null;
      if (!raw || raw.length === 0) return null;
      return {
        batchId: batch.id,
        items: raw.map((d) => ({ date: d.date, description: d.description, amount: d.amount })),
      };
    }),

  listBatches: orgProcedure.query(async ({ ctx }) =>
    ctx.db.statementImportBatch.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  ),

  summary: orgProcedure
    .input(
      z.object({
        /** "YYYY-MM" month filter — undefined = all time */
        month: z.string().optional(),
        /** Inclusive date bounds (a pay month) — used when `month` isn't set. */
        dateFrom: day.optional(),
        dateTo: day.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseWhere: any = { organisationId: ctx.organisationId, isExcluded: false };
      if (input.month) baseWhere.date = monthRange(input.month);
      else if (input.dateFrom || input.dateTo)
        baseWhere.date = {
          ...(input.dateFrom ? { gte: dateOf(input.dateFrom) } : {}),
          ...(input.dateTo ? { lte: dateOf(input.dateTo) } : {}),
        };

      const [totalCount, debitsAgg, creditsAgg, latestBatch] = await Promise.all([
        ctx.db.statementTransaction.count({ where: baseWhere }),
        ctx.db.statementTransaction.aggregate({
          where: { ...baseWhere, type: "DEBIT" },
          _sum: { amount: true },
        }),
        ctx.db.statementTransaction.aggregate({
          where: { ...baseWhere, type: "CREDIT" },
          _sum: { amount: true },
        }),
        ctx.db.statementImportBatch.findFirst({
          where: { organisationId: ctx.organisationId, status: "DONE" },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return {
        totalCount,
        totalDebits: Number(debitsAgg._sum.amount ?? 0),
        totalCredits: Number(creditsAgg._sum.amount ?? 0),
        latestBatch,
      };
    }),

  /** Personal Finance dashboard: income vs expenses, where the money goes
   *  (by category and group), top merchants and the trend over pay months. */
  insights: orgProcedure
    .input(
      z.object({
        /** A period from pfCycles.list — omit for all time. */
        from: day.optional(),
        /** Inclusive end; null/omitted = still open. */
        to: day.nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const today = localToday();
      const periods = await listPeriods(ctx.db, ctx.organisationId, today);
      const period = input.from ? { from: input.from, to: input.to ?? null } : undefined;
      // The trend: the 6 periods up to the chosen one, or the last 12 for all time.
      const at = period ? periods.findIndex((p) => p.from === period.from) : periods.length - 1;
      const trend = (
        at < 0
          ? [{ ...period!, label: periodLabel(period!.from, period!.to) }]
          : periods.slice(Math.max(0, at - (period ? 5 : 11)), at + 1)
      ).map(({ from, to, label }) => ({ from, to, label }));

      const base = { organisationId: ctx.organisationId, isExcluded: false };
      const between = (from: string, to: string | null) => ({
        gte: dateOf(from),
        ...(to ? { lte: dateOf(to) } : {}),
      });
      const [rows, trendRows] = await Promise.all([
        ctx.db.statementTransaction.findMany({
          where: period ? { ...base, date: between(period.from, period.to) } : base,
          select: {
            date: true,
            type: true,
            amount: true,
            category: true,
            merchantName: true,
            description: true,
          },
        }),
        ctx.db.statementTransaction.findMany({
          where: { ...base, date: between(trend[0].from, trend[trend.length - 1].to) },
          select: { date: true, type: true, amount: true },
        }),
      ]);
      return buildInsights(
        rows.map((r) => ({ ...r, amount: Number(r.amount) })),
        trendRows.map((r) => ({
          ...r,
          amount: Number(r.amount),
          category: "",
          merchantName: null,
          description: "",
        })),
        { period, trend, today }
      );
    }),
});
