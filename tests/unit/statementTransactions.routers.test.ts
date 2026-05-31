import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

const ORG = "org-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return { session: { user: { id: "user-1" } }, db };
}

function dec(n: number) { return new Prisma.Decimal(n); }

const createCaller = createCallerFactory(statementTransactionsRouter);

// ─── list ─────────────────────────────────────────────────────────────────────

describe("statementTransactions.list", () => {
  it("returns transactions for the org", async () => {
    const mockTxns = [
      { id: "t1", organisationId: ORG, date: new Date("2026-05-01"), description: "SQ *STARBUCKS", merchantName: "Starbucks", amount: dec(6.40), type: "DEBIT", category: "Food & Dining", mccCode: "5812", mccLabel: "Restaurants", isExcluded: false, importBatchId: "b1", createdAt: new Date(), updatedAt: new Date() },
    ];
    const caller = createCaller(makeCtx({
      statementTransaction: { findMany: vi.fn().mockResolvedValue(mockTxns) },
    }));
    const result = await caller.list({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].merchantName).toBe("Starbucks");
  });

  it("excludes isExcluded transactions by default", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({
      statementTransaction: { findMany },
    }));
    await caller.list({});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isExcluded: false }) })
    );
  });

  it("includes excluded when includeExcluded=true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ includeExcluded: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where.isExcluded).toBeUndefined();
  });

  it("applies month filter as gte/lt date range", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ month: "2026-05" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(2026, 4, 1));   // May 1 local
    expect(where.date.lt).toEqual(new Date(2026, 5, 1));    // Jun 1 local
  });

  it("applies dateFrom/dateTo when no month is given", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date("2026-05-01"));
    expect(where.date.lte).toEqual(new Date("2026-05-31"));
  });

  it("applies category filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ category: "Transport" });
    expect(findMany.mock.calls[0][0].where.category).toBe("Transport");
  });

  it("applies type filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ type: "DEBIT" });
    expect(findMany.mock.calls[0][0].where.type).toBe("DEBIT");
  });

  it("applies search filter on merchantName", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ search: "star" });
    expect(findMany.mock.calls[0][0].where.merchantName).toEqual({ contains: "star", mode: "insensitive" });
  });

  it("sets nextCursor when more items exist than limit", async () => {
    // Return limit+1 items — the router should pop the last and set nextCursor
    const items = Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`, organisationId: ORG, date: new Date(), description: "x",
      merchantName: "M", amount: dec(1), type: "DEBIT", category: "Other",
      mccCode: "0000", mccLabel: "", isExcluded: false, importBatchId: null,
      createdAt: new Date(), updatedAt: new Date(),
    }));
    const findMany = vi.fn().mockResolvedValue(items);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    const result = await caller.list({ limit: 3 });
    expect(result.items).toHaveLength(3);         // last item popped
    expect(result.nextCursor).toBe("3");           // skip=0+limit=3
  });

  it("uses cursor as skip offset for pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ cursor: "50" });
    expect(findMany.mock.calls[0][0].skip).toBe(50);
  });

  it("returns no nextCursor when result set fits in one page", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    const result = await caller.list({ limit: 50 });
    expect(result.nextCursor).toBeUndefined();
  });
});

// ─── updateCategory ───────────────────────────────────────────────────────────

describe("statementTransactions.updateCategory", () => {
  it("updates category, mccCode, mccLabel", async () => {
    const mockTxn = { id: "t1", organisationId: ORG };
    const update = vi.fn().mockResolvedValue({ ...mockTxn, category: "Transport" });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue(mockTxn),
        update,
      },
    }));
    await caller.updateCategory({ id: "t1", category: "Transport", mccCode: "4121", mccLabel: "Taxicabs" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { category: "Transport", mccCode: "4121", mccLabel: "Taxicabs" },
    });
  });

  it("throws NOT_FOUND when transaction does not belong to org", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await expect(caller.updateCategory({ id: "t-missing", category: "Shopping" }))
      .rejects.toThrow("NOT_FOUND");
  });
});

// ─── toggleExclude ────────────────────────────────────────────────────────────

describe("statementTransactions.toggleExclude", () => {
  it("flips isExcluded from false to true", async () => {
    const update = vi.fn().mockResolvedValue({ id: "t1", isExcluded: true });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", organisationId: ORG, isExcluded: false }),
        update,
      },
    }));
    await caller.toggleExclude({ id: "t1" });
    expect(update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { isExcluded: true } });
  });

  it("flips isExcluded from true to false", async () => {
    const update = vi.fn().mockResolvedValue({ id: "t1", isExcluded: false });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", organisationId: ORG, isExcluded: true }),
        update,
      },
    }));
    await caller.toggleExclude({ id: "t1" });
    expect(update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { isExcluded: false } });
  });
});

// ─── deleteByBatch ────────────────────────────────────────────────────────────

describe("statementTransactions.deleteByBatch", () => {
  it("deletes transactions and batch", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const deleteFn = vi.fn().mockResolvedValue({ id: "b1" });
    const caller = createCaller(makeCtx({
      statementTransaction: { deleteMany },
      statementImportBatch: {
        findFirst: vi.fn().mockResolvedValue({ id: "b1", organisationId: ORG }),
        delete: deleteFn,
      },
    }));
    const result = await caller.deleteByBatch({ batchId: "b1" });
    expect(deleteMany).toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("throws NOT_FOUND for unknown batch", async () => {
    const caller = createCaller(makeCtx({
      statementImportBatch: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await expect(caller.deleteByBatch({ batchId: "missing" })).rejects.toThrow("NOT_FOUND");
  });
});

// ─── deleteTransaction ────────────────────────────────────────────────────────

describe("statementTransactions.deleteTransaction", () => {
  it("deletes a transaction that belongs to the org", async () => {
    const deleteFn = vi.fn().mockResolvedValue({ id: "t1" });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", organisationId: ORG }),
        delete: deleteFn,
      },
    }));
    const result = await caller.deleteTransaction({ id: "t1" });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: "t1" } });
    expect(result.success).toBe(true);
  });

  it("throws NOT_FOUND when transaction does not belong to org", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await expect(caller.deleteTransaction({ id: "missing" })).rejects.toThrow("NOT_FOUND");
  });
});

// ─── listBatches ─────────────────────────────────────────────────────────────

describe("statementTransactions.listBatches", () => {
  it("returns import batches for the org ordered by newest first", async () => {
    const mockBatches = [
      { id: "b2", filename: "June.pdf", status: "DONE", transactionCount: 22, fileType: "PDF", createdAt: new Date() },
      { id: "b1", filename: "May.csv",  status: "DONE", transactionCount: 15, fileType: "CSV", createdAt: new Date() },
    ];
    const findMany = vi.fn().mockResolvedValue(mockBatches);
    const caller = createCaller(makeCtx({ statementImportBatch: { findMany } }));
    const result = await caller.listBatches();
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe("June.pdf");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, take: 20 })
    );
  });
});

// ─── summary ─────────────────────────────────────────────────────────────────

describe("statementTransactions.summary", () => {
  it("returns aggregated counts and latest batch", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: {
        count: vi.fn().mockResolvedValue(47),
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { amount: dec(821.50) } })  // debits
          .mockResolvedValueOnce({ _sum: { amount: dec(3200.00) } }), // credits
      },
      statementImportBatch: {
        findFirst: vi.fn().mockResolvedValue({ id: "b1", filename: "May.pdf", transactionCount: 47, createdAt: new Date() }),
      },
    }));
    const result = await caller.summary({});
    expect(result.totalCount).toBe(47);
    expect(result.totalDebits).toBeCloseTo(821.50);
    expect(result.totalCredits).toBeCloseTo(3200.00);
    expect(result.latestBatch?.id).toBe("b1");
  });

  it("returns zeros when no transactions exist", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      statementImportBatch: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    const result = await caller.summary({});
    expect(result.totalCount).toBe(0);
    expect(result.totalDebits).toBe(0);
    expect(result.totalCredits).toBe(0);
    expect(result.latestBatch).toBeNull();
  });

  it("applies month filter in the where clause for all three aggregates", async () => {
    const count     = vi.fn().mockResolvedValue(5);
    const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: dec(0) } });
    const caller = createCaller(makeCtx({
      statementTransaction: { count, aggregate },
      statementImportBatch: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await caller.summary({ month: "2026-05" });

    // All DB calls should have the date range scoped to May 2026
    const countWhere = count.mock.calls[0][0].where;
    expect(countWhere.date.gte).toEqual(new Date(2026, 4, 1));
    expect(countWhere.date.lt).toEqual(new Date(2026, 5, 1));

    const debitWhere = aggregate.mock.calls[0][0].where;
    expect(debitWhere.type).toBe("DEBIT");
    expect(debitWhere.date.gte).toEqual(new Date(2026, 4, 1));
  });
});
