/**
 * accounting-sample-data unit tests
 *
 * Tests loadAccountingSampleData and clearAccountingSampleData with fully
 * mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock("@/server/services/chart-of-accounts.service", () => ({
  seedDefaultChartOfAccounts: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { loadAccountingSampleData, clearAccountingSampleData } from "@/lib/accounting-sample-data";
import { seedDefaultChartOfAccounts } from "@/server/services/chart-of-accounts.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG = "org-demo";

const ACCOUNTS = [
  { id: "ar-id",   code: "1200" },
  { id: "cash-id", code: "1100" },
  { id: "ap-id",   code: "2100" },
  { id: "rev-id",  code: "4200" },
  { id: "sal-id",  code: "4100" },
  { id: "salary-id", code: "5200" },
  { id: "rent-id",   code: "5300" },
  { id: "util-id",   code: "5400" },
  { id: "mkt-id",    code: "5500" },
  { id: "sw-id",     code: "5700" },
];

function makeTxDb() {
  const contactCreate  = vi.fn().mockResolvedValue({ id: "c-1" });
  const invoiceCreate  = vi.fn().mockResolvedValue({ id: "inv-1" });
  const billCreate     = vi.fn().mockResolvedValue({ id: "bill-1" });
  const journalCreate  = vi.fn().mockResolvedValue({ id: "je-1" });
  const bankCreate     = vi.fn().mockResolvedValue({ id: "ba-1" });
  const bankLineCreate = vi.fn().mockResolvedValue(undefined);

  const tx = {
    contact:         { create: contactCreate },
    invoice:         { create: invoiceCreate },
    bill:            { create: billCreate },
    journalEntry:    { create: journalCreate },
    bankAccount:     { create: bankCreate },
    bankStatementLine: { createMany: bankLineCreate },
  };
  return { tx, contactCreate, invoiceCreate, billCreate, journalCreate, bankCreate, bankLineCreate };
}

function makeDb(overrides: Record<string, unknown> = {}) {
  const { tx, ...mocks } = makeTxDb();

  const db = {
    chartAccount: {
      findMany: vi.fn().mockResolvedValue(ACCOUNTS),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
    ...overrides,
  } as any;

  return { db, tx: mocks };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── loadAccountingSampleData ─────────────────────────────────────────────────

describe("loadAccountingSampleData", () => {
  it("calls seedDefaultChartOfAccounts before creating any data", async () => {
    const { db } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(seedDefaultChartOfAccounts).toHaveBeenCalledWith(db, ORG);
  });

  it("looks up chart accounts by organisationId", async () => {
    const { db } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(db.chartAccount.findMany).toHaveBeenCalledWith({ where: { organisationId: ORG } });
  });

  it("throws if a required account code is missing", async () => {
    const { db } = makeDb();
    // Remove one account so by() lookup fails
    db.chartAccount.findMany.mockResolvedValue(ACCOUNTS.filter((a) => a.code !== "1100"));
    await expect(loadAccountingSampleData(db, ORG)).rejects.toThrow("Account 1100 not found");
  });

  it("runs everything inside a single $transaction", async () => {
    const { db } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("creates 6 contacts tagged isSampleData=true", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(tx.contactCreate).toHaveBeenCalledTimes(6);
    for (const call of tx.contactCreate.mock.calls) {
      expect(call[0].data.organisationId).toBe(ORG);
      expect(call[0].data.isSampleData).toBe(true);
    }
  });

  it("creates 5 invoices tagged isSampleData=true with DEMO- prefix", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(tx.invoiceCreate).toHaveBeenCalledTimes(5);
    for (const call of tx.invoiceCreate.mock.calls) {
      expect(call[0].data.isSampleData).toBe(true);
      expect(call[0].data.number).toMatch(/^DEMO-INV-/);
    }
  });

  it("creates 2 bills tagged isSampleData=true", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(tx.billCreate).toHaveBeenCalledTimes(2);
    for (const call of tx.billCreate.mock.calls) {
      expect(call[0].data.isSampleData).toBe(true);
    }
  });

  it("creates a bank account tagged isSampleData=true", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(tx.bankCreate).toHaveBeenCalledOnce();
    expect(tx.bankCreate.mock.calls[0][0].data.isSampleData).toBe(true);
    expect(tx.bankCreate.mock.calls[0][0].data.organisationId).toBe(ORG);
  });

  it("creates 6 bank statement lines", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    expect(tx.bankLineCreate).toHaveBeenCalledOnce();
    expect(tx.bankLineCreate.mock.calls[0][0].data).toHaveLength(6);
  });

  it("creates journal entries for invoices, bills, and expenses, all tagged isSampleData=true", async () => {
    const { db, tx } = makeDb();
    await loadAccountingSampleData(db, ORG);
    // At least one journal entry per paid invoice (2 JEs) + paid bill (2 JEs) + 10 expenses
    expect(tx.journalCreate.mock.calls.length).toBeGreaterThanOrEqual(10);
    for (const call of tx.journalCreate.mock.calls) {
      expect(call[0].data.isSampleData).toBe(true);
      expect(call[0].data.organisationId).toBe(ORG);
    }
  });

  it("returns a positive record count", async () => {
    const { db } = makeDb();
    const count = await loadAccountingSampleData(db, ORG);
    expect(count).toBeGreaterThan(0);
  });
});

// ─── clearAccountingSampleData ────────────────────────────────────────────────

describe("clearAccountingSampleData", () => {
  function makeClearDb() {
    const journalDeleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const invoiceDeleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const billDeleteMany    = vi.fn().mockResolvedValue({ count: 2 });
    const bankDeleteMany    = vi.fn().mockResolvedValue({ count: 1 });
    const contactDeleteMany = vi.fn().mockResolvedValue({ count: 6 });
    const stmtDeleteMany    = vi.fn().mockResolvedValue({ count: 10 });
    const orgUpdate         = vi.fn().mockResolvedValue({});

    const db = {
      journalEntry:        { deleteMany: journalDeleteMany },
      invoice:             { deleteMany: invoiceDeleteMany },
      bill:                { deleteMany: billDeleteMany },
      bankAccount:         { deleteMany: bankDeleteMany },
      contact:             { deleteMany: contactDeleteMany },
      statementTransaction: { deleteMany: stmtDeleteMany },
      organisation:        { update: orgUpdate },
      $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    } as any;

    return { db, journalDeleteMany, invoiceDeleteMany, billDeleteMany, bankDeleteMany, contactDeleteMany, stmtDeleteMany, orgUpdate };
  }

  it("runs everything in a single $transaction call", async () => {
    const { db } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("deletes journal entries with organisationId + isSampleData=true", async () => {
    const { db, journalDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(journalDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("deletes invoices with organisationId + isSampleData=true", async () => {
    const { db, invoiceDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(invoiceDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("deletes bills with organisationId + isSampleData=true", async () => {
    const { db, billDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(billDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("deletes bank accounts with organisationId + isSampleData=true", async () => {
    const { db, bankDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(bankDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("deletes contacts with organisationId + isSampleData=true", async () => {
    const { db, contactDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(contactDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("deletes statement transactions with organisationId + isSampleData=true", async () => {
    const { db, stmtDeleteMany } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(stmtDeleteMany).toHaveBeenCalledWith({
      where: { organisationId: ORG, isSampleData: true },
    });
  });

  it("sets hasSampleData=false on the organisation", async () => {
    const { db, orgUpdate } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    expect(orgUpdate).toHaveBeenCalledWith({
      where: { id: ORG },
      data: { hasSampleData: false },
    });
  });

  it("passes 7 operations to $transaction (one per table + org update)", async () => {
    const { db } = makeClearDb();
    await clearAccountingSampleData(db, ORG);
    const ops = db.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(7);
  });
});
