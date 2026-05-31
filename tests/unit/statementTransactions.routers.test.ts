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
});
