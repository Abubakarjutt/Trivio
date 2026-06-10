import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import {
  createJournalEntry,
  voidJournalEntry,
  buildIncomeEntry,
  buildExpenseEntry,
} from "@/server/services/accounting.service";
import { writeAuditLog } from "@/server/services/audit.service";

const PAGE_SIZE = 50;

export const transactionsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        search: z.string().optional(),
        accountId: z.string().optional(),
        type: z.enum(["income", "expense", "all"]).default("all"),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        showVoided: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        organisationId: ctx.organisationId,
        isVoid: input.showVoided ? undefined : false,
        ...(input.search
          ? { OR: [{ description: { contains: input.search, mode: "insensitive" as const } }, { reference: { contains: input.search, mode: "insensitive" as const } }] }
          : {}),
        ...(input.dateFrom || input.dateTo
          ? {
              date: {
                ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                ...(input.dateTo ? { lte: input.dateTo } : {}),
              },
            }
          : {}),
        ...(input.accountId
          ? { lines: { some: { accountId: input.accountId } } }
          : {}),
      };

      const [total, entries] = await Promise.all([
        ctx.db.journalEntry.count({ where }),
        ctx.db.journalEntry.findMany({
          where,
          include: {
            lines: {
              include: { account: { select: { id: true, code: true, name: true, type: true } } },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip: (input.page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      return { entries, total, pages: Math.ceil(total / PAGE_SIZE) };
    }),

  createIncome: orgProcedure
    .input(
      z.object({
        date: z.date(),
        description: z.string().min(1),
        reference: z.string().optional(),
        amount: z.number().positive(),
        incomeAccountId: z.string(),
        cashAccountId: z.string(),
        taxAmount: z.number().min(0).optional(),
        taxAccountId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const entryData = buildIncomeEntry({
        date: input.date,
        description: input.description,
        amount: input.amount,
        incomeAccountId: input.incomeAccountId,
        cashAccountId: input.cashAccountId,
        taxAmount: input.taxAmount,
        taxAccountId: input.taxAccountId,
      });

      const entry = await createJournalEntry(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        ...entryData,
        reference: input.reference,
        source: "MANUAL",
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: entry.id,
        after: { id: entry.id, description: entry.description, source: entry.source },
      });

      return entry;
    }),

  createExpense: orgProcedure
    .input(
      z.object({
        date: z.date(),
        description: z.string().min(1),
        reference: z.string().optional(),
        amount: z.number().positive(),
        expenseAccountId: z.string(),
        cashAccountId: z.string(),
        taxAmount: z.number().min(0).optional(),
        taxAccountId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const entryData = buildExpenseEntry({
        date: input.date,
        description: input.description,
        amount: input.amount,
        expenseAccountId: input.expenseAccountId,
        cashAccountId: input.cashAccountId,
        taxAmount: input.taxAmount,
        taxAccountId: input.taxAccountId,
      });

      const entry = await createJournalEntry(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        ...entryData,
        reference: input.reference,
        source: "MANUAL",
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: entry.id,
        after: { id: entry.id, description: entry.description },
      });

      return entry;
    }),

  // Power-user endpoint: raw double-entry journal entry
  createRaw: orgProcedure
    .input(
      z.object({
        date: z.date(),
        description: z.string().min(1),
        reference: z.string().optional(),
        lines: z
          .array(
            z.object({
              accountId: z.string(),
              debit: z.number().min(0).optional(),
              credit: z.number().min(0).optional(),
              description: z.string().optional(),
            })
          )
          .min(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await createJournalEntry(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        date: input.date,
        description: input.description,
        reference: input.reference,
        source: "MANUAL",
        lines: input.lines,
      });

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: entry.id,
        after: { description: input.description, lines: input.lines.length },
      });

      return entry;
    }),

  void: orgProcedure
    .input(
      z.object({
        id: z.string(),
        reason: z.string().min(1).default("Voided by user"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.journalEntry.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      if (entry.source !== "MANUAL") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only manually created entries can be voided here. Void the originating invoice or bill instead.",
        });
      }

      const reversal = await voidJournalEntry(
        ctx.db,
        input.id,
        ctx.organisationId,
        ctx.session.user.id,
        input.reason
      );

      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "VOID",
        entityType: "JournalEntry",
        entityId: input.id,
        after: { reason: input.reason, reversalId: reversal.id },
      });

      return reversal;
    }),

  importCSV: orgProcedure
    .input(
      z.object({
        rows: z.array(
          z.object({
            date: z.date(),
            description: z.string(),
            amount: z.number(),
            type: z.enum(["income", "expense"]),
            accountId: z.string(),
            cashAccountId: z.string(),
          })
        ).max(500, "Cannot import more than 500 rows at once"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results = { created: 0, failed: 0, errors: [] as string[] };

      for (const row of input.rows) {
        try {
          const entryData =
            row.type === "income"
              ? buildIncomeEntry({
                  date: row.date,
                  description: row.description,
                  amount: Math.abs(row.amount),
                  incomeAccountId: row.accountId,
                  cashAccountId: row.cashAccountId,
                })
              : buildExpenseEntry({
                  date: row.date,
                  description: row.description,
                  amount: Math.abs(row.amount),
                  expenseAccountId: row.accountId,
                  cashAccountId: row.cashAccountId,
                });

          await createJournalEntry(ctx.db, {
            organisationId: ctx.organisationId,
            userId: ctx.session.user.id,
            ...entryData,
            source: "BANK_IMPORT",
          });
          results.created++;
        } catch (err) {
          results.failed++;
          results.errors.push(`Row "${row.description}": ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return results;
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const entry = await ctx.db.journalEntry.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          lines: {
            include: { account: { select: { id: true, code: true, name: true, type: true, normalBalance: true } } },
          },
        },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      return entry;
    }),
});
