/**
 * EasyFinance service — unit tests
 *
 * Tests every exported pure function and every Prisma-dependent helper in
 * server/services/easyfinance.service.ts using a mocked Prisma client
 * (same pattern as report.service.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  PERIOD_DAYS,
  periodFrom,
  calcBudgetUtilization,
  getSpentForCategory,
  calcGoalProgress,
  isGoalComplete,
  nextDueDateAfter,
  MONTHLY_FACTOR,
  normalisedMonthly,
  calcRecurringSummary,
  calcDueStatus,
  calcWatchlistStatus,
} from "@/server/services/easyfinance.service";

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makeDb(aggregateDebit: number | null = 0) {
  return {
    journalLine: {
      aggregate: vi.fn().mockResolvedValue({
        // Use Prisma.Decimal so Number(…) coercion works via valueOf()
        _sum: { debit: aggregateDebit !== null ? new Prisma.Decimal(aggregateDebit) : null },
      }),
    },
  } as unknown as Parameters<typeof getSpentForCategory>[0];
}

const ORG = "org-test";

// ═══════════════════════════════════════════════════════════════════════════════
// PERIOD_DAYS constant
// ═══════════════════════════════════════════════════════════════════════════════

describe("PERIOD_DAYS", () => {
  it("has correct day counts for all periods", () => {
    expect(PERIOD_DAYS.WEEKLY).toBe(7);
    expect(PERIOD_DAYS.MONTHLY).toBe(30);
    expect(PERIOD_DAYS.QUARTERLY).toBe(91);
    expect(PERIOD_DAYS.YEARLY).toBe(365);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// periodFrom
// ═══════════════════════════════════════════════════════════════════════════════

describe("periodFrom", () => {
  const now = new Date("2026-05-17T12:00:00.000Z");

  it("returns 7 days back for WEEKLY", () => {
    const from = periodFrom("WEEKLY", now);
    const diffDays = (now.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(7);
  });

  it("returns 30 days back for MONTHLY", () => {
    const from = periodFrom("MONTHLY", now);
    const diffDays = (now.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(30);
  });

  it("returns 91 days back for QUARTERLY", () => {
    const from = periodFrom("QUARTERLY", now);
    const diffDays = (now.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(91);
  });

  it("returns 365 days back for YEARLY", () => {
    const from = periodFrom("YEARLY", now);
    const diffDays = (now.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(365);
  });

  it("falls back to 30 days for unknown period", () => {
    const from = periodFrom("DECENNIAL", now);
    const diffDays = (now.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(30);
  });

  it("does not mutate the original `now` date", () => {
    const original = now.getTime();
    periodFrom("YEARLY", now);
    expect(now.getTime()).toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcBudgetUtilization
// ═══════════════════════════════════════════════════════════════════════════════

describe("calcBudgetUtilization", () => {
  it("returns 0 when nothing is spent", () => {
    expect(calcBudgetUtilization(0, 1000)).toBe(0);
  });

  it("returns 50 at half the limit", () => {
    expect(calcBudgetUtilization(500, 1000)).toBe(50);
  });

  it("returns 100 when exactly at limit", () => {
    expect(calcBudgetUtilization(1000, 1000)).toBe(100);
  });

  it("caps at 100 when over limit", () => {
    expect(calcBudgetUtilization(1500, 1000)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(calcBudgetUtilization(333, 1000)).toBe(33);
    expect(calcBudgetUtilization(667, 1000)).toBe(67);
  });

  it("returns 0 when limit is 0 (avoids divide-by-zero)", () => {
    expect(calcBudgetUtilization(500, 0)).toBe(0);
  });

  it("returns 0 when limit is negative", () => {
    expect(calcBudgetUtilization(100, -500)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSpentForCategory
// ═══════════════════════════════════════════════════════════════════════════════

describe("getSpentForCategory", () => {
  const from = new Date("2026-04-17T00:00:00.000Z");
  const now = new Date("2026-05-17T00:00:00.000Z");

  it("returns 0 when no matching journal lines", async () => {
    const db = makeDb(0);
    const result = await getSpentForCategory(db, ORG, "Software", from, now);
    expect(result).toBe(0);
  });

  it("returns the aggregated debit sum", async () => {
    const db = makeDb(1_250.75);
    const result = await getSpentForCategory(db, ORG, "Marketing", from, now);
    expect(result).toBe(1_250.75);
  });

  it("returns 0 when _sum.debit is null (no rows)", async () => {
    const db = makeDb(null);
    const result = await getSpentForCategory(db, ORG, "Rent", from, now);
    expect(result).toBe(0);
  });

  it("passes correct where clause to journalLine.aggregate", async () => {
    const db = makeDb(0);
    await getSpentForCategory(db, ORG, "Utilities", from, now);

    expect(db.journalLine.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: expect.objectContaining({
            organisationId: ORG,
            type: "EXPENSE",
            name: { contains: "Utilities", mode: "insensitive" },
          }),
          journalEntry: expect.objectContaining({
            organisationId: ORG,
            isVoid: false,
            date: { gte: from, lte: now },
          }),
        }),
        _sum: { debit: true },
      })
    );
  });

  it("is case-insensitive for category matching", async () => {
    const db = makeDb(500);
    await getSpentForCategory(db, ORG, "software & subscriptions", from, now);
    const call = (db.journalLine.aggregate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.account.name.mode).toBe("insensitive");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcGoalProgress
// ═══════════════════════════════════════════════════════════════════════════════

describe("calcGoalProgress", () => {
  it("returns 0 when nothing saved", () => {
    expect(calcGoalProgress(0, 1000)).toBe(0);
  });

  it("returns 50 at halfway", () => {
    expect(calcGoalProgress(500, 1000)).toBe(50);
  });

  it("returns 100 when target reached", () => {
    expect(calcGoalProgress(1000, 1000)).toBe(100);
  });

  it("caps at 100 when over-contributed", () => {
    expect(calcGoalProgress(1500, 1000)).toBe(100);
  });

  it("rounds correctly", () => {
    expect(calcGoalProgress(1, 3)).toBe(33);
    expect(calcGoalProgress(2, 3)).toBe(67);
  });

  it("returns 0 when target is 0 (avoids divide-by-zero)", () => {
    expect(calcGoalProgress(100, 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isGoalComplete
// ═══════════════════════════════════════════════════════════════════════════════

describe("isGoalComplete", () => {
  it("returns false when well below target", () => {
    expect(isGoalComplete(500, 1000)).toBe(false);
  });

  it("returns true when exactly at target", () => {
    expect(isGoalComplete(1000, 1000)).toBe(true);
  });

  it("returns true when above target", () => {
    expect(isGoalComplete(1200, 1000)).toBe(true);
  });

  it("returns true within 0.001 epsilon of target (floating-point safety)", () => {
    // 999.9995 is within 0.001 of 1000
    expect(isGoalComplete(999.9995, 1000)).toBe(true);
  });

  it("returns false when just outside epsilon", () => {
    expect(isGoalComplete(998.99, 1000)).toBe(false);
  });

  it("handles zero target", () => {
    // 0 >= 0 - 0.001 → true
    expect(isGoalComplete(0, 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// nextDueDateAfter
// ═══════════════════════════════════════════════════════════════════════════════

describe("nextDueDateAfter", () => {
  // Use local midnight so setDate/setMonth operate in the same timezone as the assertions
  const base = new Date(2026, 0, 15); // Jan 15 2026, local midnight

  it("advances by 1 day for DAILY", () => {
    const result = nextDueDateAfter(base, "DAILY");
    expect(result.getDate()).toBe(16);
    expect(result.getMonth()).toBe(0); // still January
  });

  it("advances by 7 days for WEEKLY", () => {
    const result = nextDueDateAfter(base, "WEEKLY");
    expect(result.getDate()).toBe(22);
  });

  it("advances by 14 days for FORTNIGHTLY", () => {
    const result = nextDueDateAfter(base, "FORTNIGHTLY");
    expect(result.getDate()).toBe(29);
  });

  it("advances by 1 month for MONTHLY", () => {
    const result = nextDueDateAfter(base, "MONTHLY");
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(15);
  });

  it("advances by 3 months for QUARTERLY", () => {
    const result = nextDueDateAfter(base, "QUARTERLY");
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(15);
  });

  it("advances by 1 year for YEARLY", () => {
    const result = nextDueDateAfter(base, "YEARLY");
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  it("does not mutate the original date", () => {
    const original = base.getTime();
    nextDueDateAfter(base, "YEARLY");
    expect(base.getTime()).toBe(original);
  });

  it("handles month-end for MONTHLY: Jan 31 → Feb 28/29 or Mar (JS overflow)", () => {
    const jan31 = new Date(2026, 0, 31); // Jan 31 local
    const result = nextDueDateAfter(jan31, "MONTHLY");
    // JS date overflow: Jan 31 + 1 month = Feb 31 which wraps to Mar 3 (non-leap 2026)
    // This documents the actual JS Date behavior — month must be Feb (1) or Mar (2)
    expect(result.getMonth()).toBeLessThanOrEqual(2);
  });

  it("handles Dec 31 + YEARLY → Dec 31 next year", () => {
    const dec31 = new Date(2025, 11, 31); // Dec 31 2025 local
    const result = nextDueDateAfter(dec31, "YEARLY");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(31);
  });

  it("returns date unchanged for unknown frequency", () => {
    const result = nextDueDateAfter(base, "DECENNIAL");
    expect(result.getTime()).toBe(base.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY_FACTOR constant
// ═══════════════════════════════════════════════════════════════════════════════

describe("MONTHLY_FACTOR", () => {
  it("has factor 1 for MONTHLY (baseline)", () => {
    expect(MONTHLY_FACTOR.MONTHLY).toBe(1);
  });

  it("has factor 30 for DAILY", () => {
    expect(MONTHLY_FACTOR.DAILY).toBe(30);
  });

  it("has factor ≈ 4.33 for WEEKLY (52/12)", () => {
    expect(MONTHLY_FACTOR.WEEKLY).toBeCloseTo(4.33);
  });

  it("has factor ≈ 2.17 for FORTNIGHTLY (26/12)", () => {
    expect(MONTHLY_FACTOR.FORTNIGHTLY).toBeCloseTo(2.17);
  });

  it("has factor 1/3 for QUARTERLY", () => {
    expect(MONTHLY_FACTOR.QUARTERLY).toBeCloseTo(1 / 3);
  });

  it("has factor 1/12 for YEARLY", () => {
    expect(MONTHLY_FACTOR.YEARLY).toBeCloseTo(1 / 12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// normalisedMonthly
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalisedMonthly", () => {
  it("returns amount unchanged for MONTHLY", () => {
    expect(normalisedMonthly(1000, "MONTHLY")).toBe(1000);
  });

  it("multiplies by 30 for DAILY", () => {
    expect(normalisedMonthly(100, "DAILY")).toBe(3000);
  });

  it("multiplies by 4.33 for WEEKLY", () => {
    expect(normalisedMonthly(200, "WEEKLY")).toBeCloseTo(866);
  });

  it("divides by 3 for QUARTERLY", () => {
    expect(normalisedMonthly(900, "QUARTERLY")).toBeCloseTo(300);
  });

  it("divides by 12 for YEARLY", () => {
    expect(normalisedMonthly(12000, "YEARLY")).toBeCloseTo(1000);
  });

  it("falls back to factor 1 for unknown frequency", () => {
    expect(normalisedMonthly(500, "BIENNIAL")).toBe(500);
  });

  it("handles zero amount", () => {
    expect(normalisedMonthly(0, "MONTHLY")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcRecurringSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe("calcRecurringSummary", () => {
  it("returns zeros when given empty list", () => {
    const result = calcRecurringSummary([]);
    expect(result.monthlyIncome).toBe(0);
    expect(result.monthlyExpense).toBe(0);
    expect(result.monthlyNet).toBe(0);
  });

  it("correctly sums income items only", () => {
    const result = calcRecurringSummary([
      { amount: 5000, frequency: "MONTHLY", type: "INCOME" },
      { amount: 1000, frequency: "MONTHLY", type: "INCOME" },
    ]);
    expect(result.monthlyIncome).toBe(6000);
    expect(result.monthlyExpense).toBe(0);
    expect(result.monthlyNet).toBe(6000);
  });

  it("correctly sums expense items only", () => {
    const result = calcRecurringSummary([
      { amount: 1200, frequency: "YEARLY", type: "EXPENSE" }, // 100/mo
      { amount: 500, frequency: "MONTHLY", type: "EXPENSE" },
    ]);
    expect(result.monthlyExpense).toBeCloseTo(600);
    expect(result.monthlyIncome).toBe(0);
  });

  it("calculates net as income minus expense", () => {
    const result = calcRecurringSummary([
      { amount: 5000, frequency: "MONTHLY", type: "INCOME" },
      { amount: 1500, frequency: "MONTHLY", type: "EXPENSE" },
    ]);
    expect(result.monthlyNet).toBeCloseTo(3500);
  });

  it("net is negative when expenses exceed income", () => {
    const result = calcRecurringSummary([
      { amount: 500, frequency: "MONTHLY", type: "INCOME" },
      { amount: 2000, frequency: "MONTHLY", type: "EXPENSE" },
    ]);
    expect(result.monthlyNet).toBeCloseTo(-1500);
  });

  it("normalises WEEKLY income correctly (~4.33×)", () => {
    const result = calcRecurringSummary([
      { amount: 1000, frequency: "WEEKLY", type: "INCOME" }, // 4330/mo
    ]);
    expect(result.monthlyIncome).toBeCloseTo(4330);
  });

  it("normalises DAILY expense correctly (30×)", () => {
    const result = calcRecurringSummary([
      { amount: 10, frequency: "DAILY", type: "EXPENSE" }, // 300/mo
    ]);
    expect(result.monthlyExpense).toBe(300);
  });

  it("rounds to 2 decimal places", () => {
    const result = calcRecurringSummary([
      { amount: 1, frequency: "QUARTERLY", type: "INCOME" }, // 1/3 = 0.333…
    ]);
    // 0.33 rounded to 2dp
    expect(result.monthlyIncome.toString()).toMatch(/^\d+\.\d{1,2}$/);
  });

  it("handles mixed INCOME and EXPENSE with different frequencies", () => {
    const result = calcRecurringSummary([
      { amount: 60000, frequency: "YEARLY", type: "INCOME" },   // 5000/mo
      { amount: 2000, frequency: "MONTHLY", type: "EXPENSE" },
      { amount: 100, frequency: "WEEKLY", type: "EXPENSE" },    // 433/mo
    ]);
    expect(result.monthlyIncome).toBeCloseTo(5000);
    expect(result.monthlyExpense).toBeCloseTo(2433);
    expect(result.monthlyNet).toBeCloseTo(2567);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcDueStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe("calcDueStatus", () => {
  const now = new Date("2026-05-17T12:00:00.000Z");

  it("isDue = true when nextDueDate is in the past", () => {
    const past = new Date("2026-05-16T12:00:00.000Z");
    const { isDue } = calcDueStatus(past, now);
    expect(isDue).toBe(true);
  });

  it("isDue = true when nextDueDate equals now", () => {
    const { isDue } = calcDueStatus(now, now);
    expect(isDue).toBe(true);
  });

  it("isDue = false when nextDueDate is in the future", () => {
    const future = new Date("2026-05-18T12:00:00.000Z");
    const { isDue } = calcDueStatus(future, now);
    expect(isDue).toBe(false);
  });

  it("daysUntilDue is negative for overdue items", () => {
    const threeDaysAgo = new Date("2026-05-14T12:00:00.000Z");
    const { daysUntilDue } = calcDueStatus(threeDaysAgo, now);
    expect(daysUntilDue).toBeLessThanOrEqual(-3);
  });

  it("daysUntilDue is 0 or 1 for today", () => {
    const almostNow = new Date(now.getTime() + 1000); // 1 sec ahead
    const { daysUntilDue } = calcDueStatus(almostNow, now);
    expect(daysUntilDue).toBe(1); // ceil of nearly-0
  });

  it("daysUntilDue is 7 for exactly one week away", () => {
    const nextWeek = new Date(now.getTime() + 7 * 86_400_000);
    const { daysUntilDue } = calcDueStatus(nextWeek, now);
    expect(daysUntilDue).toBe(7);
  });

  it("daysUntilDue is 30 for exactly one month away", () => {
    const nextMonth = new Date(now.getTime() + 30 * 86_400_000);
    const { daysUntilDue } = calcDueStatus(nextMonth, now);
    expect(daysUntilDue).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calcWatchlistStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe("calcWatchlistStatus", () => {
  it("isBreached = false when spent is 0", () => {
    const result = calcWatchlistStatus(0, 1000);
    expect(result.isBreached).toBe(false);
    expect(result.percentUsed).toBe(0);
  });

  it("isBreached = false when spent is exactly at threshold", () => {
    // Threshold is strict: spent > threshold required to breach
    const result = calcWatchlistStatus(1000, 1000);
    expect(result.isBreached).toBe(false);
    expect(result.percentUsed).toBe(100);
  });

  it("isBreached = true when spent exceeds threshold by 1 cent", () => {
    const result = calcWatchlistStatus(1000.01, 1000);
    expect(result.isBreached).toBe(true);
  });

  it("percentUsed is 50 at half threshold", () => {
    const result = calcWatchlistStatus(500, 1000);
    expect(result.percentUsed).toBe(50);
  });

  it("percentUsed can exceed 100 when breached", () => {
    const result = calcWatchlistStatus(1500, 1000);
    expect(result.isBreached).toBe(true);
    expect(result.percentUsed).toBe(150);
  });

  it("returns 0 percentUsed when threshold is 0 (avoids divide-by-zero)", () => {
    const result = calcWatchlistStatus(500, 0);
    expect(result.percentUsed).toBe(0);
  });

  it("rounds percentUsed to nearest integer", () => {
    const result = calcWatchlistStatus(333, 1000);
    expect(result.percentUsed).toBe(33);
  });

  it("isBreached = false when spend is 0 and threshold is 0", () => {
    const result = calcWatchlistStatus(0, 0);
    expect(result.isBreached).toBe(false); // 0 > 0 is false
  });
});
