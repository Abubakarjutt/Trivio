import { type PrismaClient, type InvoiceStatus, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createJournalEntry, voidJournalEntry } from "./accounting.service";

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRateCode?: string;
  taxAmount?: number;
  sortOrder?: number;
}

export interface CreateInvoiceInput {
  organisationId: string;
  contactId: string;
  date: Date;
  dueDate: Date;
  lines: InvoiceLineInput[];
  notes?: string;
  taxRegimeId?: string;
}

// Auto-generates next invoice number: INV-0001, INV-0002, …
export async function getNextInvoiceNumber(db: PrismaClient, organisationId: string): Promise<string> {
  const last = await db.invoice.findFirst({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });

  if (!last) return "INV-0001";

  const match = last.number.match(/(\d+)$/);
  const next = match ? parseInt(match[1]!) + 1 : 1;
  return `INV-${String(next).padStart(4, "0")}`;
}

export function calcInvoiceTotals(lines: InvoiceLineInput[]) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const line of lines) {
    const amount = line.quantity * line.unitPrice;
    subtotal += amount;
    taxAmount += line.taxAmount ?? 0;
  }
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

export async function createInvoice(db: PrismaClient, input: CreateInvoiceInput) {
  const number = await getNextInvoiceNumber(db, input.organisationId);
  const { subtotal, taxAmount, totalAmount } = calcInvoiceTotals(input.lines);

  return db.invoice.create({
    data: {
      organisationId: input.organisationId,
      contactId: input.contactId,
      number,
      date: input.date,
      dueDate: input.dueDate,
      status: "DRAFT",
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(taxAmount),
      totalAmount: new Prisma.Decimal(totalAmount),
      notes: input.notes,
      lines: {
        create: input.lines.map((l, i) => ({
          description: l.description,
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(l.unitPrice),
          amount: new Prisma.Decimal(l.quantity * l.unitPrice),
          taxRateCode: l.taxRateCode,
          taxAmount: new Prisma.Decimal(l.taxAmount ?? 0),
          sortOrder: l.sortOrder ?? i,
        })),
      },
    },
    include: { lines: true, contact: true },
  });
}

// Post invoice to ledger: debit AR, credit income + tax liability
export async function postInvoiceToLedger(
  db: PrismaClient,
  invoiceId: string,
  organisationId: string,
  userId: string
) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organisationId },
    include: { lines: true },
  });
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
  if (invoice.journalEntryId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already posted" });

  // Find AR, income, and tax accounts
  const [arAccount, incomeAccount, taxAccount] = await Promise.all([
    db.chartAccount.findFirst({ where: { organisationId, code: "1200" } }),
    db.chartAccount.findFirst({ where: { organisationId, code: "4100" } }),
    db.chartAccount.findFirst({ where: { organisationId, code: "2200" } }),
  ]);

  if (!arAccount || !incomeAccount) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Required accounts not found in chart of accounts" });
  }

  const subtotal = Number(invoice.subtotal);
  const taxAmount = Number(invoice.taxAmount);
  const totalAmount = Number(invoice.totalAmount);

  const lines = [
    { accountId: arAccount.id, debit: totalAmount, description: `AR: ${invoice.number}` },
    { accountId: incomeAccount.id, credit: subtotal, description: `Income: ${invoice.number}` },
  ];
  if (taxAmount > 0 && taxAccount) {
    lines.push({ accountId: taxAccount.id, credit: taxAmount, description: `Tax: ${invoice.number}` });
  }

  const entry = await createJournalEntry(db, {
    organisationId,
    userId,
    date: invoice.date,
    description: `Invoice ${invoice.number}`,
    reference: invoice.number,
    source: "INVOICE",
    sourceId: invoice.id,
    lines,
  });

  await db.invoice.update({
    where: { id: invoiceId },
    data: { journalEntryId: entry.id },
  });

  return entry;
}

// Record a payment against an invoice: debit cash/bank, credit AR
export async function recordInvoicePayment(
  db: PrismaClient,
  params: {
    invoiceId: string;
    organisationId: string;
    userId: string;
    amount: number;
    cashAccountId: string;
    date: Date;
    reference?: string;
  }
) {
  const invoice = await db.invoice.findFirst({
    where: { id: params.invoiceId, organisationId: params.organisationId },
  });
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
  if (invoice.status === "VOID") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot pay a voided invoice" });

  const arAccount = await db.chartAccount.findFirst({
    where: { organisationId: params.organisationId, code: "1200" },
  });
  if (!arAccount) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AR account not found" });

  const entry = await createJournalEntry(db, {
    organisationId: params.organisationId,
    userId: params.userId,
    date: params.date,
    description: `Payment: ${invoice.number}`,
    reference: params.reference ?? invoice.number,
    source: "INVOICE",
    sourceId: invoice.id,
    lines: [
      { accountId: params.cashAccountId, debit: params.amount, description: `Payment received: ${invoice.number}` },
      { accountId: arAccount.id, credit: params.amount, description: `AR cleared: ${invoice.number}` },
    ],
  });

  const newAmountPaid = Number(invoice.amountPaid) + params.amount;
  const totalAmount = Number(invoice.totalAmount);
  const newStatus: InvoiceStatus =
    newAmountPaid >= totalAmount - 0.001 ? "PAID"
    : newAmountPaid > 0 ? "PARTIAL"
    : invoice.status;

  await db.invoice.update({
    where: { id: params.invoiceId },
    data: {
      amountPaid: new Prisma.Decimal(newAmountPaid),
      status: newStatus,
    },
  });

  return entry;
}

// Void invoice: reverse journal entries and mark as void
export async function voidInvoice(
  db: PrismaClient,
  invoiceId: string,
  organisationId: string,
  userId: string,
  reason: string
) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organisationId },
  });
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
  if (invoice.status === "VOID") throw new TRPCError({ code: "BAD_REQUEST", message: "Already voided" });

  if (invoice.journalEntryId) {
    await voidJournalEntry(db, invoice.journalEntryId, organisationId, userId, reason);
  }

  await db.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID" },
  });
}

// Compute effective status (adds OVERDUE if past due and unpaid)
export function effectiveStatus(invoice: {
  status: InvoiceStatus;
  dueDate: Date;
  amountPaid: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}): InvoiceStatus {
  if (invoice.status === "PAID" || invoice.status === "VOID" || invoice.status === "DRAFT") {
    return invoice.status;
  }
  const isOverdue = new Date() > new Date(invoice.dueDate);
  const isPaid = Number(invoice.amountPaid) >= Number(invoice.totalAmount) - 0.001;
  if (isPaid) return "PAID";
  if (isOverdue) return "OVERDUE";
  return invoice.status;
}
