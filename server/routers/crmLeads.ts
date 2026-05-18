import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { convertLeadToContact } from "@/server/services/crm.service";

const LeadSourceEnum = z.enum(["WEBSITE", "REFERRAL", "SOCIAL_MEDIA", "COLD_OUTREACH", "EVENT", "ADVERTISING", "OTHER"]);
const LeadStatusEnum = z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"]);

export const crmLeadsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        status: LeadStatusEnum.optional(),
        source: LeadSourceEnum.optional(),
        assignedToId: z.string().optional(),
        tag: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.crmLead.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.source ? { source: input.source } : {}),
          ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
          ...(input.tag ? { tags: { has: input.tag } } : {}),
        },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          convertedContact: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const lead = await ctx.db.crmLead.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          convertedContact: { select: { id: true, name: true } },
        },
      });
      if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      return lead;
    }),

  create: orgProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        companyName: z.string().optional(),
        jobTitle: z.string().optional(),
        estimatedValue: z.number().nonnegative().optional(),
        source: LeadSourceEnum.default("OTHER"),
        notes: z.string().optional(),
        tags: z.array(z.string()).default([]),
        assignedToId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { estimatedValue, email, ...rest } = input;
      return ctx.db.crmLead.create({
        data: {
          organisationId: ctx.organisationId,
          ...rest,
          email: email || undefined,
          status: "NEW",
          ...(estimatedValue != null ? { estimatedValue } : {}),
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        firstName: z.string().min(1).max(100).optional(),
        lastName: z.string().min(1).max(100).optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        companyName: z.string().optional(),
        jobTitle: z.string().optional(),
        estimatedValue: z.number().nonnegative().optional(),
        source: LeadSourceEnum.optional(),
        notes: z.string().optional(),
        status: LeadStatusEnum.optional(),
        tags: z.array(z.string()).optional(),
        assignedToId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, estimatedValue, email, ...rest } = input;
      const existing = await ctx.db.crmLead.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmLead.update({
        where: { id },
        data: {
          ...rest,
          ...(email !== undefined ? { email: email || undefined } : {}),
          ...(estimatedValue !== undefined ? { estimatedValue } : {}),
        },
      });
    }),

  convert: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await convertLeadToContact(ctx.db as Parameters<typeof convertLeadToContact>[0], input.id, ctx.organisationId);
      } catch (e: unknown) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Conversion failed" });
      }
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmLead.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.crmLead.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
