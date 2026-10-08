import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { extractProfile } from "@/server/services/outreach/ai";
import { requireConfig } from "@/server/services/outreach/config";
import { linkCrmLead, tryStartPilot } from "@/server/services/outreach/crm-handoff";
import { enrichCompany } from "@/server/services/outreach/enrich";
import { createLlm } from "@/server/services/outreach/llm";
import { EVENTS, eventsFor, nextAction } from "@/server/services/outreach/pipeline";
import {
  applyEvent,
  applyEvents,
  deleteProspect,
  getProspect,
  isDnc,
  markDnc,
  saveProspect,
} from "@/server/services/outreach/prospects";
import { scoreSignals } from "@/server/services/outreach/scoring";
import { OutreachError, SignalsSchema } from "@/server/services/outreach/types";
import { normalizeProfileUrl } from "@/server/services/outreach/urls";
import { createPageFetcher } from "@/server/services/outreach/website";
import { MAX_PASTE, outreachProcedure } from "./outreach-procedure";

const STAGES = [
  "QUEUED",
  "REQUEST_SENT",
  "CONNECTED",
  "VALUE_SENT",
  "ENGAGED",
  "TEARDOWN",
  "PILOT",
  "WON",
  "LOST",
  "NURTURE",
  "DNC",
] as const;
const short = z.string().trim().max(300);
const nullableShort = short.nullable().transform((v) => (v ? v : null));
const Stack = z.array(z.string().trim().min(1).max(80)).max(40);
const Id = z.object({ id: z.string() });
const actorOf = (ctx: { organisationId: string; user: { id: string } }) => ({
  orgId: ctx.organisationId,
  userId: ctx.user.id,
});

const LIST_SELECT = {
  id: true,
  name: true,
  title: true,
  company: true,
  score: true,
  primarySignal: true,
  stage: true,
  stageChangedAt: true,
  awaitingReply: true,
  crmLeadId: true,
  crmDealId: true,
  createdAt: true,
} as const;

export const outreachProspectsRouter = createTRPCRouter({
  list: outreachProcedure
    .input(z.object({ stage: z.enum(STAGES).optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.db.outreachProspect.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input?.stage ? { stage: input.stage } : {}),
        },
        orderBy: [{ score: "desc" }, { createdAt: "asc" }],
        select: LIST_SELECT,
      })
    ),

  get: outreachProcedure.input(Id).query(async ({ ctx, input }) => {
    const orgId = ctx.organisationId;
    const prospect = await getProspect(ctx.db, orgId, input.id);
    const config = await requireConfig(ctx.db, orgId);
    const scope = { organisationId: orgId, prospectId: prospect.id };
    const [drafts, conversation, docs, events, lead, deal, pipelines] = await Promise.all([
      ctx.db.outreachDraft.findMany({
        where: scope,
        orderBy: [{ kind: "asc" }, { variant: "asc" }],
      }),
      ctx.db.outreachConversation.findFirst({ where: scope, orderBy: { createdAt: "desc" } }),
      ctx.db.outreachDoc.findMany({ where: scope }),
      ctx.db.outreachEvent.findMany({ where: scope, orderBy: { at: "desc" }, take: 50 }),
      prospect.crmLeadId
        ? ctx.db.crmLead.findFirst({
            where: { id: prospect.crmLeadId, organisationId: orgId },
            select: { id: true, status: true },
          })
        : null,
      prospect.crmDealId
        ? ctx.db.crmDeal.findFirst({
            where: { id: prospect.crmDealId, organisationId: orgId },
            select: { id: true, name: true },
          })
        : null,
      ctx.db.crmPipeline.count({ where: { organisationId: orgId } }),
    ]);
    return {
      prospect,
      drafts,
      conversation: conversation
        ? { thread: conversation.thread, analysis: conversation.analysis }
        : null,
      docs: {
        teardown: docs.find((d) => d.kind === "TEARDOWN_PREP")?.body ?? null,
        proposal: docs.find((d) => d.kind === "PROPOSAL")?.body ?? null,
      },
      crm: { lead, deal, hasPipeline: pipelines > 0 },
      events,
      allowedEvents: eventsFor(prospect.stage),
      next: nextAction(prospect, config.cadence),
    };
  }),

  extract: outreachProcedure
    .input(
      z.object({
        profileUrl: z.string().max(2000),
        profileText: z.string().max(MAX_PASTE),
        companyWebsite: z.string().max(500).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const profileUrl = normalizeProfileUrl(input.profileUrl);
      if (await isDnc(ctx.db, ctx.organisationId, profileUrl)) {
        throw new OutreachError("This person is on your do-not-contact list.");
      }
      const config = await requireConfig(ctx.db, ctx.organisationId);
      const extracted = await extractProfile(createLlm(), input.profileText, config.sellerProfile);
      // A website the person typed beats one the model read off the profile.
      const website = input.companyWebsite?.trim() || extracted.companyWebsite;
      const enrichment = await enrichCompany(website, createPageFetcher(), config.hiringKeywords);
      return { profileUrl, extracted, enrichment };
    }),

  create: outreachProcedure
    .input(
      z.object({
        profileUrl: z.string().max(2000),
        name: z.string().trim().min(1).max(200),
        title: short,
        company: short,
        companyWebsite: nullableShort,
        companySize: nullableShort,
        location: nullableShort,
        profileText: z.string().max(MAX_PASTE),
        stack: Stack,
        signals: SignalsSchema,
        enrichmentStatus: z.enum(["checked", "unreachable", "no_website", "refused"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const config = await requireConfig(ctx.db, ctx.organisationId);
      return saveProspect(
        ctx.db,
        ctx.organisationId,
        { ...input, profileUrl: normalizeProfileUrl(input.profileUrl) },
        config.weights,
        new Date()
      );
    }),

  update: outreachProcedure
    .input(
      Id.extend({
        title: short.optional(),
        company: short.optional(),
        companyWebsite: nullableShort.optional(),
        stack: Stack.optional(),
        signals: SignalsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, signals, ...fields } = input;
      await getProspect(ctx.db, ctx.organisationId, id);
      const config = await requireConfig(ctx.db, ctx.organisationId);
      const scored = signals ? scoreSignals(signals, config.weights) : null;
      await ctx.db.outreachProspect.updateMany({
        where: { id, organisationId: ctx.organisationId },
        data: {
          ...fields,
          ...(signals && scored
            ? {
                signals,
                score: scored.score,
                primarySignal: scored.primary?.name ?? null,
                scoreReasons: scored.reasons,
              }
            : {}),
        },
      });
      return { ok: true };
    }),

  logEvent: outreachProcedure
    .input(Id.extend({ event: z.enum(EVENTS), sentText: z.string().max(5000).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const config = await requireConfig(ctx.db, ctx.organisationId);
      return applyEvent(ctx.db, actorOf(ctx), input.id, input.event, new Date(), config, {
        sentText: input.sentText,
      });
    }),

  applySuggestions: outreachProcedure
    .input(Id.extend({ events: z.array(z.enum(EVENTS)).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      // applyEvents folds NotFoundError into its error string, so check ownership here first.
      await getProspect(ctx.db, ctx.organisationId, input.id);
      const config = await requireConfig(ctx.db, ctx.organisationId);
      return applyEvents(ctx.db, actorOf(ctx), input.id, input.events, new Date(), config);
    }),

  markDnc: outreachProcedure
    .input(Id)
    .mutation(({ ctx, input }) => markDnc(ctx.db, ctx.organisationId, input.id, new Date())),

  delete: outreachProcedure
    .input(Id)
    .mutation(({ ctx, input }) => deleteProspect(ctx.db, ctx.organisationId, input.id, new Date())),

  retryCrmHandoff: outreachProcedure.input(Id).mutation(async ({ ctx, input }) => {
    const p = await getProspect(ctx.db, ctx.organisationId, input.id);
    if (p.stage === "PILOT" || p.stage === "WON")
      return { error: await tryStartPilot(ctx.db, actorOf(ctx), p.id) };
    if (p.stage === "TEARDOWN") {
      await ctx.db.$transaction((tx) => linkCrmLead(tx, ctx.organisationId, p));
      return { error: null };
    }
    throw new OutreachError("This prospect isn't at a CRM step yet.");
  }),
});
