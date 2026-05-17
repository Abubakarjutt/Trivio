import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";

export const goalsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({ status: z.enum(["ALL", "ACTIVE", "COMPLETED", "CANCELLED"]).default("ALL") }))
    .query(async ({ ctx, input }) => {
      const goals = await ctx.db.goal.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input.status !== "ALL" ? { status: input.status } : {}),
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });

      return goals.map((g) => ({
        ...g,
        targetAmount: Number(g.targetAmount),
        currentAmount: Number(g.currentAmount),
        progress:
          Number(g.targetAmount) > 0
            ? Math.min(100, Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100))
            : 0,
        remaining: Math.max(0, Number(g.targetAmount) - Number(g.currentAmount)),
      }));
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        targetAmount: z.number().positive(),
        currentAmount: z.number().min(0).default(0),
        targetDate: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.goal.create({
        data: {
          organisationId: ctx.organisationId,
          name: input.name,
          description: input.description,
          targetAmount: new Prisma.Decimal(input.targetAmount),
          currentAmount: new Prisma.Decimal(input.currentAmount),
          targetDate: input.targetDate,
          status: "ACTIVE",
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        targetAmount: z.number().positive().optional(),
        currentAmount: z.number().min(0).optional(),
        targetDate: z.date().nullable().optional(),
        status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, targetAmount, currentAmount, ...rest } = input;
      const existing = await ctx.db.goal.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.goal.update({
        where: { id },
        data: {
          ...rest,
          ...(targetAmount != null ? { targetAmount: new Prisma.Decimal(targetAmount) } : {}),
          ...(currentAmount != null ? { currentAmount: new Prisma.Decimal(currentAmount) } : {}),
        },
      });
    }),

  // Add money to a goal (contribute)
  contribute: orgProcedure
    .input(z.object({ id: z.string(), amount: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const goal = await ctx.db.goal.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!goal) throw new TRPCError({ code: "NOT_FOUND" });
      if (goal.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: "Goal is not active" });

      const newAmount = Number(goal.currentAmount) + input.amount;
      const isComplete = newAmount >= Number(goal.targetAmount) - 0.001;

      return ctx.db.goal.update({
        where: { id: input.id },
        data: {
          currentAmount: new Prisma.Decimal(newAmount),
          ...(isComplete ? { status: "COMPLETED" } : {}),
        },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.goal.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.goal.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
