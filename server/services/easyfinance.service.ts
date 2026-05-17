/**
 * EasyFinance module — pure business logic helpers.
 * All functions that touch Prisma accept `db` as a parameter so they can be
 * unit-tested with a mocked client without going through the tRPC middleware.
 */

import type { PrismaClient } from "@prisma/client";

// ─── Shared period helpers ────────────────────────────────────────────────────

export const PERIOD_DAYS: Record<string, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  YEARLY: 365,
};

/** Returns the start-of-window Date for a given period, measured back from `now`. */
export function periodFrom(period: string, now: Date): Date {
  const days = PERIOD_DAYS[period] ?? 30;
  return new Date(now.getTime() - days * 86_400_000);
}

// ─── Budget helpers ───────────────────────────────────────────────────────────

/** Clamp utilization to [0, 100] and round to nearest integer. */
export function calcBudgetUtilization(spent: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((spent / limit) * 100));
}

/**
 * Aggregate expense debit lines for a category within a period window.
 * Shared by both budgets and watchlists.
 */
export async function getSpentForCategory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: Pick<PrismaClient, "journalLine"> | any,
  organisationId: string,
  category: string,
  from: Date,
  now: Date
): Promise<number> {
  const result = await db.journalLine.aggregate({
    where: {
      account: {
        organisationId,
        type: "EXPENSE",
        name: { contains: category, mode: "insensitive" },
      },
      journalEntry: {
        organisationId,
        isVoid: false,
        date: { gte: from, lte: now },
      },
    },
    _sum: { debit: true },
  });
  return Number(result._sum.debit ?? 0);
}

// ─── Goal helpers ─────────────────────────────────────────────────────────────

/** Progress percentage capped at 100. */
export function calcGoalProgress(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

/**
 * Returns true when a contribution brings current ≥ target.
 * Uses a 0.001 epsilon to handle floating-point rounding.
 */
export function isGoalComplete(newAmount: number, targetAmount: number): boolean {
  return newAmount >= targetAmount - 0.001;
}

// ─── Recurring-item helpers ───────────────────────────────────────────────────

/**
 * Advance a due-date by exactly one period.
 * Mutates a *copy* of `current` — the original is not changed.
 */
export function nextDueDateAfter(current: Date, frequency: string): Date {
  const d = new Date(current);
  switch (frequency) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      break;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "FORTNIGHTLY":
      d.setDate(d.getDate() + 14);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
    // unknown frequency — return unchanged
  }
  return d;
}

/** Multipliers to convert any frequency to a monthly equivalent. */
export const MONTHLY_FACTOR: Record<string, number> = {
  DAILY: 30,
  WEEKLY: 4.33,
  FORTNIGHTLY: 2.17,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  YEARLY: 1 / 12,
};

/** Amount * monthly factor, rounded to 2 dp. */
export function normalisedMonthly(amount: number, frequency: string): number {
  return amount * (MONTHLY_FACTOR[frequency] ?? 1);
}

export interface RecurringSummaryInput {
  amount: number;
  frequency: string;
  type: string;
}

/** Aggregate active items into monthly income / expense / net. */
export function calcRecurringSummary(items: RecurringSummaryInput[]): {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyNet: number;
} {
  let income = 0;
  let expense = 0;
  for (const item of items) {
    const monthly = normalisedMonthly(item.amount, item.frequency);
    if (item.type === "INCOME") income += monthly;
    else expense += monthly;
  }
  return {
    monthlyIncome: Math.round(income * 100) / 100,
    monthlyExpense: Math.round(expense * 100) / 100,
    monthlyNet: Math.round((income - expense) * 100) / 100,
  };
}

/** Derive isDue and daysUntilDue relative to `now`. */
export function calcDueStatus(
  nextDueDate: Date,
  now: Date
): { isDue: boolean; daysUntilDue: number } {
  const msUntil = new Date(nextDueDate).getTime() - now.getTime();
  return {
    isDue: msUntil <= 0,
    daysUntilDue: Math.ceil(msUntil / 86_400_000),
  };
}

// ─── Watchlist helpers ────────────────────────────────────────────────────────

/** Whether `spent` exceeds `threshold`, and how far through (%). */
export function calcWatchlistStatus(
  spent: number,
  threshold: number
): { isBreached: boolean; percentUsed: number } {
  return {
    isBreached: spent > threshold,
    percentUsed: threshold > 0 ? Math.round((spent / threshold) * 100) : 0,
  };
}
