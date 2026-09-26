// QA: Personal Finance — transactions, budgets, goals, recurring items and
// watchlists. Every recorded transaction must show up in the list, the month
// view, the summary and the budgets that track its category.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db, iso, newUser, today, type QaUser } from "./harness";

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
