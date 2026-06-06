import { z } from "zod";
import { createTRPCRouter, orgProcedure, protectedProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { exportRateLimiter, deletionRateLimiter } from "@/server/middleware/rateLimit";

// ── Audit helper ──────────────────────────────────────────────────────────────

export async function writeAuditLog(params: {
  db: PrismaClient;
  organisationId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "VOID" | "DELETE" | "EXPORT";
  entityType: string;
  entityId?: string;
  after?: Record<string, unknown>;
}) {
  try {
    await params.db.auditLog.create({
      data: {
        organisationId: params.organisationId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? "",
        after: params.after ?? null,
      },
    });
  } catch {
    // Audit log write failure must never break the main flow
  }
}

export const gdprRouter = createTRPCRouter({
  // ── Audit log ───────────────────────────────────────────────────────────────
  auditLog: orgProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const logs = await ctx.db.auditLog.findMany({
        where: { organisationId: ctx.organisationId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: { user: { select: { name: true, email: true } } },
      });
      return { logs };
    }),

  // ── Data export (GDPR portability) ─────────────────────────────────────────
  exportData: orgProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    exportRateLimiter(`${userId}:exportData`);

    const [user, org, invoices, bills, contacts, journalEntries, budgets, chatMessages] =
      await Promise.all([
        ctx.db.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, role: true, createdAt: true, gdprConsentAt: true },
        }),
        ctx.db.organisation.findUnique({
          where: { id: ctx.organisationId },
          select: { id: true, name: true, currency: true, createdAt: true },
        }),
        ctx.db.invoice.findMany({
          where: { organisationId: ctx.organisationId },
          select: { id: true, number: true, status: true, totalAmount: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        }),
        ctx.db.bill.findMany({
          where: { organisationId: ctx.organisationId },
          select: { id: true, number: true, status: true, totalAmount: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        }),
        ctx.db.contact.findMany({
          where: { organisationId: ctx.organisationId },
          select: { id: true, name: true, email: true, type: true, createdAt: true },
        }),
        ctx.db.journalEntry.findMany({
          where: { organisationId: ctx.organisationId },
          select: { id: true, description: true, date: true, createdAt: true },
          orderBy: { date: "desc" },
          take: 500,
        }),
        ctx.db.budget.findMany({
          where: { organisationId: ctx.organisationId },
          select: { id: true, name: true, category: true, limitAmount: true, period: true, createdAt: true },
        }),
        ctx.db.chatMessage.findMany({
          where: { conversation: { organisationId: ctx.organisationId } },
          select: { id: true, role: true, content: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 1000,
        }),
      ]);

    await writeAuditLog({
      db: ctx.db,
      organisationId: ctx.organisationId,
      userId,
      action: "EXPORT",
      entityType: "Organisation",
      entityId: ctx.organisationId,
      after: { exportedAt: new Date().toISOString() },
    });

    return {
      exportedAt: new Date().toISOString(),
      user,
      organisation: org,
      invoices: invoices.map((i) => ({ ...i, totalAmount: i.totalAmount.toString() })),
      bills: bills.map((b) => ({ ...b, totalAmount: b.totalAmount.toString() })),
      contacts,
      journalEntries,
      budgets: budgets.map((b) => ({ ...b, limitAmount: b.limitAmount.toString() })),
      chatHistory: chatMessages,
    };
  }),

  // ── Delete account (GDPR right to erasure) ─────────────────────────────────
  deleteAccount: protectedProcedure
    .input(z.object({ confirmText: z.literal("DELETE") }))
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      deletionRateLimiter(`${userId}:deleteAccount`);

      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { email: true, organisationId: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      // Write audit log BEFORE the transaction so it survives if the org cascade-deletes audit rows
      if (user.organisationId) {
        await writeAuditLog({
          db: ctx.db,
          organisationId: user.organisationId,
          userId,
          action: "DELETE",
          entityType: "Account",
          entityId: userId,
          after: { reason: "GDPR right to erasure" },
        });
      }

      await ctx.db.$transaction(async (tx) => {
        // Anonymise user PII
        await tx.user.update({
          where: { id: userId },
          data: {
            name: "Deleted User",
            email: `deleted-${userId}@deleted.invalid`,
            hashedPassword: null,
            image: null,
          },
        });

        // If only user in org, delete the organisation (cascades all data)
        if (user.organisationId) {
          const org = await tx.organisation.findUnique({
            where: { id: user.organisationId },
            select: { users: { select: { id: true } } },
          });
          const isOnlyUser = (org?.users ?? []).length === 1;
          if (isOnlyUser) {
            await tx.organisation.delete({ where: { id: user.organisationId } });
          }
        }

        // Delete sessions
        await tx.session.deleteMany({ where: { userId } });
      });

      return { success: true };
    }),

  // ── Purge old chat messages (data retention) ────────────────────────────────
  purgeOldChatMessages: orgProcedure
    .input(z.object({ olderThanDays: z.number().min(30).max(3650).default(365) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.olderThanDays);

      const result = await ctx.db.chatMessage.deleteMany({
        where: {
          conversation: { organisationId: ctx.organisationId },
          createdAt: { lt: cutoff },
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organisationId: ctx.organisationId,
        userId,
        action: "DELETE",
        entityType: "ChatMessage",
        after: { deletedCount: result.count, olderThanDays: input.olderThanDays },
      });

      return { deleted: result.count };
    }),

  // ── Record GDPR consent ─────────────────────────────────────────────────────
  recordConsent: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const headersList = await headers();
    const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? headersList.get("x-real-ip")
      ?? "unknown";

    const consentAt = new Date();
    await ctx.db.user.update({
      where: { id: userId },
      data: { gdprConsentAt: consentAt },
    });

    if (ctx.organisationId) {
      await writeAuditLog({
        db: ctx.db,
        organisationId: ctx.organisationId,
        userId,
        action: "CREATE",
        entityType: "GdprConsent",
        entityId: userId,
        after: { consentAt: consentAt.toISOString(), policyVersion: "2026-06", ipAddress: ip },
      });
    }

    return { success: true };
  }),
});
