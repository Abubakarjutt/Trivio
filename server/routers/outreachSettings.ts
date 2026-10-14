import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { getAiStatus } from "@/server/services/ai-status";
import { loadConfig, loadSearchKeys, requireConfig } from "@/server/services/outreach/config";
import { RESEARCH_MESSAGES } from "@/server/services/outreach/research";
import { createSearch, SEARCH_ENGINES, SearchError } from "@/server/services/outreach/search";
import {
  CadenceSchema,
  NotFoundError,
  PRICE,
  PRICE_MESSAGE,
  SIGNAL_NAMES,
  WeightsSchema,
} from "@/server/services/outreach/types";
import { MAX_PASTE, outreachProcedure } from "./outreach-procedure";

const OfferInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  price: z.union([z.literal(""), z.string().regex(PRICE, PRICE_MESSAGE)]),
  fittingSignals: z.array(z.enum(SIGNAL_NAMES)).max(SIGNAL_NAMES.length),
});
const ApiKey = z.string().trim().min(1).max(200);
const Engine = z.enum(SEARCH_ENGINES);
const KEY_COLUMN = { tavily: "tavilyApiKey", brave: "searchApiKey" } as const;
const masked = (key: string | null) => ({ set: !!key, last4: key ? key.slice(-4) : null });
const toPrice = (p: string) => (p === "" ? null : new Prisma.Decimal(p));

export const outreachSettingsRouter = createTRPCRouter({
  get: outreachProcedure.query(async ({ ctx }) => {
    const settings = await loadConfig(ctx.db, ctx.organisationId);
    const offers = await ctx.db.outreachOffer.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { createdAt: "asc" },
    });
    return {
      settings,
      searchKeys: await loadSearchKeys(ctx.db, ctx.organisationId).then((k) => ({
        tavily: masked(k.tavily),
        brave: masked(k.brave),
      })),
      offers: offers.map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        price: o.price?.toString() ?? null,
        fittingSignals: o.fittingSignals,
        archived: o.archived,
      })),
    };
  }),

  upsert: outreachProcedure
    .input(
      z.object({
        sellerProfile: z.string().trim().min(1).max(MAX_PASTE),
        signalWeights: WeightsSchema,
        cadence: CadenceSchema,
        dailyCap: z.number().int().min(1).max(200),
        weeklyCap: z.number().int().min(1).max(1000),
        hiringKeywords: z.array(z.string().trim().min(1).max(60)).max(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.outreachSettings.upsert({
        where: { organisationId: ctx.organisationId },
        create: { organisationId: ctx.organisationId, ...input },
        update: input,
      });
      return { ok: true };
    }),

  offerCreate: outreachProcedure.input(OfferInput).mutation(async ({ ctx, input }) => {
    const o = await ctx.db.outreachOffer.create({
      data: { organisationId: ctx.organisationId, ...input, price: toPrice(input.price) },
      select: { id: true },
    });
    return { id: o.id };
  }),

  offerUpdate: outreachProcedure
    .input(OfferInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const res = await ctx.db.outreachOffer.updateMany({
        where: { id, organisationId: ctx.organisationId },
        data: { ...rest, price: toPrice(rest.price) },
      });
      if (res.count === 0) throw new NotFoundError("Offer not found.");
      return { ok: true };
    }),

  offerArchive: outreachProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.outreachOffer.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { archived: input.archived },
      });
      if (res.count === 0) throw new NotFoundError("Offer not found.");
      return { ok: true };
    }),

  setSearchKey: outreachProcedure
    .input(z.object({ engine: Engine, apiKey: ApiKey.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireConfig(ctx.db, ctx.organisationId);
      await ctx.db.outreachSettings.update({
        where: { organisationId: ctx.organisationId },
        data: { [KEY_COLUMN[input.engine]]: input.apiKey },
      });
      return { ok: true };
    }),

  // A mutation, not a query: it spends one search and must never be cached or refetched.
  testSearchKey: outreachProcedure
    .input(z.object({ engine: Engine, apiKey: ApiKey.optional() }))
    .mutation(async ({ ctx, input }) => {
      const apiKey =
        input.apiKey ?? (await loadSearchKeys(ctx.db, ctx.organisationId))[input.engine];
      if (!apiKey) return { ok: false as const, message: RESEARCH_MESSAGES.noKey };
      try {
        await createSearch(input.engine, apiKey).search("Trivio", { count: 1 });
        return { ok: true as const, message: null };
      } catch (e) {
        if (e instanceof SearchError) return { ok: false as const, message: e.message };
        throw e;
      }
    }),

  aiStatus: outreachProcedure.query(() => getAiStatus()),
});
