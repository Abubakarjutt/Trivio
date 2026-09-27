import { CATEGORY_BY_NAME } from "@/lib/categories";
import { dayOf, daysBetween } from "@/server/services/pf-cycle.service";

/**
 * Personal-finance insights: where the money goes (expenses by category and
 * category group), where it comes from, the month-by-month trend and the top
 * merchants. Pure — the router loads the statement rows, this shapes them.
 * Periods are the user's pay months (see pf-cycle.service.ts), not calendar months.
 *
 * DEBIT = money out (expense), CREDIT = money in (income). Excluded rows must
 * already be filtered out by the caller, as on the Transactions page summary.
 */

export interface InsightRow {
  date: Date;
  type: "DEBIT" | "CREDIT";
  amount: number;
  category: string;
  merchantName: string | null;
  description: string;
}

export interface Slice {
  name: string;
  total: number;
  count: number;
  /** Share of the side's total, 0–1. */
  share: number;
}

export interface TrendPeriod {
  from: string; // "YYYY-MM-DD", inclusive
  to: string | null; // inclusive; null = still open
  label: string;
}

export interface TrendPoint {
  from: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

export interface PfInsights {
  income: number;
  expenses: number;
  net: number;
  /** Share of income kept (net / income), null when there's no income. */
  savingsRate: number | null;
  count: number;
  expenseByCategory: Slice[];
  expenseByGroup: Slice[];
  incomeByCategory: Slice[];
  topMerchants: Slice[];
  largestExpense: { name: string; amount: number; date: Date; category: string } | null;
  /** Average spend per day over the period's days so far (not for all time). */
  dailyAverage: number | null;
  trend: TrendPoint[];
}

type Totals = Map<string, { total: number; count: number }>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function add(map: Totals, key: string, amount: number) {
  const cur = map.get(key) ?? { total: 0, count: 0 };
  cur.total += amount;
  cur.count += 1;
  map.set(key, cur);
}

function slices(map: Totals, sideTotal: number): Slice[] {
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      total: round2(v.total),
      count: v.count,
      share: sideTotal > 0 ? v.total / sideTotal : 0,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Category group for a category name ("Groceries" → "Food & Dining"). */
export function groupOf(category: string): string {
  return CATEGORY_BY_NAME[category]?.group ?? "Other";
}

export function buildInsights(
  periodRows: InsightRow[],
  trendRows: InsightRow[],
  opts: { period?: { from: string; to: string | null }; trend: TrendPeriod[]; today: string }
): PfInsights {
  let income = 0;
  let expenses = 0;
  const byCategory: Totals = new Map();
  const byGroup: Totals = new Map();
  const incomeByCategory: Totals = new Map();
  const byMerchant: Totals = new Map();
  let largest: PfInsights["largestExpense"] = null;

  for (const r of periodRows) {
    if (r.type === "CREDIT") {
      income += r.amount;
      add(incomeByCategory, r.category, r.amount);
      continue;
    }
    expenses += r.amount;
    add(byCategory, r.category, r.amount);
    add(byGroup, groupOf(r.category), r.amount);
    const merchant = (r.merchantName || r.description).trim();
    add(byMerchant, merchant, r.amount);
    if (!largest || r.amount > largest.amount)
      largest = { name: merchant, amount: round2(r.amount), date: r.date, category: r.category };
  }

  const trend = opts.trend.map((p) => ({ ...p, income: 0, expenses: 0 }));
  for (const r of trendRows) {
    const day = dayOf(r.date);
    const p = trend.find((t) => day >= t.from && (t.to === null || day <= t.to));
    if (!p) continue;
    if (r.type === "CREDIT") p.income += r.amount;
    else p.expenses += r.amount;
  }

  // Days counted: the whole of a past period, the days so far for the open one.
  let dailyAverage: number | null = null;
  if (opts.period) {
    const { from, to } = opts.period;
    const end = to === null || to > opts.today ? opts.today : to;
    dailyAverage = round2(expenses / Math.max(daysBetween(from, end), 1));
  }

  return {
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    savingsRate: income > 0 ? (income - expenses) / income : null,
    count: periodRows.length,
    expenseByCategory: slices(byCategory, expenses),
    expenseByGroup: slices(byGroup, expenses),
    incomeByCategory: slices(incomeByCategory, income),
    topMerchants: slices(byMerchant, expenses).slice(0, 5),
    largestExpense: largest,
    dailyAverage,
    trend: trend.map((p) => ({
      from: p.from,
      label: p.label,
      income: round2(p.income),
      expenses: round2(p.expenses),
      net: round2(p.income - p.expenses),
    })),
  };
}
