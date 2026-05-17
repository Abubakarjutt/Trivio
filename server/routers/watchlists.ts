import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";
import { periodFrom, getSpentForCategory, calcWatchlistStatus } from "@/server/services/easyfinance.service";

export const watchlistsRouter = createTRPCRouter({
  list: orgProcedure.query(async ({ ctx }) => {
    const watchlists = await ctx.db.watchlist.findMany({
      where: { organisationId: ctx.organisationId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    return Promise.all(
      watchlists.map(async (wl) => {
        const from = periodFrom(wl.period, now);
        const spent = await getSpentForCategory(ctx.db, ctx.organisationId, wl.category, from, now);
        const threshold = Number(wl.threshold);
        return {
          ...wl,
          threshold,
          spent,
          ...calcWatchlistStatus(spent, threshold),
        };
      })
    );
  }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        category: z.string().min(1).max(100),
        threshold: z.number().positive(),
        period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.watchlist.create({
        data: {
          organisationId: ctx.organisationId,
          name: input.name,
          category: input.category,
          threshold: new Prisma.Decimal(input.threshold),
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
        threshold: z.number().positive().optional(),
        period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, threshold, ...rest } = input;
      const existing = await ctx.db.watchlist.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.watchlist.update({
        where: { id },
        data: {
          ...rest,
          ...(threshold != null ? { threshold: new Prisma.Decimal(threshold) } : {}),
        },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.watchlist.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.watchlist.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
