import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { createJournalEntry } from "@/server/services/accounting.service";
import { autoMatchBankAccount } from "@/server/services/reconciliation.service";

const PAGE_SIZE = 50;

export const bankAccountsRouter = createTRPCRouter({
  // ── List bank accounts for the org ─────────────────────────────────────────
  list: orgProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db.bankAccount.findMany({
      where: { organisationId: ctx.organisationId },
      include: {
        chartAccount: { select: { id: true, code: true, name: true } },
        _count: {
          select: {
            statementLines: { where: { status: "UNMATCHED" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return accounts;
  }),

  // ── Create a bank account ────────────────────────────────────────────────
  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1),
        chartAccountId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the chart account belongs to this org and is an ASSET
      const chartAccount = await ctx.db.chartAccount.findFirst({
        where: {
          id: input.chartAccountId,
          organisationId: ctx.organisationId,
          type: "ASSET",
          isArchived: false,
        },
      });
      if (!chartAccount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chart account not found or is not an ASSET account",
        });
      }

      return ctx.db.bankAccount.create({
        data: {
          organisationId: ctx.organisationId,
          name: input.name,
          accountId: input.chartAccountId,
        },
        include: {
          chartAccount: { select: { id: true, code: true, name: true } },
        },
      });
    }),

  // ── Get a single bank account with recent lines ──────────────────────────
  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await ctx.db.bankAccount.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          chartAccount: { select: { id: true, code: true, name: true, type: true } },
          statementLines: {
            orderBy: { date: "desc" },
            take: 20,
            include: {
              journalLine: {
                include: {
                  journalEntry: { select: { id: true, description: true, date: true } },
                },
              },
            },
          },
        },
      });
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      return account;
    }),

  // ── Import statement lines from CSV ────────────────────────────────────────
  importStatementLines: orgProcedure
    .input(
      z.object({
        bankAccountId: z.string(),
        lines: z.array(
          z.object({
            date: z.date(),
            description: z.string(),
            amount: z.string(), // decimal string to avoid float issues
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const bankAccount = await ctx.db.bankAccount.findFirst({
        where: { id: input.bankAccountId, organisationId: ctx.organisationId },
      });
      if (!bankAccount) throw new TRPCError({ code: "NOT_FOUND" });

      const data = input.lines.map((line) => ({
        bankAccountId: input.bankAccountId,
        date: line.date,
        description: line.description,
        amount: new Prisma.Decimal(line.amount),
        status: "UNMATCHED" as const,
      }));

      const result = await ctx.db.bankStatementLine.createMany({ data });
      return { count: result.count };
    }),

  // ── Paginated statement lines, optional status filter ────────────────────
  getStatementLines: orgProcedure
    .input(
      z.object({
        bankAccountId: z.string(),
        status: z
          .enum(["UNMATCHED", "MATCHED", "EXCLUDED", "CREATED"])
          .optional(),
        page: z.number().min(1).default(1),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const bankAccount = await ctx.db.bankAccount.findFirst({
        where: { id: input.bankAccountId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!bankAccount) throw new TRPCError({ code: "NOT_FOUND" });

      const where = {
        bankAccountId: input.bankAccountId,
        ...(input.status ? { status: input.status } : {}),
      };

      const [total, lines] = await Promise.all([
        ctx.db.bankStatementLine.count({ where }),
        ctx.db.bankStatementLine.findMany({
          where,
          include: {
            journalLine: {
              include: {
                journalEntry: { select: { id: true, description: true, date: true } },
                account: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { date: "desc" },
          skip: (input.page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      return { lines, total, pages: Math.ceil(total / PAGE_SIZE) };
    }),

  // ── Auto-match algorithm ─────────────────────────────────────────────────
  autoMatch: orgProcedure
    .input(z.object({ bankAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const bankAccount = await ctx.db.bankAccount.findFirst({
        where: { id: input.bankAccountId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!bankAccount) throw new TRPCError({ code: "NOT_FOUND" });

      const count = await autoMatchBankAccount(
        ctx.db,
        input.bankAccountId,
        ctx.organisationId
      );
      return { matched: count };
    }),

  // ── Manually match a statement line to a journal line ─────────────────────
  matchLine: orgProcedure
    .input(
      z.object({
        bankStatementLineId: z.string(),
        journalLineId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify statement line belongs to org
      const statementLine = await ctx.db.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          bankAccount: { organisationId: ctx.organisationId },
        },
      });
      if (!statementLine) throw new TRPCError({ code: "NOT_FOUND" });
      if (statementLine.status === "MATCHED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line is already matched" });
      }

      // Verify journal line belongs to org
      const journalLine = await ctx.db.journalLine.findFirst({
        where: {
          id: input.journalLineId,
          journalEntry: { organisationId: ctx.organisationId, isVoid: false },
        },
        select: { id: true },
      });
      if (!journalLine) throw new TRPCError({ code: "NOT_FOUND", message: "Journal line not found" });

      return ctx.db.bankStatementLine.update({
        where: { id: input.bankStatementLineId },
        data: { status: "MATCHED", journalLineId: input.journalLineId },
      });
    }),

  // ── Unmatch a matched line ────────────────────────────────────────────────
  unmatchLine: orgProcedure
    .input(z.object({ bankStatementLineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const statementLine = await ctx.db.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          bankAccount: { organisationId: ctx.organisationId },
        },
      });
      if (!statementLine) throw new TRPCError({ code: "NOT_FOUND" });
      if (statementLine.status !== "MATCHED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line is not matched" });
      }

      return ctx.db.bankStatementLine.update({
        where: { id: input.bankStatementLineId },
        data: { status: "UNMATCHED", journalLineId: null },
      });
    }),

  // ── Exclude a line (bank charges, etc.) ──────────────────────────────────
  excludeLine: orgProcedure
    .input(z.object({ bankStatementLineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const statementLine = await ctx.db.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          bankAccount: { organisationId: ctx.organisationId },
        },
      });
      if (!statementLine) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.bankStatementLine.update({
        where: { id: input.bankStatementLineId },
        data: { status: "EXCLUDED", journalLineId: null },
      });
    }),

  // ── Restore an excluded/matched line back to UNMATCHED ───────────────────
  restoreLine: orgProcedure
    .input(z.object({ bankStatementLineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const statementLine = await ctx.db.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          bankAccount: { organisationId: ctx.organisationId },
        },
      });
      if (!statementLine) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.bankStatementLine.update({
        where: { id: input.bankStatementLineId },
        data: { status: "UNMATCHED", journalLineId: null },
      });
    }),

  // ── Create a journal entry for an unmatched line ─────────────────────────
  createJournalForLine: orgProcedure
    .input(
      z.object({
        bankStatementLineId: z.string(),
        accountId: z.string(), // contra account
        description: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Load the statement line
      const statementLine = await ctx.db.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          bankAccount: { organisationId: ctx.organisationId },
          status: "UNMATCHED",
        },
        include: {
          bankAccount: { select: { accountId: true } },
        },
      });
      if (!statementLine) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Statement line not found or not UNMATCHED",
        });
      }

      const amount = Number(statementLine.amount);
      const bankChartAccountId = statementLine.bankAccount.accountId;

      // Build a balanced 2-line journal entry
      // Positive amount = money in → debit bank account, credit contra
      // Negative amount = money out → debit contra, credit bank account
      let lines: { accountId: string; debit?: number; credit?: number; description?: string }[];

      if (amount > 0) {
        lines = [
          { accountId: bankChartAccountId, debit: amount, description: input.description },
          { accountId: input.accountId, credit: amount, description: input.description },
        ];
      } else {
        const absAmount = Math.abs(amount);
        lines = [
          { accountId: input.accountId, debit: absAmount, description: input.description },
          { accountId: bankChartAccountId, credit: absAmount, description: input.description },
        ];
      }

      const entry = await createJournalEntry(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        date: statementLine.date,
        description: input.description,
        source: "BANK_IMPORT",
        lines,
      });

      // Find the journal line that corresponds to the bank account and link it
      const bankJournalLine = entry.lines.find(
        (l) => l.accountId === bankChartAccountId
      );

      if (bankJournalLine) {
        await ctx.db.bankStatementLine.update({
          where: { id: input.bankStatementLineId },
          data: { status: "CREATED", journalLineId: bankJournalLine.id },
        });
      }

      return entry;
    }),

  // ── Reconciliation summary ────────────────────────────────────────────────
  getReconciliationSummary: orgProcedure
    .input(z.object({ bankAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const bankAccount = await ctx.db.bankAccount.findFirst({
        where: { id: input.bankAccountId, organisationId: ctx.organisationId },
        include: {
          chartAccount: { select: { id: true, code: true, name: true, normalBalance: true } },
        },
      });
      if (!bankAccount) throw new TRPCError({ code: "NOT_FOUND" });

      // Count and sum by status
      const statusGroups = await ctx.db.bankStatementLine.groupBy({
        by: ["status"],
        where: { bankAccountId: input.bankAccountId },
        _count: { id: true },
        _sum: { amount: true },
      });

      // Compute book balance from journal lines for the bank's chart account
      const bookBalanceResult = await ctx.db.journalLine.aggregate({
        where: {
          accountId: bankAccount.accountId,
          journalEntry: { organisationId: ctx.organisationId, isVoid: false },
        },
        _sum: { debit: true, credit: true },
      });

      const totalDebits = Number(bookBalanceResult._sum.debit ?? 0);
      const totalCredits = Number(bookBalanceResult._sum.credit ?? 0);
      const bookBalance =
        bankAccount.chartAccount.normalBalance === "DEBIT"
          ? totalDebits - totalCredits
          : totalCredits - totalDebits;

      const summary = {
        UNMATCHED: { count: 0, sum: 0 },
        MATCHED: { count: 0, sum: 0 },
        EXCLUDED: { count: 0, sum: 0 },
        CREATED: { count: 0, sum: 0 },
      };

      for (const group of statusGroups) {
        summary[group.status] = {
          count: group._count.id,
          sum: Number(group._sum.amount ?? 0),
        };
      }

      return {
        summary,
        bankBalance: Number(bankAccount.currentBalance),
        bookBalance,
      };
    }),

  // ── Unmatched journal lines for this bank's chart account ─────────────────
  getUnmatchedJournalLines: orgProcedure
    .input(
      z.object({
        bankAccountId: z.string(),
        page: z.number().min(1).default(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const bankAccount = await ctx.db.bankAccount.findFirst({
        where: { id: input.bankAccountId, organisationId: ctx.organisationId },
        select: { accountId: true },
      });
      if (!bankAccount) throw new TRPCError({ code: "NOT_FOUND" });

      const where = {
        accountId: bankAccount.accountId,
        journalEntry: { organisationId: ctx.organisationId, isVoid: false },
        bankStatementLines: { none: {} },
      };

      const [total, lines] = await Promise.all([
        ctx.db.journalLine.count({ where }),
        ctx.db.journalLine.findMany({
          where,
          include: {
            journalEntry: { select: { id: true, description: true, date: true, reference: true } },
            account: { select: { id: true, code: true, name: true } },
          },
          orderBy: { journalEntry: { date: "desc" } },
          skip: (input.page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      return { lines, total, pages: Math.ceil(total / PAGE_SIZE) };
    }),
});
