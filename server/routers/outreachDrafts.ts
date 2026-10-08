import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { generateDrafts, toBrief } from "@/server/services/outreach/ai";
import { requireConfig } from "@/server/services/outreach/config";
import { createLlm } from "@/server/services/outreach/llm";
import { getProspect, recentVoice, saveDrafts } from "@/server/services/outreach/prospects";
import { DRAFT_KINDS } from "@/server/services/outreach/types";
import { outreachProcedure } from "./outreach-procedure";

export const outreachDraftsRouter = createTRPCRouter({
  generate: outreachProcedure
    .input(z.object({ id: z.string(), kind: z.enum(DRAFT_KINDS) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organisationId;
      const p = await getProspect(ctx.db, orgId, input.id);
      const config = await requireConfig(ctx.db, orgId);
      const voice = await recentVoice(ctx.db, orgId);
      const drafts = await generateDrafts(
        createLlm(),
        toBrief(p),
        input.kind,
        config.sellerProfile,
        voice
      );
      await saveDrafts(ctx.db, orgId, p.id, input.kind, drafts);
      return drafts;
    }),

  list: outreachProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const p = await getProspect(ctx.db, ctx.organisationId, input.id);
    return ctx.db.outreachDraft.findMany({
      where: { organisationId: ctx.organisationId, prospectId: p.id },
      orderBy: [{ kind: "asc" }, { variant: "asc" }],
    });
  }),
});
