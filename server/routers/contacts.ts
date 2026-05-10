import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { writeAuditLog } from "@/server/services/audit.service";

const contactSchema = z.object({
  type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]),
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
});

export const contactsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "all"]).default("all"),
        search: z.string().optional(),
        includeArchived: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.contact.findMany({
        where: {
          organisationId: ctx.organisationId,
          isArchived: input.includeArchived ? undefined : false,
          type: input.type === "all" ? undefined : input.type,
          ...(input.search
            ? { name: { contains: input.search, mode: "insensitive" } }
            : {}),
        },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { invoices: true, bills: true } },
        },
      });
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.db.contact.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          invoices: { orderBy: { date: "desc" }, take: 5 },
          bills: { orderBy: { date: "desc" }, take: 5 },
        },
      });
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      return contact;
    }),

  create: orgProcedure
    .input(contactSchema)
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.db.contact.create({
        data: {
          organisationId: ctx.organisationId,
          type: input.type,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          address: input.address || null,
          taxNumber: input.taxNumber || null,
        },
      });
      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "Contact",
        entityId: contact.id,
        after: contact,
      });
      return contact;
    }),

  update: orgProcedure
    .input(z.object({ id: z.string() }).merge(contactSchema.partial()))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.contact.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const { id, ...data } = input;
      const updated = await ctx.db.contact.update({
        where: { id },
        data: {
          ...data,
          email: data.email || null,
          phone: data.phone || null,
          address: data.address || null,
          taxNumber: data.taxNumber || null,
        },
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "UPDATE",
        entityType: "Contact",
        entityId: id,
        before: existing,
        after: updated,
      });
      return updated;
    }),

  archive: orgProcedure
    .input(z.object({ id: z.string(), archive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.contact.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.contact.update({
        where: { id: input.id },
        data: { isArchived: input.archive },
      });
    }),
});
