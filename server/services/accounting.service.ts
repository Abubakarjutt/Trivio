import { type PrismaClient, type JournalEntrySource, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateJournalEntryInput {
  organisationId: string;
  userId: string;
  date: Date;
  description: string;
  reference?: string;
  source?: JournalEntrySource;
  sourceId?: string;
  lines: JournalLineInput[];
}

// Validates that debits == credits to 4 decimal places
function assertBalanced(lines: JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Journal entry must have at least two lines",
    });
  }
  const totalDebits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  const diff = Math.abs(totalDebits - totalCredits);
  if (diff > 0.0001) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Journal entry is unbalanced: debits ${totalDebits.toFixed(4)} ≠ credits ${totalCredits.toFixed(4)}`,
    });
  }
}

export async function createJournalEntry(db: PrismaClient, input: CreateJournalEntryInput) {
  assertBalanced(input.lines);

  return db.journalEntry.create({
    data: {
      organisationId: input.organisationId,
      date: input.date,
      description: input.description,
      reference: input.reference,
      source: input.source ?? "MANUAL",
      sourceId: input.sourceId,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit != null ? new Prisma.Decimal(l.debit) : null,
          credit: l.credit != null ? new Prisma.Decimal(l.credit) : null,
          description: l.description,
        })),
      },
    },
    include: { lines: true },
  });
}

// Creates a reversal (void) entry that exactly negates the original.
// Atomic: the mark-void and reversal creation happen inside a single DB transaction
// to prevent double-void race conditions.
export async function voidJournalEntry(
  db: PrismaClient,
  journalEntryId: string,
  organisationId: string,
  userId: string,
  reason: string
) {
  return db.$transaction(async (tx) => {
    // Atomic conditional update — if already voided, count === 0
    const updated = await tx.journalEntry.updateMany({
      where: { id: journalEntryId, organisationId, isVoid: false },
      data: { isVoid: true, voidedAt: new Date(), voidReason: reason },
    });

    if (updated.count === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry not found or already voided" });
    }

    const original = await tx.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: { lines: true },
    });

    if (!original) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry not found" });
    }

    // Create reversal entry (swap debits ↔ credits)
    const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit ? Number(l.credit) : undefined,
      credit: l.debit ? Number(l.debit) : undefined,
      description: `Reversal: ${l.description ?? original.description}`,
    }));

    return createJournalEntry(tx as unknown as PrismaClient, {
      organisationId,
      userId,
      date: new Date(),
      description: `VOID: ${original.description}`,
      reference: original.reference ?? undefined,
      source: original.source,
      sourceId: original.sourceId ?? undefined,
      lines: reversalLines,
    });
  });
}

// Returns the balance of an account (debit balance for debit-normal accounts, credit balance for credit-normal)
export async function getAccountBalance(
  db: PrismaClient,
  accountId: string,
  organisationId: string,
  asOf?: Date
): Promise<number> {
  const where = asOf
    ? { accountId, journalEntry: { organisationId, isVoid: false, date: { lte: asOf } } }
    : { accountId, journalEntry: { organisationId, isVoid: false } };

  const result = await db.journalLine.aggregate({
    where,
    _sum: { debit: true, credit: true },
  });

  const totalDebits = Number(result._sum.debit ?? 0);
  const totalCredits = Number(result._sum.credit ?? 0);

  const account = await db.chartAccount.findUnique({ where: { id: accountId } });
  if (!account) return 0;

  return account.normalBalance === "DEBIT"
    ? totalDebits - totalCredits
    : totalCredits - totalDebits;
}

// Builds the income/expense journal entry for a simplified transaction
export function buildIncomeEntry(params: {
  date: Date;
  description: string;
  amount: number;
  incomeAccountId: string;
  cashAccountId: string;
  taxAmount?: number;
  taxAccountId?: string;
}) {
  const { date, description, amount, incomeAccountId, cashAccountId, taxAmount, taxAccountId } = params;
  if (taxAmount && !taxAccountId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "taxAccountId is required when taxAmount is provided",
    });
  }
  const lines: JournalLineInput[] = [
    // Debit cash/AR (money coming in)
    { accountId: cashAccountId, debit: amount + (taxAmount ?? 0) },
    // Credit income account
    { accountId: incomeAccountId, credit: amount },
  ];
  if (taxAmount && taxAccountId) {
    lines.push({ accountId: taxAccountId, credit: taxAmount });
  }
  return { date, description, lines };
}

export function buildExpenseEntry(params: {
  date: Date;
  description: string;
  amount: number;
  expenseAccountId: string;
  cashAccountId: string;
  taxAmount?: number;
  taxAccountId?: string;
}) {
  const { date, description, amount, expenseAccountId, cashAccountId, taxAmount, taxAccountId } = params;
  if (taxAmount && !taxAccountId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "taxAccountId is required when taxAmount is provided",
    });
  }
  const lines: JournalLineInput[] = [
    // Debit expense account
    { accountId: expenseAccountId, debit: amount },
    // Credit cash/AP (money going out)
    { accountId: cashAccountId, credit: amount + (taxAmount ?? 0) },
  ];
  if (taxAmount && taxAccountId) {
    lines.push({ accountId: taxAccountId, debit: taxAmount });
  }
  return { date, description, lines };
}
