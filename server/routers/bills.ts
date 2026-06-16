import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import {
  createBill,
  postBillToLedger,
  recordBillPayment,
  voidBill,
  calcBillTotals,
  effectiveBillStatus,
} from "@/server/services/bill.service";
import { writeAuditLog } from "@/server/services/audit.service";
import { Prisma } from "@prisma/client";
import { clearAccountingSampleData } from "@/lib/accounting-sample-data";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRateCode: z.string().optional(),
  taxAmount: z.number().min(0).default(0),
  sortOrder: z.number().optional(),
});

const PAGE_SIZE = 50;

export const billsRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        status: z.enum(["ALL", "DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"]).default("ALL"),
        contactId: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const where = {
        organisationId: ctx.organisationId,
        ...(input.status !== "ALL" && input.status !== "OVERDUE"
          ? { status: input.status }
          : input.status === "OVERDUE"
          ? { dueDate: { lt: now }, status: { in: ["SENT", "PARTIAL"] as ("SENT" | "PARTIAL")[] } }
          : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.search
          ? {
              OR: [
                { number: { contains: input.search, mode: "insensitive" as const } },
                { contact: { name: { contains: input.search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };

      const [total, bills] = await Promise.all([
        ctx.db.bill.count({ where }),
        ctx.db.bill.findMany({
          where,
          include: { contact: { select: { id: true, name: true, email: true } } },
          orderBy: [{ date: "desc" }, { number: "desc" }],
          skip: (input.page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const items = bills.map((bill) => ({
        ...bill,
        contact: bill.contact,
        effectiveStatus: effectiveBillStatus(bill),
        amountDue: Number(bill.totalAmount) - Number(bill.amountPaid),
      }));

      return { items, total, pages: Math.ceil(total / PAGE_SIZE) };
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const bill = await ctx.db.bill.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: { contact: true, lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...bill,
        effectiveStatus: effectiveBillStatus(bill),
        amountDue: Number(bill.totalAmount) - Number(bill.amountPaid),
      };
    }),

  create: orgProcedure
    .input(
      z.object({
        contactId: z.string(),
        date: z.date(),
        dueDate: z.date(),
        lines: z.array(lineSchema).min(1),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Clear sample data on first real bill
      const org = await ctx.db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { hasSampleData: true } });
      if (org?.hasSampleData) await clearAccountingSampleData(ctx.db as any, ctx.organisationId);

      const bill = await createBill(ctx.db, { organisationId: ctx.organisationId, ...input });
      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "Bill",
        entityId: bill.id,
        after: { number: bill.number, total: bill.totalAmount },
      });
      return bill;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        contactId: z.string().optional(),
        date: z.date().optional(),
        dueDate: z.date().optional(),
        lines: z.array(lineSchema).min(1).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.bill.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft bills can be edited" });
      }

      const { id, lines, ...data } = input;
      const totals = lines ? calcBillTotals(lines) : null;

      return ctx.db.bill.update({
        where: { id },
        data: {
          ...data,
          ...(totals
            ? {
                subtotal: new Prisma.Decimal(totals.subtotal),
                taxAmount: new Prisma.Decimal(totals.taxAmount),
                totalAmount: new Prisma.Decimal(totals.totalAmount),
              }
            : {}),
          ...(lines
            ? {
                lines: {
                  deleteMany: {},
                  create: lines.map((l, i) => ({
                    description: l.description,
                    quantity: new Prisma.Decimal(l.quantity),
                    unitPrice: new Prisma.Decimal(l.unitPrice),
                    amount: new Prisma.Decimal(l.quantity * l.unitPrice),
                    taxRateCode: l.taxRateCode,
                    taxAmount: new Prisma.Decimal(l.taxAmount ?? 0),
                    sortOrder: l.sortOrder ?? i,
                  })),
                },
              }
            : {}),
        },
        include: { lines: true, contact: true },
      });
    }),

  // Approve: post to ledger and mark SENT
  approve: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const bill = await ctx.db.bill.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
      if (bill.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft bills can be approved" });
      }

      await postBillToLedger(ctx.db, input.id, ctx.organisationId, ctx.session.user.id);
      await ctx.db.bill.update({ where: { id: input.id }, data: { status: "SENT" } });
      return { success: true };
    }),

  recordPayment: orgProcedure
    .input(
      z.object({
        id: z.string(),
        amount: z.number().positive(),
        cashAccountId: z.string(),
        date: z.date(),
        reference: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bill = await ctx.db.bill.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
      if (bill.status === "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot record payment against a draft bill — approve it first" });
      }

      const outstanding = Number(bill.totalAmount) - Number(bill.amountPaid);
      if (input.amount > outstanding + 0.001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Payment exceeds outstanding balance of ${outstanding.toFixed(2)}`,
        });
      }

      return recordBillPayment(ctx.db, {
        billId: input.id,
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        amount: input.amount,
        cashAccountId: input.cashAccountId,
        date: input.date,
        reference: input.reference,
      });
    }),

  void: orgProcedure
    .input(z.object({ id: z.string(), reason: z.string().min(1).default("Voided by user") }))
    .mutation(async ({ ctx, input }) => {
      await voidBill(ctx.db, input.id, ctx.organisationId, ctx.session.user.id, input.reason);
      return { success: true };
    }),

  // AP Aging: groups outstanding bills into age buckets
  apAging: orgProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const outstanding = await ctx.db.bill.findMany({
      where: {
        organisationId: ctx.organisationId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      include: { contact: { select: { name: true } } },
    });

    type Bucket = { current: number; days30: number; days60: number; days90: number; over90: number; total: number };

    const byContact: Record<string, { contactName: string } & Bucket> = {};
    const totals: Bucket = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };

    for (const bill of outstanding) {
      const balance = Number(bill.totalAmount) - Number(bill.amountPaid);
      if (balance <= 0) continue;

      const daysPastDue = Math.floor((now.getTime() - new Date(bill.dueDate).getTime()) / 86400000);
      const bucket =
        daysPastDue <= 0 ? "current"
        : daysPastDue <= 30 ? "days30"
        : daysPastDue <= 60 ? "days60"
        : daysPastDue <= 90 ? "days90"
        : "over90";

      if (!byContact[bill.contactId]) {
        byContact[bill.contactId] = { contactName: bill.contact.name, current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
      }
      byContact[bill.contactId]![bucket] += balance;
      byContact[bill.contactId]!.total += balance;
      totals[bucket] += balance;
      totals.total += balance;
    }

    return {
      rows: Object.values(byContact).sort((a, b) => b.total - a.total),
      totals,
      billCount: outstanding.length,
    };
  }),
});
