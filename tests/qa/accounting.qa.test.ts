// QA: business bookkeeping — chart of accounts, journal entries, reports,
// dashboard and tax reports. Every posting must stay a balanced double entry.
import { describe, it, expect, beforeAll } from "vitest";
import { accountId, db, iso, newUser, today, type QaUser } from "./harness";

let u: QaUser;
let cash: string, sales: string, rent: string, taxPayable: string;

beforeAll(async () => {
  u = await newUser();
  cash = await accountId(u.orgId, "1100");
  sales = await accountId(u.orgId, "4100");
  rent = await accountId(u.orgId, "5300");
  taxPayable = await accountId(u.orgId, "2200");
});

/** Sum of debits and credits across every entry — must always match. */
async function ledgerTotals(orgId: string) {
  const lines = await db.journalLine.findMany({
    where: { journalEntry: { organisationId: orgId } },
    select: { debit: true, credit: true },
  });
  const debit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
  return { debit: Math.round(debit * 10000), credit: Math.round(credit * 10000) };
}

describe("chart of accounts", () => {
  it("creates, lists, renames, archives and restores an account", async () => {
    const acct = await u.api.accounts.create({
      code: "5960",
      name: "Bank Charges",
      type: "EXPENSE",
      normalBalance: "DEBIT",
    });
    expect((await u.api.accounts.listFlat()).map((a) => a.id)).toContain(acct.id);
    expect((await u.api.accounts.list({ type: "EXPENSE" })).map((a) => a.id)).toContain(acct.id);

    const renamed = await u.api.accounts.update({ id: acct.id, name: "Bank Fees" });
    expect(renamed.name).toBe("Bank Fees");

    await u.api.accounts.archive({ id: acct.id, archive: true });
    expect((await u.api.accounts.list({})).map((a) => a.id)).not.toContain(acct.id);
    expect((await u.api.accounts.list({ includeArchived: true })).map((a) => a.id)).toContain(
      acct.id
    );
    await u.api.accounts.archive({ id: acct.id, archive: false });
    expect((await u.api.accounts.list({})).map((a) => a.id)).toContain(acct.id);
  });

  it("rejects a duplicate account code", async () => {
    await expect(
      u.api.accounts.create({ code: "1100", name: "Dup", type: "ASSET", normalBalance: "DEBIT" })
    ).rejects.toThrow(/already exists/);
  });

  it("cannot parent an account under another organisation's account", async () => {
    const other = await newUser();
    const foreignParent = await accountId(other.orgId, "5000");
    await expect(
      u.api.accounts.create({
        code: "5970",
        name: "Sneaky",
        type: "EXPENSE",
        normalBalance: "DEBIT",
        parentId: foreignParent,
      })
    ).rejects.toThrow();
    const mine = await u.api.accounts.create({
      code: "5971",
      name: "Mine",
      type: "EXPENSE",
      normalBalance: "DEBIT",
    });
    await expect(u.api.accounts.update({ id: mine.id, parentId: foreignParent })).rejects.toThrow();
  });
});

describe("journal entries", () => {
  it("records income and it appears in the list, balances and reports", async () => {
    const entry = await u.api.transactions.createIncome({
      date: today(),
      description: "Consulting job",
      amount: 1000,
      incomeAccountId: sales,
      cashAccountId: cash,
    });
    const list = await u.api.transactions.list({ search: "Consulting" });
    expect(list.entries.map((e) => e.id)).toContain(entry.id);

    const got = await u.api.transactions.getById({ id: entry.id });
    expect(got.lines).toHaveLength(2);

    const balances = await u.api.accounts.getBalances({});
    expect(balances.find((b) => b.id === sales)?.balance).toBeGreaterThanOrEqual(1000);

    const pnl = await u.api.reports.profitAndLoss({ from: iso(today()), to: iso(today()) });
    expect(Number(pnl.totalIncome)).toBeGreaterThanOrEqual(1000);
  });

  it("records an expense with tax as a balanced entry", async () => {
    const entry = await u.api.transactions.createExpense({
      date: today(),
      description: "Office rent",
      amount: 500,
      expenseAccountId: rent,
      cashAccountId: cash,
      taxAmount: 50,
      taxAccountId: taxPayable,
    });
    const debit = entry.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const credit = entry.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    expect(debit).toBe(credit);
  });

  it("refuses an unbalanced raw entry", async () => {
    await expect(
      u.api.transactions.createRaw({
        date: today(),
        description: "Broken",
        lines: [
          { accountId: cash, debit: 100 },
          { accountId: sales, credit: 90 },
        ],
      })
    ).rejects.toThrow();
  });

  it("refuses to post into another organisation's accounts", async () => {
    const other = await newUser();
    const foreignCash = await accountId(other.orgId, "1100");
    await expect(
      u.api.transactions.createRaw({
        date: today(),
        description: "Cross-tenant",
        lines: [
          { accountId: foreignCash, debit: 100 },
          { accountId: sales, credit: 100 },
        ],
      })
    ).rejects.toThrow();
    expect(await db.journalLine.count({ where: { accountId: foreignCash } })).toBe(0);
  });

  it("voids with a reversal instead of deleting, and hides it from the default list", async () => {
    const entry = await u.api.transactions.createRaw({
      date: today(),
      description: "Owner top-up",
      lines: [
        { accountId: cash, debit: 250 },
        { accountId: await accountId(u.orgId, "3100"), credit: 250 },
      ],
    });
    const reversal = await u.api.transactions.void({ id: entry.id, reason: "Duplicate" });
    expect(reversal.id).not.toBe(entry.id);
    expect(await db.journalEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();

    const visible = await u.api.transactions.list({ search: "Owner top-up" });
    expect(visible.entries.map((e) => e.id)).not.toContain(entry.id);
    const all = await u.api.transactions.list({ search: "Owner top-up", showVoided: true });
    expect(all.entries.map((e) => e.id)).toContain(entry.id);

    await expect(u.api.transactions.void({ id: entry.id })).rejects.toThrow();
  });

  it("imports CSV rows and reports per-row failures", async () => {
    const res = await u.api.transactions.importCSV({
      rows: [
        {
          date: today(),
          description: "Import A",
          amount: 20,
          type: "expense",
          accountId: rent,
          cashAccountId: cash,
        },
        {
          date: today(),
          description: "Import B",
          amount: 30,
          type: "income",
          accountId: sales,
          cashAccountId: cash,
        },
        {
          date: today(),
          description: "Import bad",
          amount: 5,
          type: "income",
          accountId: "does-not-exist",
          cashAccountId: cash,
        },
      ],
    });
    expect(res.created).toBe(2);
    expect(res.failed).toBe(1);
  });

  it("keeps the whole ledger balanced", async () => {
    const t = await ledgerTotals(u.orgId);
    expect(t.debit).toBe(t.credit);
  });
});

describe("reports & dashboard", () => {
  it("balance sheet balances and trial balance debits equal credits", async () => {
    const bs = await u.api.reports.balanceSheet({ asOf: iso(today()) });
    expect(Number(bs.totalAssets)).toBeCloseTo(
      Number(bs.totalLiabilities) + Number(bs.totalEquity),
      2
    );
    const tb = await u.api.reports.trialBalance({ from: "2000-01-01", to: iso(today()) });
    expect(tb.totalDebits).toBe(tb.totalCredits);
  });

  it("tax summary and dashboard widgets load", async () => {
    const tax = await u.api.reports.taxSummary({ from: "2000-01-01", to: iso(today()) });
    expect(tax).toHaveProperty("netTaxPayable");
    const kpis = await u.api.dashboard.getKPIs({});
    expect(Number(kpis.monthlyIncome)).toBeGreaterThan(0);
    await expect(u.api.dashboard.getIncomeExpenseTrend()).resolves.toBeDefined();
    await expect(u.api.dashboard.getExpenseBreakdown({})).resolves.toBeDefined();
    const recent = await u.api.dashboard.getRecentTransactions();
    expect(recent.length).toBeGreaterThan(0);
    await expect(u.api.dashboard.getOutstandingInvoices()).resolves.toBeDefined();
  });
});

describe("personal tax report", () => {
  it("needs a jurisdiction, then groups spending into tax sections", async () => {
    const t = await newUser({ currency: "PKR" });
    const now = new Date();
    const fy = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    await expect(t.api.taxReport.get({ fiscalYear: fy })).rejects.toThrow(/jurisdiction/);
    expect(await t.api.taxReport.availableYears()).toEqual({ years: [] });

    await t.api.org.setTaxJurisdiction({ jurisdiction: "PAK" });
    await t.api.statementTransactions.create({
      date: iso(today()),
      description: "September salary",
      merchantName: "Employer",
      amount: 200000,
      type: "CREDIT",
      category: "Salary & Employment",
    });

    const report = await t.api.taxReport.get({ fiscalYear: fy });
    const salary = report.sections.find((s) => s.id === "pak_s149")!;
    expect(salary.total).toBe(200000);
    expect((await t.api.taxReport.availableYears()).years).toContain(fy);

    const items = await t.api.taxReport.sectionTransactions({
      fiscalYear: fy,
      sectionId: "pak_s149",
    });
    expect(items.total).toBe(1);
    await expect(
      t.api.taxReport.sectionTransactions({ fiscalYear: fy, sectionId: "nope" })
    ).rejects.toThrow(/Unknown section/);
    await expect(t.api.taxReport.salesTax({ fiscalYear: fy })).resolves.toBeDefined();
  });
});

describe("dashboard month boundaries", () => {
  it("a month's KPIs and trend bar include its last day and not the next month's 1st", async () => {
    const tz = process.env.TZ;
    try {
      for (const zone of ["Asia/Karachi", "America/Los_Angeles"]) {
        process.env.TZ = zone;
        const d = await newUser();
        const [c, s] = [await accountId(d.orgId, "1100"), await accountId(d.orgId, "4100")];
        const income = (date: string, amount: number) =>
          d.api.transactions.createIncome({
            date: new Date(date),
            description: `Sale ${date}`,
            amount,
            incomeAccountId: s,
            cashAccountId: c,
          });
        await income("2026-02-28", 1);
        await income("2026-03-01", 10);
        await income("2026-03-31", 100);
        await income("2026-04-01", 1000);

        const kpis = await d.api.dashboard.getKPIs({ month: "2026-03" });
        expect(Number(kpis.monthlyIncome), zone).toBe(110);
        const trend = await d.api.dashboard.getIncomeExpenseTrend();
        const march = trend.find((t) => t.month === "2026-03");
        if (march) expect(Number(march.income), zone).toBe(110);
      }
    } finally {
      process.env.TZ = tz;
    }
  });
});
