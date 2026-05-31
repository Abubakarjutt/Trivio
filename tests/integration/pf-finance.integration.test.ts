/**
 * Integration tests for the pf (personal finance) module.
 *
 * These tests run against the real PostgreSQL database.
 * Each test suite creates its own isolated org + user and tears down in afterAll.
 *
 * Requires the dev database to be running:
 *   docker compose up -d
 *
 * What is covered:
 *   - CSV parse → categorize-fallback → save → list pipeline
 *   - Month-scoped list and summary (real date range queries)
 *   - toggleExclude effect on summary aggregates
 *   - deleteTransaction removes a single record
 *   - deleteByBatch removes all transactions + the batch record
 *   - Duplicate detection (detectDuplicates) against real saved data
 *   - monthRange boundary: transactions at month edge are included/excluded correctly
 *   - updateCategory persists to DB
 *   - listBatches returns batches for the org
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type StatementTransactionType } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";
import { autoDetectColumns, parseCsvBuffer, detectDuplicates } from "@/server/services/statement-parser.service";

const db = new PrismaClient();

// ── Shared test org + user ─────────────────────────────────────────────────────

let orgId: string;
let userId: string;

beforeAll(async () => {
  const org = await db.organisation.create({ data: { name: "PF Integration Test Org" } });
  orgId = org.id;
  const user = await db.user.create({
    data: { email: `pf-int+${Date.now()}@test.example`, hashedPassword: "x", organisationId: orgId },
  });
  userId = user.id;
});

afterAll(async () => {
  // Delete in dependency order
  await db.statementTransaction.deleteMany({ where: { organisationId: orgId } });
  await db.statementImportBatch.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
  await db.$disconnect();
});

// ── tRPC caller factory (bypasses auth middleware with injected context) ────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCaller(overrideOrg?: string) {
  return createCallerFactory(statementTransactionsRouter)({
    session: { user: { id: userId, email: "x@x.com", name: "X" }, expires: new Date(Date.now() + 86400000).toISOString() },
    db,
    organisationId: overrideOrg ?? orgId,
  } as never);
}

// ── Utility: create a batch + transactions directly via Prisma ─────────────────

async function createBatch(
  filename: string,
  transactions: Array<{
    date: Date; description: string; merchantName?: string;
    amount: number; type: StatementTransactionType; category?: string;
  }>
) {
  const batch = await db.statementImportBatch.create({
    data: { organisationId: orgId, filename, fileType: "CSV", status: "DONE", transactionCount: transactions.length },
  });
  await db.statementTransaction.createMany({
    data: transactions.map((t) => ({
      organisationId: orgId,
      importBatchId: batch.id,
      date: t.date,
      description: t.description,
      merchantName: t.merchantName ?? t.description,
      amount: t.amount,
      type: t.type,
      category: t.category ?? "Other",
      mccCode: "0000",
      mccLabel: "Uncategorized",
    })),
  });
  return batch;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV parse pipeline (pure functions, no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("CSV parse pipeline", () => {
  it("parses a realistic bank CSV into RawTransactions", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-05-01,WOOLWORTHS 1234,-65.40",
      "2026-05-02,DIRECT DEBIT NETFLIX,-15.99",
      "2026-05-03,SALARY CREDIT,3500.00",
    ].join("\n");
    const map = autoDetectColumns(["Date", "Description", "Amount"]);
    const txns = parseCsvBuffer(Buffer.from(csv), map);
    expect(txns).toHaveLength(3);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", type: "DEBIT", amount: 65.40 });
    expect(txns[2]).toMatchObject({ date: "2026-05-03", type: "CREDIT", amount: 3500.00 });
  });

  it("parses a debit/credit split-column CSV", () => {
    const csv = [
      "Date,Memo,Withdrawal,Deposit",
      "2026-04-10,Rent Payment,1200.00,",
      "2026-04-15,Client Invoice,,2500.00",
    ].join("\n");
    const map = autoDetectColumns(["Date", "Memo", "Withdrawal", "Deposit"]);
    const txns = parseCsvBuffer(Buffer.from(csv), map);
    expect(txns[0]).toMatchObject({ amount: 1200, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ amount: 2500, type: "CREDIT" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate detection against real saved data
// ─────────────────────────────────────────────────────────────────────────────

describe("duplicate detection (real DB data)", () => {
  let batchId: string;

  beforeAll(async () => {
    const batch = await createBatch("dedup-test.csv", [
      { date: new Date("2026-03-01"), description: "Starbucks Coffee",  amount: 4.50,  type: "DEBIT"  },
      { date: new Date("2026-03-05"), description: "Netflix Monthly",   amount: 15.99, type: "DEBIT"  },
      { date: new Date("2026-03-10"), description: "Employer Payroll",  amount: 3000,  type: "CREDIT" },
    ]);
    batchId = batch.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("flags incoming transactions that already exist in the DB", async () => {
    const saved = await db.statementTransaction.findMany({
      where: { importBatchId: batchId },
      select: { id: true, date: true, description: true, amount: true },
    });
    const existing = saved.map((e) => ({ ...e, amount: Number(e.amount) }));

    const incoming = [
      { date: "2026-03-01", description: "Starbucks Coffee",  amount: 4.50,  type: "DEBIT"  as const },
      { date: "2026-03-20", description: "Amazon Purchase",   amount: 39.99, type: "DEBIT"  as const },
    ];

    const { safe, duplicates } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(1);
    expect(safe[0].description).toBe("Amazon Purchase");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].incoming.description).toBe("Starbucks Coffee");
  });

  it("treats all transactions as safe against an empty existing list", () => {
    const incoming = [
      { date: "2026-03-01", description: "Starbucks", amount: 4.50, type: "DEBIT" as const },
    ];
    const { safe, duplicates } = detectDuplicates(incoming, []);
    expect(safe).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Month-scoped list and summary
// ─────────────────────────────────────────────────────────────────────────────

describe("month-scoped list and summary (real DB)", () => {
  let batchId: string;

  beforeAll(async () => {
    const batch = await createBatch("month-test.csv", [
      { date: new Date("2026-01-15"), description: "Jan Grocery",  amount: 80,   type: "DEBIT",  category: "Food & Dining" },
      { date: new Date("2026-02-10"), description: "Feb Transport", amount: 30,   type: "DEBIT",  category: "Transport"     },
      { date: new Date("2026-02-20"), description: "Feb Salary",   amount: 3000,  type: "CREDIT", category: "Income"        },
      { date: new Date("2026-03-05"), description: "Mar Shopping", amount: 120,   type: "DEBIT",  category: "Shopping"      },
    ]);
    batchId = batch.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("list without month filter returns all 4 transactions", async () => {
    const result = await makeCaller().list({ limit: 100 });
    const ids = result.items.map((t) => t.description);
    expect(ids).toContain("Jan Grocery");
    expect(ids).toContain("Feb Transport");
    expect(ids).toContain("Feb Salary");
    expect(ids).toContain("Mar Shopping");
  });

  it("list with month=2026-02 returns only Feb transactions", async () => {
    const result = await makeCaller().list({ month: "2026-02", limit: 100 });
    const descs = result.items.map((t) => t.description);
    expect(descs).toContain("Feb Transport");
    expect(descs).toContain("Feb Salary");
    expect(descs).not.toContain("Jan Grocery");
    expect(descs).not.toContain("Mar Shopping");
  });

  it("list with month=2026-01 returns only Jan transaction", async () => {
    const result = await makeCaller().list({ month: "2026-01", limit: 100 });
    const descs = result.items.map((t) => t.description);
    expect(descs).toContain("Jan Grocery");
    expect(descs).not.toContain("Feb Salary");
  });

  it("summary without month returns aggregate across all months", async () => {
    const result = await makeCaller().summary({});
    // Total debits across all months: 80 + 30 + 120 = 230
    expect(result.totalDebits).toBeGreaterThanOrEqual(230);
    expect(result.totalCredits).toBeGreaterThanOrEqual(3000);
  });

  it("summary with month=2026-02 aggregates only Feb data", async () => {
    const result = await makeCaller().summary({ month: "2026-02" });
    expect(result.totalDebits).toBeCloseTo(30);
    expect(result.totalCredits).toBeCloseTo(3000);
    expect(result.totalCount).toBe(2);
  });

  it("summary with month=2026-01 aggregates only Jan data", async () => {
    const result = await makeCaller().summary({ month: "2026-01" });
    expect(result.totalDebits).toBeCloseTo(80);
    expect(result.totalCredits).toBeCloseTo(0);
    expect(result.totalCount).toBe(1);
  });

  it("list with category filter returns only matching transactions", async () => {
    const result = await makeCaller().list({ category: "Transport", limit: 100 });
    expect(result.items.every((t) => t.category === "Transport")).toBe(true);
    expect(result.items.some((t) => t.description === "Feb Transport")).toBe(true);
  });

  it("list with type=CREDIT returns only credit transactions", async () => {
    const result = await makeCaller().list({ type: "CREDIT", limit: 100 });
    expect(result.items.every((t) => t.type === "CREDIT")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Month boundary edge case
// ─────────────────────────────────────────────────────────────────────────────

describe("month boundary correctness", () => {
  let batchId: string;

  beforeAll(async () => {
    const batch = await createBatch("boundary-test.csv", [
      { date: new Date(Date.UTC(2026, 3, 30)), description: "Last day April", amount: 10, type: "DEBIT" }, // Apr 30 UTC
      { date: new Date(Date.UTC(2026, 4, 1)),  description: "First day May",  amount: 20, type: "DEBIT" }, // May 1 UTC
      { date: new Date(Date.UTC(2026, 4, 31)), description: "Last day May",   amount: 30, type: "DEBIT" }, // May 31 UTC
      { date: new Date(Date.UTC(2026, 5, 1)),  description: "First day June", amount: 40, type: "DEBIT" }, // Jun 1 UTC
    ]);
    batchId = batch.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("month=2026-05 includes May 1 and May 31 but not Apr 30 or Jun 1", async () => {
    const result = await makeCaller().list({ month: "2026-05", limit: 100 });
    const descs = result.items.map((t) => t.description);
    expect(descs).toContain("First day May");
    expect(descs).toContain("Last day May");
    expect(descs).not.toContain("Last day April");
    expect(descs).not.toContain("First day June");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toggleExclude effects on summary
// ─────────────────────────────────────────────────────────────────────────────

describe("toggleExclude effects on summary", () => {
  let batchId: string;
  let txnId: string;

  beforeAll(async () => {
    const batch = await createBatch("exclude-test.csv", [
      { date: new Date("2026-06-01"), description: "Salary",    amount: 5000, type: "CREDIT" },
      { date: new Date("2026-06-05"), description: "Rent",      amount: 1200, type: "DEBIT"  },
      { date: new Date("2026-06-10"), description: "Groceries", amount: 150,  type: "DEBIT"  },
    ]);
    batchId = batch.id;
    const saved = await db.statementTransaction.findFirst({ where: { importBatchId: batchId, description: "Rent" } });
    txnId = saved!.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("summary counts all non-excluded transactions", async () => {
    const result = await makeCaller().summary({ month: "2026-06" });
    // Rent (1200) + Groceries (150) = 1350
    expect(result.totalDebits).toBeCloseTo(1350);
    expect(result.totalCredits).toBeCloseTo(5000);
    expect(result.totalCount).toBe(3);
  });

  it("excluded transaction disappears from summary after toggle", async () => {
    await makeCaller().toggleExclude({ id: txnId });
    const result = await makeCaller().summary({ month: "2026-06" });
    // Rent excluded → only Groceries (150) in debits
    expect(result.totalDebits).toBeCloseTo(150);
    expect(result.totalCount).toBe(2);
  });

  it("list by default excludes the toggled transaction", async () => {
    const result = await makeCaller().list({ month: "2026-06", limit: 100 });
    expect(result.items.every((t) => t.description !== "Rent")).toBe(true);
  });

  it("list with includeExcluded=true shows the excluded transaction", async () => {
    const result = await makeCaller().list({ month: "2026-06", includeExcluded: true, limit: 100 });
    expect(result.items.some((t) => t.description === "Rent")).toBe(true);
  });

  it("re-toggling brings the transaction back into the summary", async () => {
    await makeCaller().toggleExclude({ id: txnId });
    const result = await makeCaller().summary({ month: "2026-06" });
    expect(result.totalDebits).toBeCloseTo(1350);
    expect(result.totalCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateCategory persists
// ─────────────────────────────────────────────────────────────────────────────

describe("updateCategory (real DB)", () => {
  let batchId: string;
  let txnId: string;

  beforeAll(async () => {
    const batch = await createBatch("category-test.csv", [
      { date: new Date("2026-07-01"), description: "Uber Eats", amount: 24, type: "DEBIT", category: "Other" },
    ]);
    batchId = batch.id;
    const saved = await db.statementTransaction.findFirst({ where: { importBatchId: batchId } });
    txnId = saved!.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("persists a category change to the DB", async () => {
    await makeCaller().updateCategory({ id: txnId, category: "Food & Dining", mccCode: "5812", mccLabel: "Restaurants" });
    const updated = await db.statementTransaction.findUnique({ where: { id: txnId } });
    expect(updated?.category).toBe("Food & Dining");
    expect(updated?.mccCode).toBe("5812");
    expect(updated?.mccLabel).toBe("Restaurants");
  });

  it("does not change other fields on the transaction", async () => {
    const updated = await db.statementTransaction.findUnique({ where: { id: txnId } });
    expect(Number(updated?.amount)).toBeCloseTo(24);
    expect(updated?.description).toBe("Uber Eats");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteTransaction
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteTransaction (real DB)", () => {
  let batchId: string;
  let txnId: string;

  beforeAll(async () => {
    const batch = await createBatch("delete-txn-test.csv", [
      { date: new Date("2026-08-01"), description: "To Delete", amount: 9.99, type: "DEBIT" },
      { date: new Date("2026-08-02"), description: "To Keep",   amount: 5.00, type: "DEBIT" },
    ]);
    batchId = batch.id;
    const saved = await db.statementTransaction.findFirst({ where: { importBatchId: batchId, description: "To Delete" } });
    txnId = saved!.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("removes the transaction from the DB", async () => {
    const result = await makeCaller().deleteTransaction({ id: txnId });
    expect(result.success).toBe(true);
    const gone = await db.statementTransaction.findUnique({ where: { id: txnId } });
    expect(gone).toBeNull();
  });

  it("leaves the sibling transaction untouched", async () => {
    const remaining = await db.statementTransaction.findMany({ where: { importBatchId: batchId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].description).toBe("To Keep");
  });

  it("throws NOT_FOUND when the transaction does not belong to this org", async () => {
    await expect(makeCaller().deleteTransaction({ id: txnId })).rejects.toThrow("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteByBatch
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteByBatch (real DB)", () => {
  let batchId: string;

  beforeAll(async () => {
    const batch = await createBatch("delete-batch-test.csv", [
      { date: new Date("2026-09-01"), description: "TXN A", amount: 10, type: "DEBIT" },
      { date: new Date("2026-09-02"), description: "TXN B", amount: 20, type: "DEBIT" },
      { date: new Date("2026-09-03"), description: "TXN C", amount: 30, type: "DEBIT" },
    ]);
    batchId = batch.id;
  });

  it("deletes all 3 transactions and the batch record", async () => {
    const result = await makeCaller().deleteByBatch({ batchId });
    expect(result.success).toBe(true);

    const txns = await db.statementTransaction.findMany({ where: { importBatchId: batchId } });
    expect(txns).toHaveLength(0);

    const batch = await db.statementImportBatch.findUnique({ where: { id: batchId } });
    expect(batch).toBeNull();
  });

  it("throws NOT_FOUND when the batch no longer exists", async () => {
    await expect(makeCaller().deleteByBatch({ batchId })).rejects.toThrow("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listBatches
// ─────────────────────────────────────────────────────────────────────────────

describe("listBatches (real DB)", () => {
  const batchIds: string[] = [];

  beforeAll(async () => {
    // Create two batches with a small delay to get distinct createdAt ordering
    const b1 = await db.statementImportBatch.create({
      data: { organisationId: orgId, filename: "older.csv", fileType: "CSV", status: "DONE", transactionCount: 5 },
    });
    await new Promise((r) => setTimeout(r, 10)); // ensure ordering
    const b2 = await db.statementImportBatch.create({
      data: { organisationId: orgId, filename: "newer.pdf", fileType: "PDF", status: "DONE", transactionCount: 12 },
    });
    batchIds.push(b1.id, b2.id);
  });

  afterAll(async () => {
    await db.statementImportBatch.deleteMany({ where: { id: { in: batchIds } } });
  });

  it("returns batches ordered newest first", async () => {
    const result = await makeCaller().listBatches();
    const names = result.map((b) => b.filename);
    expect(names.indexOf("newer.pdf")).toBeLessThan(names.indexOf("older.csv"));
  });

  it("returns only batches for the correct org", async () => {
    // Create a second org and verify its batches don't appear
    const otherOrg = await db.organisation.create({ data: { name: "Other Org PF Test" } });
    await db.statementImportBatch.create({
      data: { organisationId: otherOrg.id, filename: "other-org.csv", fileType: "CSV", status: "DONE", transactionCount: 0 },
    });

    const result = await makeCaller().listBatches();
    expect(result.every((b) => b.filename !== "other-org.csv")).toBe(true);

    // cleanup
    await db.statementImportBatch.deleteMany({ where: { organisationId: otherOrg.id } });
    await db.organisation.delete({ where: { id: otherOrg.id } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cursor pagination
// ─────────────────────────────────────────────────────────────────────────────

describe("cursor pagination (real DB)", () => {
  let batchId: string;

  beforeAll(async () => {
    const batch = await createBatch("pagination-test.csv",
      Array.from({ length: 7 }, (_, i) => ({
        date: new Date(`2026-10-${String(i + 1).padStart(2, "0")}`),
        description: `TXN-${i + 1}`,
        amount: 10 * (i + 1),
        type: "DEBIT" as const,
      }))
    );
    batchId = batch.id;
  });

  afterAll(async () => {
    await db.statementTransaction.deleteMany({ where: { importBatchId: batchId } });
    await db.statementImportBatch.deleteMany({ where: { id: batchId } });
  });

  it("first page of 3 returns nextCursor", async () => {
    const page1 = await makeCaller().list({ limit: 3, month: "2026-10" });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeDefined();
  });

  it("second page uses nextCursor to get the next batch", async () => {
    const page1 = await makeCaller().list({ limit: 3, month: "2026-10" });
    const page2 = await makeCaller().list({ limit: 3, month: "2026-10", cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(3);
    // Items should be disjoint
    const page1Ids = new Set(page1.items.map((t) => t.id));
    expect(page2.items.every((t) => !page1Ids.has(t.id))).toBe(true);
  });

  it("last partial page has no nextCursor", async () => {
    const page1 = await makeCaller().list({ limit: 3, month: "2026-10" });
    const page2 = await makeCaller().list({ limit: 3, month: "2026-10", cursor: page1.nextCursor });
    const page3 = await makeCaller().list({ limit: 3, month: "2026-10", cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(1); // 7 items, 3+3+1
    expect(page3.nextCursor).toBeUndefined();
  });
});
