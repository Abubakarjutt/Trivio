import { type PrismaClient, type InvoiceStatus, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createJournalEntry, voidJournalEntry } from "./accounting.service";

export interface BillLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRateCode?: string;
  taxAmount?: number;
  sortOrder?: number;
}

export interface CreateBillInput {
  organisationId: string;
  contactId: string;
  supplierRef?: string;
  date: Date;
  dueDate: Date;
  lines: BillLineInput[];
  notes?: string;
}

export async function getNextBillNumber(db: PrismaClient, organisationId: string): Promise<string> {
  const last = await db.bill.findFirst({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });

  if (!last?.number) return "BILL-0001";
  const match = last.number.match(/(\d+)$/);
  const next = match ? parseInt(match[1]!) + 1 : 1;
  return `BILL-${String(next).padStart(4, "0")}`;
}

export function calcBillTotals(lines: BillLineInput[]) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const line of lines) {
    subtotal += line.quantity * line.unitPrice;
    taxAmount += line.taxAmount ?? 0;
  }
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

export async function createBill(db: PrismaClient, input: CreateBillInput) {
  const number = await getNextBillNumber(db, input.organisationId);
  const { subtotal, taxAmount, totalAmount } = calcBillTotals(input.lines);

  return db.bill.create({
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

// Post bill to ledger: debit expense + tax input, credit AP (2100)
export async function postBillToLedger(
  db: PrismaClient,
  billId: string,
  organisationId: string,
  userId: string
) {
  const bill = await db.bill.findFirst({
    where: { id: billId, organisationId },
    include: { lines: true },
  });
  if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
  if (bill.journalEntryId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already posted" });

  const [apAccount, expenseAccount, taxInputAccount] = await Promise.all([
    db.chartAccount.findFirst({ where: { organisationId, code: "2100" } }),
    db.chartAccount.findFirst({ where: { organisationId, code: "5100" } }),
    db.chartAccount.findFirst({ where: { organisationId, code: "2201" } }),
  ]);

  if (!apAccount || !expenseAccount) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Required accounts not found (AP: 2100, Expense: 5100)" });
  }

  const subtotal = Number(bill.subtotal);
  const taxAmount = Number(bill.taxAmount);
  const totalAmount = Number(bill.totalAmount);

  const lines = [
    { accountId: expenseAccount.id, debit: subtotal, description: `Expense: ${bill.number}` },
    { accountId: apAccount.id, credit: totalAmount, description: `AP: ${bill.number}` },
  ];
  if (taxAmount > 0 && taxInputAccount) {
    lines.splice(1, 0, { accountId: taxInputAccount.id, debit: taxAmount, description: `Tax input: ${bill.number}` });
  }

  const entry = await createJournalEntry(db, {
    organisationId,
    userId,
    date: bill.date,
    description: `Bill ${bill.number}`,
    reference: bill.number ?? bill.id,
    source: "MANUAL",
    sourceId: bill.id,
    lines,
  });

  await db.bill.update({ where: { id: billId }, data: { journalEntryId: entry.id } });
  return entry;
}

// Record payment: debit AP, credit cash/bank
export async function recordBillPayment(
  db: PrismaClient,
  params: {
    billId: string;
    organisationId: string;
    userId: string;
    amount: number;
    cashAccountId: string;
    date: Date;
    reference?: string;
  }
) {
  const bill = await db.bill.findFirst({
    where: { id: params.billId, organisationId: params.organisationId },
  });
  if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
  if (bill.status === "VOID") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot pay a voided bill" });

  const apAccount = await db.chartAccount.findFirst({
    where: { organisationId: params.organisationId, code: "2100" },
  });
  if (!apAccount) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AP account (2100) not found" });

  const entry = await createJournalEntry(db, {
    organisationId: params.organisationId,
    userId: params.userId,
    date: params.date,
    description: `Payment: ${bill.number}`,
    reference: params.reference ?? bill.number ?? bill.id,
    source: "MANUAL",
    sourceId: bill.id,
    lines: [
      { accountId: apAccount.id, debit: params.amount, description: `AP cleared: ${bill.number}` },
      { accountId: params.cashAccountId, credit: params.amount, description: `Payment made: ${bill.number}` },
    ],
  });

  const newAmountPaid = Number(bill.amountPaid) + params.amount;
  const total = Number(bill.totalAmount);
  const newStatus: InvoiceStatus =
    newAmountPaid >= total - 0.001 ? "PAID"
    : newAmountPaid > 0 ? "PARTIAL"
    : bill.status;

  await db.bill.update({
    where: { id: params.billId },
    data: { amountPaid: new Prisma.Decimal(newAmountPaid), status: newStatus },
  });

  return entry;
}

export async function voidBill(
  db: PrismaClient,
  billId: string,
  organisationId: string,
  userId: string,
  reason: string
) {
  const bill = await db.bill.findFirst({ where: { id: billId, organisationId } });
  if (!bill) throw new TRPCError({ code: "NOT_FOUND" });
  if (bill.status === "VOID") throw new TRPCError({ code: "BAD_REQUEST", message: "Already voided" });

  if (bill.journalEntryId) {
    await voidJournalEntry(db, bill.journalEntryId, organisationId, userId, reason);
  }
  await db.bill.update({ where: { id: billId }, data: { status: "VOID" } });
}

export function effectiveBillStatus(bill: {
  status: InvoiceStatus;
  dueDate: Date;
  amountPaid: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}): InvoiceStatus {
  if (bill.status === "PAID" || bill.status === "VOID" || bill.status === "DRAFT") return bill.status;
  const isPaid = Number(bill.amountPaid) >= Number(bill.totalAmount) - 0.001;
  if (isPaid) return "PAID";
  if (new Date() > new Date(bill.dueDate)) return "OVERDUE";
  return bill.status;
}
