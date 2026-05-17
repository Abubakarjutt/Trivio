import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";
import { periodFrom, getSpentForCategory, calcBudgetUtilization } from "@/server/services/easyfinance.service";

export const budgetsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const budgets = await ctx.db.budget.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(!input.includeArchived ? { isArchived: false } : {}),
        },
        orderBy: { createdAt: "desc" },
      });

      // Calculate spending for each budget's period from journal entries
      const now = new Date();
      return Promise.all(
        budgets.map(async (budget) => {
          const from = periodFrom(budget.period, now);
          const spent = await getSpentForCategory(ctx.db, ctx.organisationId, budget.category, from, now);
          const limit = Number(budget.limitAmount);
          return {
            ...budget,
            limitAmount: limit,
            spent,
            remaining: Math.max(0, limit - spent),
            utilization: calcBudgetUtilization(spent, limit),
          };
        })
      );
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        category: z.string().min(1).max(100),
        limitAmount: z.number().positive(),
        period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.budget.create({
        data: {
          organisationId: ctx.organisationId,
          name: input.name,
          category: input.category,
          limitAmount: new Prisma.Decimal(input.limitAmount),
          period: input.period,
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        category: z.string().min(1).max(100).optional(),
        limitAmount: z.number().positive().optional(),
        period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, limitAmount, ...rest } = input;
      const existing = await ctx.db.budget.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.budget.update({
        where: { id },
        data: {
          ...rest,
          ...(limitAmount != null ? { limitAmount: new Prisma.Decimal(limitAmount) } : {}),
        },
      });
    }),

  archive: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.budget.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.budget.update({ where: { id: input.id }, data: { isArchived: true } });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.budget.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.budget.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
