import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { writeAuditLog } from "@/server/services/audit.service";

export const accountsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        includeArchived: z.boolean().default(false),
        type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.chartAccount.findMany({
        where: {
          organisationId: ctx.organisationId,
          isArchived: input.includeArchived ? undefined : false,
          type: input.type,
        },
        include: { parent: { select: { id: true, name: true, code: true } } },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
      });
    }),

  // Flat list grouped by type — used in dropdowns
  listFlat: orgProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db.chartAccount.findMany({
      where: { organisationId: ctx.organisationId, isArchived: false },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    });
    return accounts;
  }),

  create: orgProcedure
    .input(
      z.object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(100),
        type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
        normalBalance: z.enum(["DEBIT", "CREDIT"]),
        description: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.chartAccount.findUnique({
        where: { organisationId_code: { organisationId: ctx.organisationId, code: input.code } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `Account code ${input.code} already exists` });
      }

      const account = await ctx.db.chartAccount.create({
        data: {
          organisationId: ctx.organisationId,
          code: input.code,
          name: input.name,
          type: input.type,
          normalBalance: input.normalBalance,
          description: input.description,
          parentId: input.parentId,
        },
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "ChartAccount",
        entityId: account.id,
        after: account,
      });

      return account;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        parentId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.chartAccount.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({ code: "FORBIDDEN", message: "System accounts cannot be modified" });
      }

      const updated = await ctx.db.chartAccount.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          parentId: input.parentId,
        },
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "UPDATE",
        entityType: "ChartAccount",
        entityId: input.id,
        before: existing,
        after: updated,
      });

      return updated;
    }),

  archive: orgProcedure
    .input(z.object({ id: z.string(), archive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.chartAccount.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({ code: "FORBIDDEN", message: "System accounts cannot be archived" });
      }

      return ctx.db.chartAccount.update({
        where: { id: input.id },
        data: { isArchived: input.archive },
      });
    }),

  getBalances: orgProcedure
    .input(z.object({ asOf: z.date().optional() }))
    .query(async ({ ctx, input }) => {
      const accounts = await ctx.db.chartAccount.findMany({
        where: { organisationId: ctx.organisationId, isArchived: false },
        include: {
          journalLines: {
            where: {
              journalEntry: {
                organisationId: ctx.organisationId,
                isVoid: false,
                ...(input.asOf ? { date: { lte: input.asOf } } : {}),
              },
            },
            select: { debit: true, credit: true },
          },
        },
        orderBy: [{ type: "asc" }, { code: "asc" }],
      });

      return accounts.map((account) => {
        const totalDebits = account.journalLines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
        const totalCredits = account.journalLines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
        const balance =
          account.normalBalance === "DEBIT" ? totalDebits - totalCredits : totalCredits - totalDebits;
        return {
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          parentId: account.parentId,
          isSystem: account.isSystem,
          isArchived: account.isArchived,
          balance,
          totalDebits,
          totalCredits,
        };
      });
    }),
});
