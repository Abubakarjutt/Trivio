import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";
import { convertDealToInvoice, calcWeightedForecast, suggestProbability, toNum } from "@/server/services/crm.service";

export const crmDealsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        pipelineId: z.string().optional(),
        stageId: z.string().optional(),
        contactId: z.string().optional(),
        includeWonLost: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.crmDeal.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
          ...(input.stageId ? { stageId: input.stageId } : {}),
          ...(input.contactId ? { contactId: input.contactId } : {}),
          ...(!input.includeWonLost ? { closedAt: null } : {}),
        },
        include: {
          stage: true,
          pipeline: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true, email: true } },
          crmCompany: { select: { id: true, name: true } },
          invoice: { select: { id: true, number: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deal = await ctx.db.crmDeal.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          stage: true,
          pipeline: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true, email: true, phone: true } },
          crmCompany: { select: { id: true, name: true } },
          invoice: { select: { id: true, number: true, status: true } },
          activities: {
            include: { createdBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      return deal;
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        value: z.number().nonnegative().default(0),
        contactId: z.string(),
        crmCompanyId: z.string().optional(),
        pipelineId: z.string(),
        stageId: z.string(),
        expectedCloseDate: z.string().optional(),
        probability: z.number().int().min(0).max(100).optional(),
        source: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { value, expectedCloseDate, probability, ...rest } = input;

      // Determine probability from stage if not provided
      let prob = probability;
      if (prob == null) {
        const stage = await ctx.db.crmPipelineStage.findUnique({ where: { id: input.stageId } });
        const totalStages = await ctx.db.crmPipelineStage.count({ where: { pipelineId: input.pipelineId } });
        prob = stage ? suggestProbability(stage.order, totalStages) : 50;
      }

      return ctx.db.crmDeal.create({
        data: {
          organisationId: ctx.organisationId,
          ...rest,
          value: new Prisma.Decimal(value),
          probability: prob,
          ...(expectedCloseDate ? { expectedCloseDate: new Date(expectedCloseDate) } : {}),
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        value: z.number().nonnegative().optional(),
        contactId: z.string().optional(),
        crmCompanyId: z.string().nullable().optional(),
        pipelineId: z.string().optional(),
        stageId: z.string().optional(),
        expectedCloseDate: z.string().nullable().optional(),
        probability: z.number().int().min(0).max(100).optional(),
        source: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, value, expectedCloseDate, ...rest } = input;
      const existing = await ctx.db.crmDeal.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmDeal.update({
        where: { id },
        data: {
          ...rest,
          ...(value !== undefined ? { value: new Prisma.Decimal(value) } : {}),
          ...(expectedCloseDate !== undefined
            ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null }
            : {}),
        },
      });
    }),

  close: orgProcedure
    .input(
      z.object({
        id: z.string(),
        outcome: z.enum(["WON", "LOST"]),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmDeal.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      // Find terminal stage
      const terminalStage = await ctx.db.crmPipelineStage.findFirst({
        where: { pipelineId: existing.pipelineId },
        orderBy: { order: "desc" },
      });

      return ctx.db.crmDeal.update({
        where: { id: input.id },
        data: {
          closedAt: new Date(),
          wonLostReason: input.reason ?? input.outcome,
          probability: input.outcome === "WON" ? 100 : 0,
          ...(terminalStage ? { stageId: terminalStage.id } : {}),
        },
      });
    }),

  convertToInvoice: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await convertDealToInvoice(ctx.db as Parameters<typeof convertDealToInvoice>[0], input.id, ctx.organisationId);
      } catch (e: unknown) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Conversion failed" });
      }
    }),

  forecast: orgProcedure
    .query(async ({ ctx }) => {
      const deals = await ctx.db.crmDeal.findMany({
        where: { organisationId: ctx.organisationId, closedAt: null },
        select: {
          id: true,
          value: true,
          probability: true,
          expectedCloseDate: true,
          closedAt: true,
          wonLostReason: true,
          createdAt: true,
        },
      });
      return calcWeightedForecast(
        deals.map((d) => ({ ...d, value: toNum(d.value) }))
      );
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmDeal.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.invoiceId) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete a deal linked to an invoice." });
      await ctx.db.crmDeal.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
