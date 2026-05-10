import { type PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Auto-match algorithm for bank reconciliation.
 *
 * For each UNMATCHED BankStatementLine:
 *   1. Find JournalLines for the same org/chartAccount not yet matched.
 *   2. Amount exact match: credit line for positive statement amount, debit line for negative.
 *   3. Date within 5 calendar days.
 *   4. If exactly one candidate → auto-match.
 *
 * Returns the total number of lines matched.
 */
export async function autoMatchBankAccount(
  prisma: PrismaClient,
  bankAccountId: string,
  organisationId: string
): Promise<number> {
  // Load bank account to get the chartAccount ID
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organisationId },
    select: { id: true, accountId: true },
  });

  if (!bankAccount) return 0;

  // Load all UNMATCHED statement lines
  const unmatchedLines = await prisma.bankStatementLine.findMany({
    where: { bankAccountId, status: "UNMATCHED" },
    orderBy: { date: "asc" },
  });

  if (unmatchedLines.length === 0) return 0;

  let matchedCount = 0;

  for (const statementLine of unmatchedLines) {
    const amount = new Prisma.Decimal(statementLine.amount);
    const isPositive = amount.greaterThan(0);
    const absAmount = amount.abs();

    // Date window: ±5 calendar days
    const lineDate = new Date(statementLine.date);
    const dateFrom = new Date(lineDate);
    dateFrom.setDate(dateFrom.getDate() - 5);
    const dateTo = new Date(lineDate);
    dateTo.setDate(dateTo.getDate() + 5);

    // Find journal lines for this chart account that are not yet matched
    // and have the right amount in the right direction
    const candidates = await prisma.journalLine.findMany({
      where: {
        accountId: bankAccount.accountId,
        journalEntry: {
          organisationId,
          isVoid: false,
          date: { gte: dateFrom, lte: dateTo },
        },
        bankStatementLines: { none: {} }, // not yet matched to any statement line
        ...(isPositive
          ? { credit: absAmount }
          : { debit: absAmount }),
      },
      select: { id: true },
    });

    if (candidates.length === 1) {
      // Exactly one candidate — auto-match
      await prisma.bankStatementLine.update({
        where: { id: statementLine.id },
        data: {
          status: "MATCHED",
          journalLineId: candidates[0].id,
        },
      });
      matchedCount++;
    }
  }

  return matchedCount;
}
