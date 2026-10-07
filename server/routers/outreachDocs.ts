import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { formatCurrency } from "@/lib/utils";
import { createTRPCRouter } from "@/server/trpc";
import {
  analyzeConversation,
  draftProposal,
  prepTeardown,
  toBrief,
} from "@/server/services/outreach/ai";
import { requireConfig } from "@/server/services/outreach/config";
import { createLlm } from "@/server/services/outreach/llm";
import { renderProposal } from "@/server/services/outreach/prompts";
import {
  getContactableProspect,
  recentVoice,
  saveConversation,
  saveDoc,
  saveDrafts,
} from "@/server/services/outreach/prospects";
import { NotFoundError, OutreachError } from "@/server/services/outreach/types";
import { MAX_PASTE, outreachProcedure } from "./outreach-procedure";

async function latestThread(
  db: PrismaClient,
  orgId: string,
  prospectId: string
): Promise<string | null> {
  const c = await db.outreachConversation.findFirst({
    where: { organisationId: orgId, prospectId },
    orderBy: { createdAt: "desc" },
  });
  return c?.thread ?? null;
}

const norm = (s: string) => s.trim().toLowerCase();

export const outreachDocsRouter = createTRPCRouter({
  analyseConversation: outreachProcedure
    .input(z.object({ id: z.string(), thread: z.string().max(MAX_PASTE) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organisationId;
      const p = await getContactableProspect(ctx.db, orgId, input.id);
      const config = await requireConfig(ctx.db, orgId);
      const voice = await recentVoice(ctx.db, orgId);
      const result = await analyzeConversation(
        createLlm(),
        { ...p, ...toBrief(p) },
        input.thread,
        config.sellerProfile,
        voice,
        new Date()
      );
      await saveConversation(ctx.db, orgId, p.id, input.thread.trim(), result.analysis);
      if (result.replies.length) await saveDrafts(ctx.db, orgId, p.id, "REPLY", result.replies);
      // Suggested events are shown, not applied: the person confirms them with outreachProspects.applySuggestions.
      return result;
    }),

  teardown: outreachProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organisationId;
      const p = await getContactableProspect(ctx.db, orgId, input.id);
      const config = await requireConfig(ctx.db, orgId);
      const offers = await ctx.db.outreachOffer.findMany({
        where: { organisationId: orgId, archived: false },
        orderBy: { createdAt: "asc" },
      });
      const prep = await prepTeardown(
        createLlm(),
        toBrief(p),
        await latestThread(ctx.db, orgId, p.id),
        config.sellerProfile,
        offers.map((o) => ({
          name: o.name,
          description: o.description,
          fittingSignals: o.fittingSignals,
        }))
      );
      // The model returns an offer *name*; only a name that matches a real offer becomes an id.
      const offerId = offers.find((o) => norm(o.name) === norm(prep.offer))?.id ?? null;
      const body = { ...prep, offerId };
      await saveDoc(ctx.db, orgId, p.id, "TEARDOWN_PREP", body);
      return body;
    }),

  proposal: outreachProcedure
    .input(
      z.object({ id: z.string(), offerId: z.string().nullish(), callNotes: z.string().max(20_000) })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organisationId;
      const p = await getContactableProspect(ctx.db, orgId, input.id);
      const config = await requireConfig(ctx.db, orgId);
      let offer;
      if (input.offerId) {
        offer = await ctx.db.outreachOffer.findFirst({
          where: { id: input.offerId, organisationId: orgId },
        });
        if (!offer) throw new NotFoundError("Offer not found.");
      } else {
        const active = await ctx.db.outreachOffer.findMany({
          where: { organisationId: orgId, archived: false },
          orderBy: { createdAt: "asc" },
        });
        const teardown = await ctx.db.outreachDoc.findFirst({
          where: { organisationId: orgId, prospectId: p.id, kind: "TEARDOWN_PREP" },
        });
        const fromTeardown =
          (teardown?.body as { offerId?: string | null } | null)?.offerId ?? null;
        offer = active.find((o) => o.id === fromTeardown) ?? active[0];
      }
      if (!offer) throw new OutreachError("Add an offer in Outreach settings first.");
      const proposal = await draftProposal(
        createLlm(),
        toBrief(p),
        offer.name,
        input.callNotes,
        await latestThread(ctx.db, orgId, p.id),
        config.sellerProfile
      );
      // The model never writes prices; code inserts the stored one in the organisation's currency.
      const priceText = offer.price
        ? formatCurrency(offer.price.toString(), ctx.organisation.currency)
        : "";
      const text = renderProposal(proposal, offer.name, priceText);
      await saveDoc(ctx.db, orgId, p.id, "PROPOSAL", {
        offerId: offer.id,
        offerName: offer.name,
        text,
      });
      return { text, offerId: offer.id, offerName: offer.name };
    }),
});
