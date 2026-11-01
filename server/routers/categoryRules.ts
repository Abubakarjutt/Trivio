import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

// Rules come from "Always use…" answers; here they can be re-pointed or removed.
// Changes only affect future imports.
export const categoryRulesRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) =>
    ctx.db.categoryRule.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, kind: true, label: true, category: true, timesApplied: true, lastAppliedAt: true },
    }),
  ),

  update: orgProcedure
    .input(z.object({ id: z.string().min(1), category: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.categoryRule.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { category: input.category },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.categoryRule.deleteMany({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
