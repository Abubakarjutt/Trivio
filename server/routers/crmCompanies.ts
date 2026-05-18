import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

const CompanySizeEnum = z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]);

export const crmCompaniesRouter = createTRPCRouter({
  list: orgProcedure
    .query(async ({ ctx }) => {
      return ctx.db.crmCompany.findMany({
        where: { organisationId: ctx.organisationId },
        include: {
          linkedContact: { select: { id: true, name: true, email: true } },
          _count: { select: { deals: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const company = await ctx.db.crmCompany.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          linkedContact: true,
          deals: {
            include: { stage: true, contact: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
          activities: {
            include: { createdBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!company) throw new TRPCError({ code: "NOT_FOUND" });
      return company;
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        industry: z.string().optional(),
        website: z.string().url().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        size: CompanySizeEnum.default("SMALL"),
        tags: z.array(z.string()).default([]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { website, ...rest } = input;
      return ctx.db.crmCompany.create({
        data: {
          organisationId: ctx.organisationId,
          ...rest,
          website: website || undefined,
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        industry: z.string().optional(),
        website: z.string().url().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        size: CompanySizeEnum.optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, website, ...rest } = input;
      const existing = await ctx.db.crmCompany.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmCompany.update({
        where: { id },
        data: { ...rest, ...(website !== undefined ? { website: website || undefined } : {}) },
      });
    }),

  linkContact: orgProcedure
    .input(z.object({ id: z.string(), contactId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmCompany.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmCompany.update({
        where: { id: input.id },
        data: { linkedContactId: input.contactId },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmCompany.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.crmCompany.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
