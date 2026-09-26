// QA: bank reconciliation — import a statement, auto-match, match by hand,
// create entries for unknown lines, exclude/restore, and the summary.
import { describe, it, expect, beforeAll } from "vitest";
import { accountId, db, newUser, type QaUser } from "./harness";

let u: QaUser;
let other: QaUser;
let cash: string, sales: string, rent: string, fees: string;
let bankId: string;

/** Non-void balance on an account (debit − credit). */
async function balance(acct: string) {
  const lines = await db.journalLine.findMany({
    where: { accountId: acct, journalEntry: { isVoid: false } },
    select: { debit: true, credit: true },
  });
  return (
    Math.round(lines.reduce((s, l) => s + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0) * 100) /
    100
  );
}

const d = (iso: string) => new Date(iso);

beforeAll(async () => {
  u = await newUser();
  other = await newUser();
  [cash, sales, rent] = await Promise.all(
    ["1100", "4100", "5300"].map((c) => accountId(u.orgId, c))
  );
  fees = (
    await u.api.accounts.create({
      code: "5991",
      name: "Bank Fees QA",
      type: "EXPENSE",
      normalBalance: "DEBIT",
    })
  ).id;
  bankId = (await u.api.bankAccounts.create({ name: "Main current account", chartAccountId: cash }))
    .id;
});

describe("bank accounts", () => {
  it("only links to this organisation's own asset accounts", async () => {
    await expect(u.api.bankAccounts.create({ name: "Bad", chartAccountId: sales })).rejects.toThrow(
      /ASSET/
    );
    const foreign = await accountId(other.orgId, "1100");
    await expect(
      u.api.bankAccounts.create({ name: "Theirs", chartAccountId: foreign })
    ).rejects.toThrow();
    const list = await u.api.bankAccounts.list();
    expect(list.map((b) => b.id)).toContain(bankId);
    expect((await u.api.bankAccounts.getById({ id: bankId })).chartAccount.id).toBe(cash);
    await expect(other.api.bankAccounts.getById({ id: bankId })).rejects.toThrow();
  });

  it("rejects malformed statement amounts instead of crashing", async () => {
    await expect(
      u.api.bankAccounts.importStatementLines({
        bankAccountId: bankId,
        lines: [{ date: d("2026-05-01"), description: "Bad", amount: "12,50" }],
      })
    ).rejects.toThrow(/Amount must be a number/);
    await expect(
      other.api.bankAccounts.importStatementLines({
        bankAccountId: bankId,
        lines: [{ date: d("2026-05-01"), description: "x", amount: "1" }],
      })
    ).rejects.toThrow();
  });
});

describe("reconciling a statement", () => {
  it("auto-matches exact amounts within 5 days, leaves the rest unmatched", async () => {
    await u.api.transactions.createIncome({
      date: d("2026-05-02"),
      description: "Client payment",
      amount: 500,
      incomeAccountId: sales,
      cashAccountId: cash,
    });
    await u.api.transactions.createExpense({
      date: d("2026-05-04"),
      description: "May rent",
      amount: 1200,
      expenseAccountId: rent,
      cashAccountId: cash,
    });
    const res = await u.api.bankAccounts.importStatementLines({
      bankAccountId: bankId,
      lines: [
        { date: d("2026-05-03"), description: "CLIENT PMT", amount: "500.00" },
        { date: d("2026-05-05"), description: "RENT", amount: "-1200" },
        { date: d("2026-05-06"), description: "MONTHLY FEE", amount: "-15" },
        { date: d("2026-05-20"), description: "LATE 500", amount: "500" },
      ],
    });
    expect(res.count).toBe(4);

    const { matched } = await u.api.bankAccounts.autoMatch({ bankAccountId: bankId });
    expect(matched).toBe(2);
    const unmatched = await u.api.bankAccounts.getStatementLines({
      bankAccountId: bankId,
      status: "UNMATCHED",
    });
    expect(unmatched.lines.map((l) => l.description).sort()).toEqual(["LATE 500", "MONTHLY FEE"]);
    // A second run doesn't re-match anything.
    expect((await u.api.bankAccounts.autoMatch({ bankAccountId: bankId })).matched).toBe(0);
  });

  it("creates a balanced entry for an unknown line (bank fee) and posts it once", async () => {
    const fee = (
      await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId, status: "UNMATCHED" })
    ).lines.find((l) => l.description === "MONTHLY FEE")!;
    const before = { cash: await balance(cash), fees: await balance(fees) };
    const entry = await u.api.bankAccounts.createJournalForLine({
      bankStatementLineId: fee.id,
      accountId: fees,
      description: "Bank fee",
    });
    expect(entry.lines).toHaveLength(2);
    expect(await balance(cash)).toBe(before.cash - 15);
    expect(await balance(fees)).toBe(before.fees + 15);
    await expect(
      u.api.bankAccounts.createJournalForLine({
        bankStatementLineId: fee.id,
        accountId: fees,
        description: "again",
      })
    ).rejects.toThrow(/not UNMATCHED/);
  });

  it("restoring or excluding a created line voids its entry, so re-creating can't double-post", async () => {
    const fee = (
      await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId, status: "CREATED" })
    ).lines[0]!;
    const cashBefore = await balance(cash);

    await u.api.bankAccounts.restoreLine({ bankStatementLineId: fee.id });
    expect(await balance(cash)).toBe(cashBefore + 15); // fee reversed
    await u.api.bankAccounts.createJournalForLine({
      bankStatementLineId: fee.id,
      accountId: fees,
      description: "Bank fee",
    });
    expect(await balance(cash)).toBe(cashBefore); // posted exactly once

    await u.api.bankAccounts.excludeLine({ bankStatementLineId: fee.id });
    expect(await balance(cash)).toBe(cashBefore + 15);
    const excluded = await u.api.bankAccounts.getStatementLines({
      bankAccountId: bankId,
      status: "EXCLUDED",
    });
    expect(excluded.lines.map((l) => l.id)).toContain(fee.id);
    await u.api.bankAccounts.restoreLine({ bankStatementLineId: fee.id });
    expect((await db.bankStatementLine.findUniqueOrThrow({ where: { id: fee.id } })).status).toBe(
      "UNMATCHED"
    );
  });

  it("manual matching only accepts an unmatched line of this bank's own account", async () => {
    const late = (
      await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId, status: "UNMATCHED" })
    ).lines.find((l) => l.description === "LATE 500")!;
    const later = await u.api.transactions.createIncome({
      date: d("2026-05-19"),
      description: "Another client",
      amount: 500,
      incomeAccountId: sales,
      cashAccountId: cash,
    });
    const cashLine = later.lines.find((l) => l.accountId === cash)!;
    const salesLine = later.lines.find((l) => l.accountId === sales)!;

    await expect(
      u.api.bankAccounts.matchLine({ bankStatementLineId: late.id, journalLineId: salesLine.id })
    ).rejects.toThrow(/this bank account/);

    const candidates = await u.api.bankAccounts.getUnmatchedJournalLines({ bankAccountId: bankId });
    expect(candidates.lines.map((l) => l.id)).toContain(cashLine.id);

    await u.api.bankAccounts.matchLine({
      bankStatementLineId: late.id,
      journalLineId: cashLine.id,
    });
    expect(
      (await u.api.bankAccounts.getUnmatchedJournalLines({ bankAccountId: bankId })).lines.map(
        (l) => l.id
      )
    ).not.toContain(cashLine.id);

    // The same journal line can't reconcile a second statement line.
    await u.api.bankAccounts.importStatementLines({
      bankAccountId: bankId,
      lines: [{ date: d("2026-05-19"), description: "DUP 500", amount: "500" }],
    });
    const dup = (
      await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId, status: "UNMATCHED" })
    ).lines.find((l) => l.description === "DUP 500")!;
    await expect(
      u.api.bankAccounts.matchLine({ bankStatementLineId: dup.id, journalLineId: cashLine.id })
    ).rejects.toThrow(/already matched/);
    await expect(
      u.api.bankAccounts.matchLine({ bankStatementLineId: late.id, journalLineId: cashLine.id })
    ).rejects.toThrow(/not unmatched/);

    await u.api.bankAccounts.unmatchLine({ bankStatementLineId: late.id });
    await expect(u.api.bankAccounts.unmatchLine({ bankStatementLineId: late.id })).rejects.toThrow(
      /not matched/
    );
    await u.api.bankAccounts.matchLine({ bankStatementLineId: dup.id, journalLineId: cashLine.id });
  });

  it("summary counts every status and the book balance follows the ledger", async () => {
    const s = await u.api.bankAccounts.getReconciliationSummary({ bankAccountId: bankId });
    const total = Object.values(s.summary).reduce((n, g) => n + g.count, 0);
    expect(total).toBe(await db.bankStatementLine.count({ where: { bankAccountId: bankId } }));
    expect(s.summary.MATCHED.count).toBeGreaterThanOrEqual(3);
    expect(s.bookBalance).toBe(await balance(cash));
    await expect(
      other.api.bankAccounts.getReconciliationSummary({ bankAccountId: bankId })
    ).rejects.toThrow();
  });

  it("another organisation can't touch these statement lines", async () => {
    const line = (await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId })).lines[0]!;
    await expect(
      other.api.bankAccounts.getStatementLines({ bankAccountId: bankId })
    ).rejects.toThrow();
    await expect(
      other.api.bankAccounts.excludeLine({ bankStatementLineId: line.id })
    ).rejects.toThrow();
    await expect(
      other.api.bankAccounts.restoreLine({ bankStatementLineId: line.id })
    ).rejects.toThrow();
    await expect(other.api.bankAccounts.autoMatch({ bankAccountId: bankId })).rejects.toThrow();
    await expect(
      other.api.bankAccounts.getUnmatchedJournalLines({ bankAccountId: bankId })
    ).rejects.toThrow();
    const theirCash = await accountId(other.orgId, "1100");
    const unmatched = (
      await u.api.bankAccounts.getStatementLines({ bankAccountId: bankId, status: "UNMATCHED" })
    ).lines;
    expect(unmatched.length).toBeGreaterThan(0);
    await expect(
      u.api.bankAccounts.createJournalForLine({
        bankStatementLineId: unmatched[0]!.id,
        accountId: theirCash,
        description: "cross-tenant",
      })
    ).rejects.toThrow();
    expect(await db.journalLine.count({ where: { accountId: theirCash } })).toBe(0);
  });
});
