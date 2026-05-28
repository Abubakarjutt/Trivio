import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

export const statementTransactionsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      category: z.string().optional(),
      type: z.enum(["DEBIT", "CREDIT"]).optional(),
      search: z.string().optional(),
      includeExcluded: z.boolean().default(false),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organisationId: ctx.organisationId };
      if (!input.includeExcluded) where.isExcluded = false;
      if (input.category) where.category = input.category;
      if (input.type) where.type = input.type;
      if (input.search) where.merchantName = { contains: input.search, mode: "insensitive" };
      if (input.dateFrom || input.dateTo) {
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

  updateCategory: orgProcedure
    .input(z.object({
      id: z.string(),
      category: z.string(),
      mccCode: z.string().optional(),
      mccLabel: z.string().optional(),
    }))
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

  listBatches: orgProcedure
    .query(async ({ ctx }) =>
      ctx.db.statementImportBatch.findMany({
        where: { organisationId: ctx.organisationId },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    ),

  summary: orgProcedure
    .query(async ({ ctx }) => {
      const [totalCount, debitsAgg, creditsAgg, latestBatch] = await Promise.all([
        ctx.db.statementTransaction.count({
          where: { organisationId: ctx.organisationId, isExcluded: false },
        }),
        ctx.db.statementTransaction.aggregate({
          where: { organisationId: ctx.organisationId, isExcluded: false, type: "DEBIT" },
          _sum: { amount: true },
        }),
        ctx.db.statementTransaction.aggregate({
          where: { organisationId: ctx.organisationId, isExcluded: false, type: "CREDIT" },
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
});
