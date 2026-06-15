/**
 * transactions router unit tests
 *
 * Tests the transactionsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma and service layer — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Service mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@/server/services/accounting.service", () => ({
  createJournalEntry: vi.fn().mockResolvedValue({
    id: "je-1",
    description: "Test Entry",
    date: new Date("2026-01-01"),
    isVoid: false,
    source: "MANUAL",
    reference: null,
    organisationId: "org-1",
    createdAt: new Date("2026-01-01"),
    lines: [],
  }),
  voidJournalEntry: vi.fn().mockResolvedValue({
    id: "je-void-1",
    description: "Reversal",
    date: new Date("2026-01-01"),
    isVoid: false,
    source: "MANUAL",
    reference: null,
    organisationId: "org-1",
    createdAt: new Date("2026-01-01"),
    lines: [],
  }),
  buildIncomeEntry: vi.fn().mockReturnValue({
    description: "Income",
    date: new Date("2026-01-01"),
    lines: [
      { accountId: "acc-income", credit: 100 },
      { accountId: "acc-cash", debit: 100 },
    ],
  }),
  buildExpenseEntry: vi.fn().mockReturnValue({
    description: "Expense",
    date: new Date("2026-01-01"),
    lines: [
      { accountId: "acc-expense", debit: 100 },
      { accountId: "acc-cash", credit: 100 },
    ],
  }),
}));

vi.mock("@/server/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

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

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createCallerFactory } from "@/server/trpc";
import { transactionsRouter } from "@/server/routers/transactions";
import {
  createJournalEntry,
  voidJournalEntry,
  buildIncomeEntry,
  buildExpenseEntry,
} from "@/server/services/accounting.service";
import { writeAuditLog } from "@/server/services/audit.service";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = "org-1";
const USER_ID = "user-1";

const baseEntry = {
  id: "je-1",
  organisationId: ORG,
  description: "Test Entry",
  date: new Date("2026-01-01"),
  reference: null,
  isVoid: false,
  source: "MANUAL" as const,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  lines: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID, email: "u@test.com" } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(transactionsRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("transactions.list", () => {
  it("returns paginated results with entries, total, and pages", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([baseEntry, { ...baseEntry, id: "je-2" }]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.pages).toBe(1);
  });

  it("returns empty list when no entries exist", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.pages).toBe(0);
  });

  it("filters by search term (description and reference)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, search: "rent" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR).toHaveLength(2);
  });

  it("excludes voided entries by default (showVoided=false)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1 });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isVoid).toBe(false);
  });

  it("includes voided entries when showVoided=true", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, showVoided: true });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isVoid).toBeUndefined();
  });

  it("filters by accountId using lines.some", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, accountId: "acc-1" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.lines?.some?.accountId).toBe("acc-1");
  });

  it("filters by dateFrom", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const from = new Date("2026-01-01");
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, dateFrom: from });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.date?.gte).toEqual(from);
  });

  it("filters by dateTo", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const to = new Date("2026-06-30");
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, dateTo: to });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.date?.lte).toEqual(to);
  });

  it("filters by both dateFrom and dateTo simultaneously", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const from = new Date("2026-01-01");
    const to = new Date("2026-06-30");
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1, dateFrom: from, dateTo: to });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.date?.gte).toEqual(from);
    expect(whereArg.date?.lte).toEqual(to);
  });

  it("calculates correct pages for multiple page results", async () => {
    const count = vi.fn().mockResolvedValue(150); // PAGE_SIZE=50 → 3 pages
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.pages).toBe(3);
  });

  it("scopes query to current organisation", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ journalEntry: { count, findMany } }));
    await caller.list({ page: 1 });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.organisationId).toBe(ORG);
  });
});

// ─── createIncome ─────────────────────────────────────────────────────────────

describe("transactions.createIncome", () => {
  const validInput = {
    date: new Date("2026-01-15"),
    description: "Consulting payment",
    amount: 1500,
    incomeAccountId: "acc-income",
    cashAccountId: "acc-cash",
  };

  it("calls buildIncomeEntry with correct params", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createIncome(validInput);
    expect(buildIncomeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1500,
        incomeAccountId: "acc-income",
        cashAccountId: "acc-cash",
      })
    );
  });

  it("calls createJournalEntry with organisationId and MANUAL source", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createIncome(validInput);
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        source: "MANUAL",
      })
    );
  });

  it("returns the created journal entry", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    const result = await caller.createIncome(validInput);
    expect(result.id).toBe("je-1");
    expect(result.source).toBe("MANUAL");
  });

  it("calls writeAuditLog with CREATE action", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createIncome(validInput);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: "je-1",
      })
    );
  });

  it("rejects when amount is zero (not positive)", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await expect(
      caller.createIncome({ ...validInput, amount: 0 })
    ).rejects.toThrow();
  });

  it("rejects when amount is negative", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await expect(
      caller.createIncome({ ...validInput, amount: -100 })
    ).rejects.toThrow();
  });

  it("passes optional reference to createJournalEntry", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createIncome({ ...validInput, reference: "REF-001" });
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reference: "REF-001" })
    );
  });
});

// ─── createExpense ────────────────────────────────────────────────────────────

describe("transactions.createExpense", () => {
  const validInput = {
    date: new Date("2026-02-01"),
    description: "Office rent",
    amount: 2000,
    expenseAccountId: "acc-expense",
    cashAccountId: "acc-cash",
  };

  it("calls buildExpenseEntry with correct params", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createExpense(validInput);
    expect(buildExpenseEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        expenseAccountId: "acc-expense",
        cashAccountId: "acc-cash",
      })
    );
  });

  it("calls createJournalEntry with MANUAL source", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createExpense(validInput);
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "MANUAL", organisationId: ORG })
    );
  });

  it("returns the created journal entry", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    const result = await caller.createExpense(validInput);
    expect(result.id).toBe("je-1");
  });

  it("calls writeAuditLog with CREATE action", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await caller.createExpense(validInput);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: "je-1",
      })
    );
  });

  it("rejects when amount is not positive", async () => {
    const caller = createCaller(makeCtx({ journalEntry: {} }));
    await expect(
      caller.createExpense({ ...validInput, amount: 0 })
    ).rejects.toThrow();
  });
});

// ─── void ─────────────────────────────────────────────────────────────────────

describe("transactions.void", () => {
  it("throws NOT_FOUND when journal entry does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await expect(caller.void({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when entry is not from a MANUAL source", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseEntry, source: "INVOICE" });
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await expect(caller.void({ id: "je-1" })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("calls voidJournalEntry for a valid MANUAL entry", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseEntry, source: "MANUAL", isVoid: false });
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await caller.void({ id: "je-1", reason: "Entered in error" });
    expect(voidJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      "je-1",
      ORG,
      USER_ID,
      "Entered in error"
    );
  });

  it("calls writeAuditLog with VOID action", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseEntry, source: "MANUAL", isVoid: false });
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await caller.void({ id: "je-1", reason: "Error" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "VOID",
        entityType: "JournalEntry",
        entityId: "je-1",
      })
    );
  });

  it("returns the reversal journal entry", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseEntry, source: "MANUAL", isVoid: false });
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    const result = await caller.void({ id: "je-1", reason: "Test" });
    expect(result.id).toBe("je-void-1");
  });

  it("uses default reason when none provided", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseEntry, source: "MANUAL", isVoid: false });
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await caller.void({ id: "je-1" });
    expect(voidJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      "je-1",
      ORG,
      USER_ID,
      "Voided by user"
    );
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("transactions.getById", () => {
  it("returns journal entry with lines when found", async () => {
    const entry = {
      ...baseEntry,
      lines: [{ id: "l-1", accountId: "acc-1", debit: "100", credit: "0", account: { id: "acc-1", code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" } }],
    };
    const findFirst = vi.fn().mockResolvedValue(entry);
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    const result = await caller.getById({ id: "je-1" });
    expect(result.id).toBe("je-1");
    expect(result.lines).toHaveLength(1);
  });

  it("throws NOT_FOUND when entry does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ journalEntry: { findFirst } }));
    await expect(caller.getById({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });
});
