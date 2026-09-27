import { describe, it, expect } from "vitest";
import { buildInsights, groupOf, type InsightRow } from "@/server/services/pf-insights.service";

const row = (
  date: string,
  type: "DEBIT" | "CREDIT",
  amount: number,
  category: string,
  merchantName: string | null = null,
  description = merchantName ?? "desc"
): InsightRow => ({
  date: new Date(`${date}T00:00:00Z`),
  type,
  amount,
  category,
  merchantName,
  description,
});

describe("groupOf", () => {
  it("maps categories to their group, unknown ones to Other", () => {
    expect(groupOf("Groceries")).toBe("Food & Dining");
    expect(groupOf("Restaurants & Cafes")).toBe("Food & Dining");
    expect(groupOf("Something custom")).toBe("Other");
  });
});

describe("buildInsights", () => {
  const rows = [
    row("2026-03-02", "CREDIT", 5000, "Salary & Employment", "Employer"),
    row("2026-03-03", "DEBIT", 300, "Groceries", "Metro"),
    row("2026-03-10", "DEBIT", 200, "Groceries", "Metro"),
    row("2026-03-11", "DEBIT", 400, "Restaurants & Cafes", "Cafe"),
    row("2026-03-20", "DEBIT", 1100, "Rent & Mortgage", null, "  Landlord  "),
  ];
  // Pay months: a calendar January, then cycles that close on the salary day.
  const trend = [
    { from: "2026-01-01", to: "2026-01-31", label: "January 2026" },
    { from: "2026-02-01", to: "2026-02-27", label: "Feb 1 – Feb 27, 2026" },
    { from: "2026-02-28", to: null, label: "Feb 28, 2026 – now" },
  ];
  const opts = {
    period: { from: "2026-03-01", to: "2026-03-31" },
    trend,
    today: "2026-09-27",
  };

  it("totals income, expenses, net and savings rate", () => {
    const r = buildInsights(rows, rows, opts);
    expect(r).toMatchObject({
      income: 5000,
      expenses: 2000,
      net: 3000,
      savingsRate: 0.6,
      count: 5,
    });
  });

  it("breaks expenses down by category (largest first) with shares that add up to 1", () => {
    const r = buildInsights(rows, rows, opts);
    expect(r.expenseByCategory.map((s) => [s.name, s.total, s.count])).toEqual([
      ["Rent & Mortgage", 1100, 1],
      ["Groceries", 500, 2],
      ["Restaurants & Cafes", 400, 1],
    ]);
    expect(r.expenseByCategory.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
    // Income never shows up in the spending pie.
    expect(r.expenseByCategory.find((s) => s.name === "Salary & Employment")).toBeUndefined();
    expect(r.incomeByCategory).toEqual([
      { name: "Salary & Employment", total: 5000, count: 1, share: 1 },
    ]);
  });

  it("rolls categories up into groups", () => {
    const r = buildInsights(rows, rows, opts);
    expect(r.expenseByGroup.map((s) => [s.name, s.total])).toEqual([
      ["Housing", 1100],
      ["Food & Dining", 900],
    ]);
  });

  it("ranks merchants, falling back to the description", () => {
    const r = buildInsights(rows, rows, opts);
    expect(r.topMerchants.map((s) => [s.name, s.total, s.count])).toEqual([
      ["Landlord", 1100, 1],
      ["Metro", 500, 2],
      ["Cafe", 400, 1],
    ]);
    expect(r.largestExpense).toMatchObject({
      name: "Landlord",
      amount: 1100,
      category: "Rent & Mortgage",
    });
  });

  it("buckets the trend by pay month — by date, including empty ones and the open one", () => {
    const older = row("2026-01-15", "DEBIT", 75, "Groceries");
    const outside = row("2025-12-31", "DEBIT", 999, "Groceries");
    const lastDay = row("2026-02-27", "DEBIT", 10, "Groceries");
    const salaryDay = row("2026-02-28", "CREDIT", 7, "Salary & Employment");
    const r = buildInsights(rows, [...rows, older, outside, lastDay, salaryDay], opts);
    expect(r.trend).toEqual([
      { from: "2026-01-01", label: "January 2026", income: 0, expenses: 75, net: -75 },
      { from: "2026-02-01", label: "Feb 1 – Feb 27, 2026", income: 0, expenses: 10, net: -10 },
      { from: "2026-02-28", label: "Feb 28, 2026 – now", income: 5007, expenses: 2000, net: 3007 },
    ]);
  });

  it("averages daily spend over a whole closed period, and the days so far in an open one", () => {
    expect(buildInsights(rows, [], opts).dailyAverage).toBe(64.52); // 2000 / 31
    const open = { ...opts, period: { from: "2026-03-01", to: null }, today: "2026-03-10" };
    expect(buildInsights(rows, [], open).dailyAverage).toBe(200); // 2000 / 10
    expect(buildInsights(rows, [], { ...opts, period: undefined }).dailyAverage).toBeNull();
  });

  it("handles no data, and spending without income", () => {
    const none = buildInsights([], [], opts);
    expect(none).toMatchObject({
      income: 0,
      expenses: 0,
      net: 0,
      savingsRate: null,
      largestExpense: null,
    });
    expect(none.expenseByCategory).toEqual([]);
    const spendOnly = buildInsights(rows.slice(1), [], opts);
    expect(spendOnly.savingsRate).toBeNull();
    expect(spendOnly.net).toBe(-2000);
  });

  it("keeps money exact to the cent", () => {
    const r = buildInsights(
      [row("2026-03-01", "DEBIT", 0.1, "Other"), row("2026-03-01", "DEBIT", 0.2, "Other")],
      [],
      opts
    );
    expect(r.expenses).toBe(0.3);
    expect(r.expenseByCategory[0].total).toBe(0.3);
  });
});
