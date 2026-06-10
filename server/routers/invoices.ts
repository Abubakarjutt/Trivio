import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import {
  createInvoice,
  postInvoiceToLedger,
  recordInvoicePayment,
  voidInvoice,
  calcInvoiceTotals,
  effectiveStatus,
} from "@/server/services/invoice.service";
import { sendInvoiceEmail } from "@/server/services/email.service";
import { writeAuditLog } from "@/server/services/audit.service";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Prisma } from "@prisma/client";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRateCode: z.string().optional(),
  taxAmount: z.number().min(0).default(0),
  sortOrder: z.number().optional(),
});

const PAGE_SIZE = 50;

export const invoicesRouter = createTRPCRouter({
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
        ...(input.search ? { OR: [
          { number: { contains: input.search, mode: "insensitive" as const } },
          { contact: { name: { contains: input.search, mode: "insensitive" as const } } },
        ]} : {}),
      };

      const [total, invoices] = await Promise.all([
        ctx.db.invoice.count({ where }),
        ctx.db.invoice.findMany({
          where,
          include: { contact: { select: { id: true, name: true, email: true } } },
          orderBy: [{ date: "desc" }, { number: "desc" }],
          skip: (input.page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const items = invoices.map((inv) => ({
        ...inv,
        contact: inv.contact,
        effectiveStatus: effectiveStatus(inv),
        amountDue: Number(inv.totalAmount) - Number(inv.amountPaid),
      }));

      return { items, total, pages: Math.ceil(total / PAGE_SIZE) };
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          contact: true,
          lines: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...invoice, effectiveStatus: effectiveStatus(invoice), amountDue: Number(invoice.totalAmount) - Number(invoice.amountPaid) };
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
      const invoice = await createInvoice(ctx.db, {
        organisationId: ctx.organisationId,
        ...input,
      });
      await writeAuditLog(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.session.user.id,
        action: "CREATE",
        entityType: "Invoice",
        entityId: invoice.id,
        after: { number: invoice.number, total: invoice.totalAmount },
      });
      return invoice;
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
      const existing = await ctx.db.invoice.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft invoices can be edited" });
      }

      const { id, lines, ...data } = input;
      const totals = lines ? calcInvoiceTotals(lines) : null;

      const updated = await ctx.db.invoice.update({
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
      return updated;
    }),

  // Mark as sent: post to ledger and optionally email the contact
  send: orgProcedure
    .input(
      z.object({
        id: z.string(),
        sendEmail: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: { contact: true, lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      if (invoice.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft invoices can be sent" });
      }

      await postInvoiceToLedger(ctx.db, input.id, ctx.organisationId, ctx.session.user.id);
      await ctx.db.invoice.update({ where: { id: input.id }, data: { status: "SENT" } });

      if (input.sendEmail && invoice.contact.email) {
        const org = await ctx.db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, currency: true } });
        try {
          await sendInvoiceEmail({
            to: invoice.contact.email,
            toName: invoice.contact.name,
            fromName: org?.name ?? "AutoAccounts",
            invoiceNumber: invoice.number,
            invoiceDate: formatDate(invoice.date),
            dueDate: formatDate(invoice.dueDate),
            totalAmount: formatCurrency(Number(invoice.totalAmount), org?.currency ?? "USD"),
            currency: org?.currency ?? "USD",
          });
        } catch (err) {
          console.error("Failed to send invoice email:", err);
          // Email failure doesn't block invoice posting
        }
      }

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
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      if (invoice.status === "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot record payment against a draft invoice — post it first" });
      }

      const outstanding = Number(invoice.totalAmount) - Number(invoice.amountPaid);
      if (input.amount > outstanding + 0.001) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Payment amount exceeds outstanding balance of ${outstanding.toFixed(2)}` });
      }

      return recordInvoicePayment(ctx.db, {
        invoiceId: input.id,
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
      await voidInvoice(ctx.db, input.id, ctx.organisationId, ctx.session.user.id, input.reason);
      return { success: true };
    }),

  // AR Aging: groups outstanding invoices into age buckets
  arAging: orgProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const outstanding = await ctx.db.invoice.findMany({
      where: {
        organisationId: ctx.organisationId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      include: { contact: { select: { name: true } } },
    });

    type Bucket = { current: number; days30: number; days60: number; days90: number; over90: number; total: number };

    const byContact: Record<string, { contactName: string } & Bucket> = {};
    const totals: Bucket = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };

    for (const inv of outstanding) {
      const balance = Number(inv.totalAmount) - Number(inv.amountPaid);
      if (balance <= 0) continue;

      const daysPastDue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      const bucket =
        daysPastDue <= 0 ? "current"
        : daysPastDue <= 30 ? "days30"
        : daysPastDue <= 60 ? "days60"
        : daysPastDue <= 90 ? "days90"
        : "over90";

      if (!byContact[inv.contactId]) {
        byContact[inv.contactId] = { contactName: inv.contact.name, current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
      }
      byContact[inv.contactId]![bucket] += balance;
      byContact[inv.contactId]!.total += balance;
      totals[bucket] += balance;
      totals.total += balance;
    }

    return {
      rows: Object.values(byContact).sort((a, b) => b.total - a.total),
      totals,
      invoiceCount: outstanding.length,
    };
  }),

  // Data for PDF generation (server-side)
  getPdfData: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          contact: true,
          lines: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      const org = await ctx.db.organisation.findUnique({
        where: { id: ctx.organisationId },
        select: { name: true, currency: true },
      });

      return {
        invoice: {
          number: invoice.number,
          date: formatDate(invoice.date),
          dueDate: formatDate(invoice.dueDate),
          status: effectiveStatus(invoice),
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          totalAmount: Number(invoice.totalAmount),
          amountPaid: Number(invoice.amountPaid),
          notes: invoice.notes,
          lines: invoice.lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            amount: Number(l.amount),
            taxAmount: Number(l.taxAmount),
            taxRateCode: l.taxRateCode,
          })),
        },
        contact: {
          name: invoice.contact.name,
          email: invoice.contact.email,
          address: invoice.contact.address,
          taxNumber: invoice.contact.taxNumber,
        },
        organisation: {
          name: org?.name ?? "Organisation",
          currency: org?.currency ?? "USD",
        },
      };
    }),
});
