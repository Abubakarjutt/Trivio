import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";

function nextDueDateAfter(current: Date, frequency: string): Date {
  const d = new Date(current);
  switch (frequency) {
    case "DAILY":       d.setDate(d.getDate() + 1); break;
    case "WEEKLY":      d.setDate(d.getDate() + 7); break;
    case "FORTNIGHTLY": d.setDate(d.getDate() + 14); break;
    case "MONTHLY":     d.setMonth(d.getMonth() + 1); break;
    case "QUARTERLY":   d.setMonth(d.getMonth() + 3); break;
    case "YEARLY":      d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

export const recurringItemsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({ activeOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.recurringItem.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input.activeOnly ? { isActive: true } : {}),
        },
        orderBy: { nextDueDate: "asc" },
      });

      const now = new Date();
      return items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        isDue: new Date(item.nextDueDate) <= now,
        daysUntilDue: Math.ceil((new Date(item.nextDueDate).getTime() - now.getTime()) / 86400000),
      }));
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        amount: z.number().positive(),
        type: z.enum(["INCOME", "EXPENSE"]),
        frequency: z.enum(["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
        category: z.string().max(100).optional(),
        nextDueDate: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.recurringItem.create({
        data: {
          organisationId: ctx.organisationId,
          name: input.name,
          description: input.description,
          amount: new Prisma.Decimal(input.amount),
          type: input.type,
          frequency: input.frequency,
          category: input.category,
          nextDueDate: input.nextDueDate,
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        amount: z.number().positive().optional(),
        frequency: z.enum(["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
        category: z.string().max(100).optional(),
        nextDueDate: z.date().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, amount, ...rest } = input;
      const existing = await ctx.db.recurringItem.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.recurringItem.update({
        where: { id },
        data: {
          ...rest,
          ...(amount != null ? { amount: new Prisma.Decimal(amount) } : {}),
        },
      });
    }),

  // Mark as paid: record lastPaidAt + advance nextDueDate
  markPaid: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.recurringItem.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const nextDue = nextDueDateAfter(item.nextDueDate, item.frequency);

      return ctx.db.recurringItem.update({
        where: { id: input.id },
        data: {
          lastPaidAt: new Date(),
          nextDueDate: nextDue,
        },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.recurringItem.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.recurringItem.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // Summary: total monthly income/expense from recurring items
  summary: orgProcedure.query(async ({ ctx }) => {
    const items = await ctx.db.recurringItem.findMany({
      where: { organisationId: ctx.organisationId, isActive: true },
    });

    // Normalise all amounts to monthly equivalent
    const MONTHLY_FACTOR: Record<string, number> = {
      DAILY: 30,
      WEEKLY: 4.33,
      FORTNIGHTLY: 2.17,
      MONTHLY: 1,
      QUARTERLY: 1 / 3,
      YEARLY: 1 / 12,
    };

    let monthlyIncome = 0;
    let monthlyExpense = 0;

    for (const item of items) {
      const monthly = Number(item.amount) * (MONTHLY_FACTOR[item.frequency] ?? 1);
      if (item.type === "INCOME") monthlyIncome += monthly;
      else monthlyExpense += monthly;
    }

    return {
      monthlyIncome: Math.round(monthlyIncome * 100) / 100,
      monthlyExpense: Math.round(monthlyExpense * 100) / 100,
      monthlyNet: Math.round((monthlyIncome - monthlyExpense) * 100) / 100,
      totalItems: items.length,
    };
  }),
});
