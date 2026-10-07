import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { NotFoundError } from "@/server/services/outreach/types";
import { outreachProcedure } from "./outreach-procedure";

export const outreachVoiceRouter = createTRPCRouter({
  list: outreachProcedure.query(({ ctx }) =>
    ctx.db.outreachVoiceExample.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  ),

  delete: outreachProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const res = await ctx.db.outreachVoiceExample.deleteMany({
      where: { id: input.id, organisationId: ctx.organisationId },
    });
    if (res.count === 0) throw new NotFoundError("Voice example not found.");
    return { ok: true };
  }),
});
