import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

const ActivityTypeEnum = z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "TASK"]);

export const crmActivitiesRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        contactId: z.string().optional(),
        dealId: z.string().optional(),
        type: ActivityTypeEnum.optional(),
        overdueOnly: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      return ctx.db.crmActivity.findMany({
        where: {
          organisationId: ctx.organisationId,
          ...(input.contactId ? { contactId: input.contactId } : {}),
          ...(input.dealId ? { dealId: input.dealId } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.overdueOnly
            ? { dueDate: { lt: now }, completedAt: null }
            : {}),
        },
        include: {
          contact: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: orgProcedure
    .input(
      z.object({
        type: ActivityTypeEnum,
        subject: z.string().min(1).max(200),
        notes: z.string().optional(),
        dueDate: z.string().datetime().optional(),
        contactId: z.string().optional(),
        dealId: z.string().optional(),
        crmCompanyId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { dueDate, ...rest } = input;
      return ctx.db.crmActivity.create({
        data: {
          organisationId: ctx.organisationId,
          createdById: ctx.user.id,
          ...rest,
          ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        type: ActivityTypeEnum.optional(),
        subject: z.string().min(1).max(200).optional(),
        notes: z.string().optional(),
        dueDate: z.string().datetime().nullable().optional(),
        completedAt: z.string().datetime().nullable().optional(),
        contactId: z.string().nullable().optional(),
        dealId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, dueDate, completedAt, ...rest } = input;
      const existing = await ctx.db.crmActivity.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmActivity.update({
        where: { id },
        data: {
          ...rest,
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
          ...(completedAt !== undefined ? { completedAt: completedAt ? new Date(completedAt) : null } : {}),
        },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmActivity.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.crmActivity.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
