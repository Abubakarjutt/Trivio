// QA: Personal Finance — transactions, budgets, goals, recurring items and
// watchlists. Every recorded transaction must show up in the list, the month
// view, the summary and the budgets that track its category.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db, iso, newUser, today, type QaUser } from "./harness";
import { addDays, localToday } from "@/server/services/pf-cycle.service";

let u: QaUser;
let other: QaUser;
const thisMonth = iso(today()).slice(0, 7);

const spend = (
  merchantName: string,
  amount: number,
  category = "Food & Dining",
  date = iso(today())
) =>
  u.api.statementTransactions.create({
    date,
    description: merchantName,
    merchantName,
    amount,
    type: "DEBIT",
    category,
  });

beforeAll(async () => {
  u = await newUser({ currency: "PKR" });
  other = await newUser();
});

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("personal finance transactions", () => {
  it("every recorded transaction appears in the list, the month view and the summary", async () => {
    const a = await spend("Cafe One", 450);
    const b = await spend("Cafe Two", 550);
    const salary = await u.api.statementTransactions.create({
      date: iso(today()),
      description: "Salary",
      merchantName: "Employer",
      amount: 100000,
      type: "CREDIT",
      category: "Salary & Employment",
    });

    const all = (await u.api.statementTransactions.list({})).items.map((t) => t.id);
    expect(all).toEqual(expect.arrayContaining([a.id, b.id, salary.id]));
    const month = (await u.api.statementTransactions.list({ month: thisMonth })).items.map(
      (t) => t.id
    );
    expect(month).toEqual(expect.arrayContaining([a.id, b.id, salary.id]));

    const summary = await u.api.statementTransactions.summary({ month: thisMonth });
    expect(summary.totalCount).toBeGreaterThanOrEqual(3);
    expect(summary.totalDebits).toBeGreaterThanOrEqual(1000);
    expect(summary.totalCredits).toBeGreaterThanOrEqual(100000);

    expect(
      (await u.api.statementTransactions.list({ search: "cafe two" })).items.map((t) => t.id)
    ).toEqual([b.id]);
    expect(
      (await u.api.statementTransactions.list({ type: "CREDIT" })).items.every(
        (t) => t.type === "CREDIT"
      )
    ).toBe(true);
    // Manual entries share one "Manual entries" batch that counts them.
    const manual = (await u.api.statementTransactions.listBatches()).find(
      (x) => x.fileType === "MANUAL"
    );
    expect(manual?.transactionCount).toBeGreaterThanOrEqual(3);
  });

  it("month views keep the 1st and the last day in their own month east of UTC (e.g. Pakistan)", async () => {
    process.env.TZ = "Asia/Karachi";
    const first = await spend("First of month", 10, "Shopping", "2026-03-01");
    const last = await spend("Last of month", 20, "Shopping", "2026-03-31");
    const feb28 = await spend("End of Feb", 30, "Shopping", "2026-02-28");
    const march = (await u.api.statementTransactions.list({ month: "2026-03" })).items.map(
      (x) => x.id
    );
    expect(march).toEqual(expect.arrayContaining([first.id, last.id]));
    expect(march).not.toContain(feb28.id);
    const april = (await u.api.statementTransactions.list({ month: "2026-04" })).items.map(
      (x) => x.id
    );
    expect(april).not.toContain(last.id);
    expect((await u.api.statementTransactions.summary({ month: "2026-03" })).totalDebits).toBe(30);
  });

  it("filters by date range, category and paginates without losing rows", async () => {
    const extra = await Promise.all(
      Array.from({ length: 5 }, (_, i) => spend(`Page item ${i}`, 1, "Paging", "2026-01-15"))
    );
    const first = await u.api.statementTransactions.list({ category: "Paging", limit: 2 });
    expect(first.items).toHaveLength(2);
    const seen = [...first.items.map((t) => t.id)];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await u.api.statementTransactions.list({ category: "Paging", limit: 2, cursor });
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor;
    }
    expect(new Set(seen)).toEqual(new Set(extra.map((t) => t.id)));

    const range = await u.api.statementTransactions.list({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(range.items.map((t) => t.id)).toEqual(expect.arrayContaining(extra.map((t) => t.id)));
  });

  it("recategorises, excludes/restores and deletes a transaction", async () => {
    const t = await spend("Mystery shop", 99, "Other");
    const re = await u.api.statementTransactions.updateCategory({ id: t.id, category: "Shopping" });
    expect(re.category).toBe("Shopping");

    await u.api.statementTransactions.toggleExclude({ id: t.id });
    expect((await u.api.statementTransactions.list({})).items.map((x) => x.id)).not.toContain(t.id);
    expect(
      (await u.api.statementTransactions.list({ includeExcluded: true })).items.map((x) => x.id)
    ).toContain(t.id);
    await u.api.statementTransactions.toggleExclude({ id: t.id });
    expect((await u.api.statementTransactions.list({})).items.map((x) => x.id)).toContain(t.id);

    await u.api.statementTransactions.deleteTransaction({ id: t.id });
    expect(await db.statementTransaction.findUnique({ where: { id: t.id } })).toBeNull();
  });

  it("shows pending duplicates for an import and deletes a whole import batch", async () => {
    const batch = await db.statementImportBatch.create({
      data: {
        organisationId: u.orgId,
        filename: "sept.csv",
        fileType: "CSV",
        status: "DONE",
        transactionCount: 1,
        pendingDuplicatesJson: [{ date: "2026-09-02", description: "Dup row", amount: 12 }],
      },
    });
    await db.statementTransaction.create({
      data: {
        organisationId: u.orgId,
        importBatchId: batch.id,
        date: new Date("2026-09-02"),
        description: "Imported",
        merchantName: "Imported",
        amount: 12,
        type: "DEBIT",
        category: "Other",
        mccCode: "",
        mccLabel: "",
      },
    });
    const pending = await u.api.statementTransactions.pendingBatch({ batchId: batch.id });
    expect(pending?.items).toEqual([{ date: "2026-09-02", description: "Dup row", amount: 12 }]);
    expect(await other.api.statementTransactions.pendingBatch({ batchId: batch.id })).toBeNull();
    await expect(
      other.api.statementTransactions.deleteByBatch({ batchId: batch.id })
    ).rejects.toThrow();

    await u.api.statementTransactions.deleteByBatch({ batchId: batch.id });
    expect(await db.statementTransaction.count({ where: { importBatchId: batch.id } })).toBe(0);
    expect((await u.api.statementTransactions.listBatches()).map((b) => b.id)).not.toContain(
      batch.id
    );
  });

  it("never shows or changes another organisation's transactions", async () => {
    const mine = await spend("Private", 5);
    expect((await other.api.statementTransactions.list({})).items.map((t) => t.id)).not.toContain(
      mine.id
    );
    await expect(
      other.api.statementTransactions.updateCategory({ id: mine.id, category: "x" })
    ).rejects.toThrow();
    await expect(other.api.statementTransactions.toggleExclude({ id: mine.id })).rejects.toThrow();
    await expect(
      other.api.statementTransactions.deleteTransaction({ id: mine.id })
    ).rejects.toThrow();
    expect(await db.statementTransaction.findUnique({ where: { id: mine.id } })).not.toBeNull();
  });
});

describe("budgets", () => {
  it("counts Personal Finance spending in the budget's category", async () => {
    const b = await u.api.budgets.create({
      name: "Eating out",
      category: "Food & Dining",
      limitAmount: 2000,
    });
    await spend("Budget lunch", 300);
    const got = (await u.api.budgets.list({})).find((x) => x.id === b.id)!;
    expect(got.spent).toBeGreaterThanOrEqual(300);
    expect(got.remaining).toBe(Math.max(0, 2000 - got.spent));
    expect(got.utilization).toBe(Math.min(100, Math.round((got.spent / 2000) * 100)));
  });

  it("edits, archives and deletes a budget; other orgs can't touch it", async () => {
    const b = await u.api.budgets.create({
      name: "Fun",
      category: "Entertainment",
      limitAmount: 100,
      period: "WEEKLY",
    });
    const up = await u.api.budgets.update({ id: b.id, limitAmount: 150, period: "MONTHLY" });
    expect(Number(up.limitAmount)).toBe(150);
    await expect(other.api.budgets.update({ id: b.id, limitAmount: 1 })).rejects.toThrow();

    await u.api.budgets.archive({ id: b.id });
    expect((await u.api.budgets.list({})).map((x) => x.id)).not.toContain(b.id);
    expect((await u.api.budgets.list({ includeArchived: true })).map((x) => x.id)).toContain(b.id);
    await expect(other.api.budgets.delete({ id: b.id })).rejects.toThrow();
    await u.api.budgets.delete({ id: b.id });
    expect((await u.api.budgets.list({ includeArchived: true })).map((x) => x.id)).not.toContain(
      b.id
    );
    await expect(
      u.api.budgets.create({ name: "Bad", category: "x", limitAmount: 0 })
    ).rejects.toThrow();
  });
});

describe("watchlists", () => {
  it("flags a category once spending passes the threshold", async () => {
    const w = await u.api.watchlists.create({
      name: "Coffee watch",
      category: "Coffee",
      threshold: 50,
    });
    await spend("Espresso bar", 80, "Coffee");
    const got = (await u.api.watchlists.list()).find((x) => x.id === w.id)!;
    expect(got.spent).toBeGreaterThanOrEqual(80);
    expect(got.isBreached).toBe(true);
    expect(got.percentUsed).toBeGreaterThanOrEqual(160);

    await u.api.watchlists.update({ id: w.id, isActive: false });
    expect((await u.api.watchlists.list()).map((x) => x.id)).not.toContain(w.id);
    await expect(other.api.watchlists.delete({ id: w.id })).rejects.toThrow();
    await u.api.watchlists.delete({ id: w.id });
    expect(await db.watchlist.findUnique({ where: { id: w.id } })).toBeNull();
  });
});

describe("goals", () => {
  it("contributes until complete, then refuses more contributions", async () => {
    const g = await u.api.goals.create({ name: "Laptop", targetAmount: 1000, currentAmount: 100 });
    await u.api.goals.contribute({ id: g.id, amount: 400 });
    let got = (await u.api.goals.list({})).find((x) => x.id === g.id)!;
    expect(got.currentAmount).toBe(500);
    expect(got.progress).toBe(50);
    expect(got.remaining).toBe(500);

    const done = await u.api.goals.contribute({ id: g.id, amount: 500 });
    expect(done.status).toBe("COMPLETED");
    await expect(u.api.goals.contribute({ id: g.id, amount: 1 })).rejects.toThrow(/not active/);
    expect((await u.api.goals.list({ status: "COMPLETED" })).map((x) => x.id)).toContain(g.id);
    got = (await u.api.goals.list({ status: "ACTIVE" })).find((x) => x.id === g.id)!;
    expect(got).toBeUndefined();
  });

  it("edits, cancels and deletes a goal; other orgs can't touch it", async () => {
    const g = await u.api.goals.create({
      name: "Trip",
      targetAmount: 500,
      targetDate: new Date("2027-01-01"),
    });
    const up = await u.api.goals.update({
      id: g.id,
      targetAmount: 800,
      targetDate: null,
      status: "CANCELLED",
    });
    expect(Number(up.targetAmount)).toBe(800);
    expect(up.targetDate).toBeNull();
    expect(up.status).toBe("CANCELLED");
    await expect(other.api.goals.contribute({ id: g.id, amount: 1 })).rejects.toThrow();
    await expect(other.api.goals.delete({ id: g.id })).rejects.toThrow();
    await u.api.goals.delete({ id: g.id });
    expect((await u.api.goals.list({})).map((x) => x.id)).not.toContain(g.id);
    await expect(u.api.goals.create({ name: "Bad", targetAmount: -5 })).rejects.toThrow();
  });
});

describe("recurring items", () => {
  it("month-end bills advance to the last day of the next month, not into the month after", async () => {
    const r = await u.api.recurringItems.create({
      name: "Rent",
      amount: 30000,
      type: "EXPENSE",
      frequency: "MONTHLY",
      nextDueDate: new Date("2027-01-31"),
    });
    const paid = await u.api.recurringItems.markPaid({ id: r.id });
    expect(iso(paid.nextDueDate)).toBe("2027-02-28");
    expect(paid.lastPaidAt).not.toBeNull();

    const q = await u.api.recurringItems.create({
      name: "Insurance",
      amount: 5000,
      type: "EXPENSE",
      frequency: "QUARTERLY",
      nextDueDate: new Date("2026-11-30"),
    });
    expect(iso((await u.api.recurringItems.markPaid({ id: q.id })).nextDueDate)).toBe("2027-02-28");

    const w = await u.api.recurringItems.create({
      name: "Cleaner",
      amount: 1000,
      type: "EXPENSE",
      frequency: "WEEKLY",
      nextDueDate: new Date("2026-12-29"),
    });
    expect(iso((await u.api.recurringItems.markPaid({ id: w.id })).nextDueDate)).toBe("2027-01-05");
  });

  it("lists due items, summarises monthly totals, pauses and deletes", async () => {
    const pay = await u.api.recurringItems.create({
      name: "Salary",
      amount: 100000,
      type: "INCOME",
      frequency: "MONTHLY",
      category: "Salary & Employment",
      nextDueDate: new Date(Date.now() - 86400_000),
    });
    const listed = (await u.api.recurringItems.list({})).find((x) => x.id === pay.id)!;
    expect(listed.isDue).toBe(true);

    const s = await u.api.recurringItems.summary();
    expect(s.monthlyIncome).toBeGreaterThanOrEqual(100000);
    expect(s.monthlyNet).toBeCloseTo(s.monthlyIncome - s.monthlyExpense, 2);

    await u.api.recurringItems.update({ id: pay.id, isActive: false, amount: 90000 });
    expect((await u.api.recurringItems.list({})).map((x) => x.id)).not.toContain(pay.id);
    expect((await u.api.recurringItems.list({ activeOnly: false })).map((x) => x.id)).toContain(
      pay.id
    );
    await expect(other.api.recurringItems.markPaid({ id: pay.id })).rejects.toThrow();
    await u.api.recurringItems.delete({ id: pay.id });
    expect(await db.recurringItem.findUnique({ where: { id: pay.id } })).toBeNull();
  });
});

describe("personal finance dashboard (insights)", () => {
  it("shows where the money goes: totals, category pie, groups, merchants and trend", async () => {
    const me = await newUser();
    const add = (
      date: string,
      type: "DEBIT" | "CREDIT",
      amount: number,
      category: string,
      merchantName: string
    ) =>
      me.api.statementTransactions.create({
        date,
        description: merchantName,
        merchantName,
        amount,
        type,
        category,
      });
    await add("2025-11-01", "CREDIT", 3000, "Salary & Employment", "Employer");
    await add("2025-11-03", "DEBIT", 120.5, "Groceries", "Metro");
    await add("2025-11-30", "DEBIT", 79.5, "Groceries", "Metro");
    await add("2025-11-15", "DEBIT", 800, "Rent & Mortgage", "Landlord");
    const excluded = await add("2025-11-16", "DEBIT", 5000, "Shopping", "Ignored");
    await me.api.statementTransactions.toggleExclude({ id: excluded.id });
    await add("2025-10-10", "DEBIT", 50, "Groceries", "Metro");
    await add("2025-12-01", "DEBIT", 999, "Groceries", "Next month");

    // Months before the first pay month show as calendar months.
    const periods = await me.api.pfCycles.list();
    const novP = periods.find((p) => p.label === "November 2025")!;
    expect(novP).toMatchObject({ from: "2025-11-01", to: "2025-11-30", kind: "calendar" });
    const nov = await me.api.statementTransactions.insights({ from: novP.from, to: novP.to });
    expect(nov).toMatchObject({ income: 3000, expenses: 1000, net: 2000, count: 4 });
    expect(nov.savingsRate).toBeCloseTo(2 / 3);
    expect(nov.expenseByCategory.map((s) => [s.name, s.total, s.count])).toEqual([
      ["Rent & Mortgage", 800, 1],
      ["Groceries", 200, 2],
    ]);
    expect(nov.expenseByCategory.map((s) => s.share)).toEqual([0.8, 0.2]);
    expect(nov.expenseByGroup.map((s) => s.name)).toEqual(["Housing", "Food & Dining"]);
    expect(nov.incomeByCategory.map((s) => s.name)).toEqual(["Salary & Employment"]);
    expect(nov.topMerchants[0]).toMatchObject({ name: "Landlord", total: 800 });
    expect(nov.dailyAverage).toBe(33.33); // 1000 / 30 days
    // The trend starts at the earliest data (October), not before.
    expect(nov.trend.map((p) => p.label)).toEqual(["October 2025", "November 2025"]);
    expect(nov.trend.at(-2)).toMatchObject({ from: "2025-10-01", expenses: 50 });
    expect(nov.trend.at(-1)).toMatchObject({ income: 3000, expenses: 1000 });

    const all = await me.api.statementTransactions.insights({});
    expect(all).toMatchObject({ expenses: 2049, count: 6, dailyAverage: null });
    expect(all.trend).toHaveLength(12);

    // Another organisation sees none of it.
    const theirs = await other.api.statementTransactions.insights({
      from: "2025-11-01",
      to: "2025-11-30",
    });
    expect(theirs).toMatchObject({ income: 0, expenses: 0, count: 0 });
    await expect(me.api.statementTransactions.insights({ from: "November" })).rejects.toThrow();
  });
});

describe("pay months (close the month yourself)", () => {
  // The server counts days on this machine's calendar.
  const day = (offset: number) => addDays(localToday(), offset);

  it("the month stays open past the 1st until closed; transactions land in a month by their date", async () => {
    const me = await newUser();
    // The first time, the current month opens on the 1st of this calendar month.
    const first = await me.api.pfCycles.list();
    expect(first).toEqual([
      expect.objectContaining({ from: `${localToday().slice(0, 7)}-01`, to: null, kind: "open" }),
    ]);
    expect(await me.api.pfCycles.list()).toHaveLength(1); // not re-created

    // Salary came 40 days ago: move the start there. Nothing closes on the 1st.
    await me.api.pfCycles.setStart({ startDate: day(-40) });
    const spend = (date: string, amount: number) =>
      me.api.statementTransactions.create({
        date,
        description: "Shop",
        merchantName: "Shop",
        amount,
        type: "DEBIT",
        category: "Groceries",
      });
    await spend(day(-40), 5);
    await spend(day(-10), 20);
    await spend(day(-9), 300);
    let periods = await me.api.pfCycles.list();
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ from: day(-40), to: null, kind: "open" });
    expect(
      (await me.api.statementTransactions.insights({ from: day(-40), to: null })).expenses
    ).toBe(325);

    // Close it on the day before the salary arrived; the next month starts the day after.
    const closed = await me.api.pfCycles.close({ endDate: day(-10) });
    expect(closed).toEqual({ closed: { from: day(-40), to: day(-10) }, nextStarts: day(-9) });
    periods = await me.api.pfCycles.list();
    expect(periods.map((p) => [p.from, p.to, p.kind])).toEqual([
      [day(-40), day(-10), "closed"],
      [day(-9), null, "open"],
    ]);
    const [old, cur] = periods;
    expect((await me.api.statementTransactions.insights(old)).expenses).toBe(25);
    expect((await me.api.statementTransactions.insights(cur)).expenses).toBe(300);
    // The Transactions page list and summary use the same bounds.
    const oldRange = { dateFrom: old.from, dateTo: old.to! };
    expect((await me.api.statementTransactions.summary(oldRange)).totalDebits).toBe(25);
    expect((await me.api.statementTransactions.list(oldRange)).items).toHaveLength(2);
    expect((await me.api.statementTransactions.summary({ dateFrom: cur.from })).totalDebits).toBe(
      300
    );
    // The trend compares pay months.
    const trend = (await me.api.statementTransactions.insights(cur)).trend;
    expect(trend.map((p) => [p.from, p.expenses])).toEqual([
      [day(-40), 25],
      [day(-9), 300],
    ]);

    // Moving the current month's start moves the previous month's end with it.
    await me.api.pfCycles.setStart({ startDate: day(-12) });
    periods = await me.api.pfCycles.list();
    expect(periods.map((p) => [p.from, p.to])).toEqual([
      [day(-40), day(-13)],
      [day(-12), null],
    ]);
    await expect(me.api.pfCycles.setStart({ startDate: day(-40) })).rejects.toThrow(
      /previous month started/
    );

    // Undo: the previous month continues, taking in the current one.
    expect(await me.api.pfCycles.reopen()).toEqual({ reopened: day(-40) });
    expect((await me.api.pfCycles.list()).map((p) => [p.from, p.to])).toEqual([[day(-40), null]]);
    await expect(me.api.pfCycles.reopen()).rejects.toThrow(/no closed month/);
  });

  it("closing on pay day starts the new month today, so later spending that day lands in it", async () => {
    const me = await newUser();
    await me.api.pfCycles.setStart({ startDate: day(-30) });
    // No date: the new month starts today and the closed one ends yesterday.
    expect(await me.api.pfCycles.close({})).toEqual({
      closed: { from: day(-30), to: day(-1) },
      nextStarts: day(0),
    });
    await me.api.statementTransactions.create({
      date: day(0),
      description: "Groceries",
      merchantName: "Grocery Store",
      amount: 140,
      type: "DEBIT",
      category: "Groceries",
    });
    const cur = (await me.api.pfCycles.list()).at(-1)!;
    expect(cur).toMatchObject({ from: day(0), to: null, kind: "open" });
    expect((await me.api.statementTransactions.list({ dateFrom: cur.from })).items).toHaveLength(1);

    // A month that started today can't be closed again today.
    await expect(me.api.pfCycles.close({})).rejects.toThrow(/new month has to start after/);
    await me.api.pfCycles.reopen();
    // An explicit start date works the same way, but never in the future.
    await expect(me.api.pfCycles.close({ startsOn: day(1) })).rejects.toThrow(/future/);
    expect(await me.api.pfCycles.close({ startsOn: day(-3) })).toEqual({
      closed: { from: day(-30), to: day(-4) },
      nextStarts: day(-3),
    });
  });

  it("monthly budgets follow the pay month; weekly ones stay rolling", async () => {
    const me = await newUser();
    await me.api.pfCycles.setStart({ startDate: day(-20) });
    const spend = (date: string, amount: number) =>
      me.api.statementTransactions.create({
        date,
        description: "Food",
        merchantName: "Food",
        amount,
        type: "DEBIT",
        category: "Groceries",
      });
    await spend(day(-25), 100); // before this pay month
    await spend(day(-5), 40);
    const monthly = await me.api.budgets.create({
      name: "Food",
      category: "Groceries",
      limitAmount: 100,
      period: "MONTHLY",
    });
    const weekly = await me.api.budgets.create({
      name: "Food week",
      category: "Groceries",
      limitAmount: 100,
      period: "WEEKLY",
    });
    const budget = async (id: string) => (await me.api.budgets.list({})).find((b) => b.id === id)!;

    // Counts from the pay month's start — not the last 30 days (which would include the 100).
    expect(await budget(monthly.id)).toMatchObject({
      spent: 40,
      remaining: 60,
      utilization: 40,
      periodStart: day(-20),
    });

    // Closing the month resets it; the next month counts from the day after.
    await me.api.pfCycles.close({ endDate: day(-3) });
    await spend(day(-1), 7);
    expect(await budget(monthly.id)).toMatchObject({ spent: 7, periodStart: day(-2) });
    // A weekly budget is still the last 7 days, whatever the pay month.
    expect((await budget(weekly.id)).spent).toBe(47);

    // Reopening brings the whole month back.
    await me.api.pfCycles.reopen();
    expect(await budget(monthly.id)).toMatchObject({ spent: 47, periodStart: day(-20) });
  });

  it("rejects closing before the month started or in the future, and is per organisation", async () => {
    const me = await newUser();
    await me.api.pfCycles.setStart({ startDate: day(-5) });
    await expect(me.api.pfCycles.close({ endDate: day(-6) })).rejects.toThrow(/can't end before/);
    await expect(me.api.pfCycles.close({ endDate: day(1) })).rejects.toThrow(/future/);
    await expect(me.api.pfCycles.setStart({ startDate: day(1) })).rejects.toThrow(/future/);
    await expect(me.api.pfCycles.close({ endDate: "tomorrow" })).rejects.toThrow();

    // Closing with no date (pay day) starts the next month today.
    expect((await me.api.pfCycles.close({})).nextStarts).toBe(day(0));
    expect((await me.api.pfCycles.list()).at(-1)).toMatchObject({ from: day(0), kind: "open" });

    // Someone else's months are untouched.
    const theirs = await other.api.pfCycles.list();
    expect(theirs.every((p) => p.from !== day(-5))).toBe(true);
    expect(await db.pfCycle.count({ where: { organisationId: me.orgId } })).toBe(2);
  });
});
