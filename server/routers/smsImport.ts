import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { ChatDbError, checkChatDbAccess, readMessages } from "@/server/services/sms/messages-db";
import { rankSenderSuggestions } from "@/server/services/sms/suggest";
import {
  MAX_AMOUNT,
  isRealIsoDate,
  loadExistingForDedup,
  localDateString,
  processSms,
  type ParsedSmsTransaction,
} from "@/server/services/sms/sms-import.service";
import { createImportCategorizer } from "@/server/services/categorize/category-rules.service";
import { redirectRuleKey } from "@/server/services/categorize/counterparty-token";
import {
  answerKey,
  applyAnswersToFlaggedTransactions,
  applyAnswersToPendingSms,
  applyAnswersToRows,
  type RuleAnswers,
} from "@/server/services/categorize/apply-answers";
import { redactPiiText } from "@/server/services/pii-redaction.service";

const SUGGEST_LOOKBACK_DAYS = 30;
const SUGGEST_SCAN_LIMIT = 2000;

const ruleKeySchema = z.object({
  kind: z.enum(["COUNTERPARTY", "MERCHANT"]),
  matchKey: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});
export const parsedTxn = z.object({
  date: z.string().refine(isRealIsoDate, "Invalid date"),
  description: z.string().min(1).max(500),
  merchantName: z.string().min(1).max(200),
  amount: z.number().finite().nonnegative().lt(MAX_AMOUNT),
  type: z.enum(["DEBIT", "CREDIT"]),
  category: z.string().min(1).max(100),
  mccCode: z.string().max(10),
  mccLabel: z.string().max(200),
  possibleDuplicate: z.boolean(),
  needsCategory: z.boolean().optional(),
  ruleKey: ruleKeySchema.nullable().optional(),
  ruleApplied: z.boolean().optional(),
  rememberRule: z.boolean().optional(),
  userCategorized: z.boolean().optional(),
});
const statusEnum = z.enum(["PENDING_REVIEW", "APPROVED", "DISMISSED", "FAILED", "NO_TRANSACTION"]);
const ids = z.array(z.string().min(1)).min(1).max(500);

export const smsImportRouter = createTRPCRouter({
  getSource: orgProcedure.query(async ({ ctx }) => {
    const source = await ctx.db.smsSource.findUnique({
      where: { organisationId: ctx.organisationId },
    });
    const approvedCount = source
      ? await ctx.db.smsImportItem.count({
          where: { organisationId: ctx.organisationId, status: "APPROVED" },
        })
      : 0;
    return {
      platformSupported: process.platform === "darwin",
      approvedCount,
      source: source && {
        id: source.id,
        enabled: source.enabled,
        senderIds: source.senderIds,
        status: source.status,
        lastError: source.lastError,
        lastSyncedAt: source.lastSyncedAt,
      },
    };
  }),

  saveSource: orgProcedure
    .input(
      z.object({
        senderIds: z.array(z.string().trim().min(1).max(64)).max(20),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const senderIds = [...new Set(input.senderIds)];
      await ctx.db.smsSource.upsert({
        where: { organisationId: ctx.organisationId },
        create: { organisationId: ctx.organisationId, senderIds, enabled: input.enabled },
        update: { senderIds, enabled: input.enabled },
      });
      return { ok: true as const };
    }),

  checkAccess: orgProcedure.mutation(async ({ ctx }) => {
    const result = await checkChatDbAccess();
    if (result === "ok") {
      await ctx.db.smsSource.updateMany({
        where: { organisationId: ctx.organisationId },
        data: { status: "ACTIVE", lastError: null },
      });
    }
    return result;
  }),

  suggestSenders: orgProcedure.query(async () => {
    if (process.platform !== "darwin") return [];
    try {
      const since = new Date(Date.now() - SUGGEST_LOOKBACK_DAYS * 86_400_000);
      const messages = await readMessages({ since }, SUGGEST_SCAN_LIMIT, "desc");
      return rankSenderSuggestions(messages, redactPiiText);
    } catch (err) {
      if (err instanceof ChatDbError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  }),

  listItems: orgProcedure
    .input(z.object({ statuses: z.array(statusEnum).min(1) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.smsImportItem.findMany({
        where: { organisationId: ctx.organisationId, status: { in: input.statuses } },
        orderBy: { receivedAt: "desc" },
        take: 200,
        select: {
          id: true,
          sender: true,
          receivedAt: true,
          text: true,
          parsedJson: true,
          status: true,
          errorMessage: true,
        },
      });
      return items.map(({ parsedJson, ...rest }) => ({
        ...rest,
        parsed: parsedJson as unknown as ParsedSmsTransaction[],
      }));
    }),

  pendingCount: orgProcedure.query(({ ctx }) =>
    ctx.db.smsImportItem.count({
      where: { organisationId: ctx.organisationId, status: "PENDING_REVIEW" },
    })
  ),

  // The client edits what the user sees; which rule a row belongs to (and whether a
  // rule set it) stays whatever the server computed.
  updateItem: orgProcedure
    .input(z.object({ id: z.string().min(1), parsed: z.array(parsedTxn).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const where = {
        id: input.id,
        organisationId: ctx.organisationId,
        status: "PENDING_REVIEW" as const,
      };
      const item = await ctx.db.smsImportItem.findFirst({ where, select: { parsedJson: true } });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const stored = item.parsedJson as unknown as ParsedSmsTransaction[];
      if (stored.length !== input.parsed.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This SMS changed. Refresh and try again.",
        });
      }
      const merged = input.parsed.map((row, i) => {
        const before = stored[i];
        const ruleKey = before?.ruleKey ?? null;
        const ruleApplied = before?.ruleApplied ?? false;
        // A counterparty key carries the direction, so flipping debit/credit
        // re-keys the row; a rule's guess for the other direction no longer holds.
        if (ruleKey?.kind === "COUNTERPARTY" && before && row.type !== before.type) {
          return {
            ...row,
            ruleKey: redirectRuleKey(ruleKey, row.type),
            ruleApplied: false,
            needsCategory: row.userCategorized ? row.needsCategory : true,
          };
        }
        return { ...row, ruleKey, ruleApplied };
      });
      const res = await ctx.db.smsImportItem.updateMany({
        where,
        data: { parsedJson: merged as unknown as Prisma.InputJsonValue },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  // Claim the items (status → APPROVED) first, then read their parsedJson, so an
  // edit that commits before the claim is what gets saved and one after it
  // matches zero rows. A concurrent second approval also claims zero and rolls back.
  approve: orgProcedure.input(z.object({ ids })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const organisationId = ctx.organisationId;
      const pending = await tx.smsImportItem.count({
        where: { id: { in: input.ids }, organisationId, status: "PENDING_REVIEW" },
      });
      if (pending === 0)
        return {
          approved: 0,
          transactions: 0,
          rulesSaved: 0,
          alsoAppliedTo: 0,
          alsoAppliedToSaved: 0,
        };

      const batch = await tx.statementImportBatch.create({
        data: {
          organisationId,
          filename: `SMS import ${localDateString(new Date())}`,
          fileType: "SMS",
          status: "DONE",
          transactionCount: 0,
        },
      });
      const claimed = await tx.smsImportItem.updateMany({
        where: { id: { in: input.ids }, organisationId, status: "PENDING_REVIEW" },
        data: { status: "APPROVED", importBatchId: batch.id },
      });
      if (claimed.count === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Some of these were already approved. Refresh and try again.",
        });
      }

      const items = await tx.smsImportItem.findMany({
        where: { importBatchId: batch.id, organisationId },
        select: { parsedJson: true },
      });
      const rawRows = items.flatMap((it) => it.parsedJson as unknown as ParsedSmsTransaction[]);
      // parsedJson is only as good as whatever wrote it; re-check before it becomes money.
      if (!z.array(parsedTxn).safeParse(rawRows).success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "One of the selected SMS has an invalid amount or date. Fix or dismiss it, then try again.",
        });
      }

      const org = await tx.organisation.findUnique({
        where: { id: organisationId },
        select: { hasSampleData: true },
      });
      if (org?.hasSampleData) {
        await tx.statementTransaction.deleteMany({ where: { organisationId, isSampleData: true } });
        await tx.organisation.update({
          where: { id: organisationId },
          data: { hasSampleData: false },
        });
      }

      // "Always use…" answers (the last answer for a key wins). Worked out before
      // saving so unanswered rows in this same approval take them too.
      const answers: RuleAnswers = new Map();
      const keys = new Map<string, NonNullable<ParsedSmsTransaction["ruleKey"]>>();
      for (const r of rawRows) {
        if (r.ruleKey && r.userCategorized && r.rememberRule !== false) {
          answers.set(answerKey(r.ruleKey), r.category);
          keys.set(answerKey(r.ruleKey), r.ruleKey);
        }
      }
      const rows = applyAnswersToRows(rawRows, answers).rows;

      await tx.statementTransaction.createMany({
        data: rows.map((r) => ({
          organisationId,
          importBatchId: batch.id,
          date: new Date(r.date),
          description: r.description,
          merchantName: r.merchantName,
          amount: r.amount,
          type: r.type,
          category: r.category,
          mccCode: r.mccCode,
          mccLabel: r.mccLabel,
          needsCategory: r.needsCategory ?? false,
          ruleKind: r.ruleKey?.kind ?? null,
          ruleMatchKey: r.ruleKey?.matchKey ?? null,
          ruleLabel: r.ruleKey?.label ?? null,
        })),
      });
      await tx.statementImportBatch.update({
        where: { id: batch.id },
        data: { transactionCount: rows.length },
      });
      for (const [k, category] of answers) {
        const key = keys.get(k)!;
        await tx.categoryRule.upsert({
          where: {
            organisationId_kind_matchKey: {
              organisationId,
              kind: key.kind,
              matchKey: key.matchKey,
            },
          },
          create: {
            organisationId,
            kind: key.kind,
            matchKey: key.matchKey,
            label: key.label,
            category,
          },
          update: { category, label: key.label },
        });
      }
      // Then everything else still waiting on the same key: other SMS in review
      // and saved transactions that are still flagged.
      const alsoAppliedTo = await applyAnswersToPendingSms(tx, organisationId, answers);
      const alsoAppliedToSaved = await applyAnswersToFlaggedTransactions(
        tx,
        organisationId,
        answers
      );
      return {
        approved: claimed.count,
        transactions: rows.length,
        rulesSaved: answers.size,
        alsoAppliedTo,
        alsoAppliedToSaved,
      };
    })
  ),

  dismiss: orgProcedure.input(z.object({ ids })).mutation(async ({ ctx, input }) => {
    const res = await ctx.db.smsImportItem.updateMany({
      where: {
        id: { in: input.ids },
        organisationId: ctx.organisationId,
        status: { in: ["PENDING_REVIEW", "FAILED", "NO_TRANSACTION"] },
      },
      data: { status: "DISMISSED" },
    });
    return { dismissed: res.count };
  }),

  retry: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.smsImportItem.findFirst({
        where: {
          id: input.id,
          organisationId: ctx.organisationId,
          status: { in: ["FAILED", "NO_TRANSACTION"] },
        },
        select: { id: true, text: true, receivedAt: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (!item.text)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This message has no readable text.",
        });
      const existing = await loadExistingForDedup(ctx.db, ctx.organisationId, new Date());
      const categorizer = await createImportCategorizer(ctx.db, ctx.organisationId);
      const result = await processSms(item.text, item.receivedAt, existing, categorizer);
      // Guarded on status: a Hide/dismiss that lands while we re-parse wins.
      const res = await ctx.db.smsImportItem.updateMany({
        where: {
          id: item.id,
          organisationId: ctx.organisationId,
          status: { in: ["FAILED", "NO_TRANSACTION"] },
        },
        data: {
          status: result.status,
          parsedJson: result.parsed as unknown as Prisma.InputJsonValue,
          errorMessage: result.status === "FAILED" ? result.error : null,
          // Now a transaction to review: give it a notification (items from before
          // notifications existed were closed when they were added).
          ...(result.status === "PENDING_REVIEW" ? { notificationClosedAt: null } : {}),
        },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { status: result.status };
    }),

  // One notification per SMS that reached review, until the user closes it.
  notifications: orgProcedure.query(async ({ ctx }) => {
    const items = await ctx.db.smsImportItem.findMany({
      where: {
        organisationId: ctx.organisationId,
        notificationClosedAt: null,
        status: { in: ["PENDING_REVIEW", "APPROVED", "DISMISSED"] },
        // Rowless items are never shown, so keep them out of the 50-row window.
        NOT: { parsedJson: { equals: [] } },
      },
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: { id: true, receivedAt: true, parsedJson: true },
    });
    return items.flatMap(({ id, receivedAt, parsedJson }) => {
      // Defensive: a malformed row is skipped rather than failing the whole list.
      if (!Array.isArray(parsedJson)) return [];
      const rows = parsedJson as unknown as ParsedSmsTransaction[];
      const first = rows[0];
      if (!first || typeof first !== "object") return [];
      return [
        {
          id,
          receivedAt,
          amount: first.amount,
          type: first.type,
          merchantName: first.merchantName,
          category: first.category,
          counterpartyLabel: first.ruleKey?.kind === "COUNTERPARTY" ? first.ruleKey.label : null,
          flagged: !!first.needsCategory,
          ruleApplied: !!first.ruleApplied,
          extraRows: rows.length - 1,
        },
      ];
    });
  }),

  closeNotification: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.smsImportItem.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { notificationClosedAt: new Date() },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
