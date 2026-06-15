/**
 * accounts router unit tests
 *
 * Tests the accountsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// vi.mock is hoisted — must use literals in factory
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

vi.mock("@/server/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createCallerFactory } from "@/server/trpc";
import { accountsRouter } from "@/server/routers/accounts";
import { writeAuditLog } from "@/server/services/audit.service";

const ORG = "org-1";
const USER_ID = "user-1";

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

const createCaller = createCallerFactory(accountsRouter);

function dec(n: number) {
  return new Prisma.Decimal(n);
}

const baseAccount = {
  id: "acct-1",
  organisationId: ORG,
  code: "1000",
  name: "Cash",
  type: "ASSET" as const,
  normalBalance: "DEBIT" as const,
  description: null,
  parentId: null,
  parent: null,
  sortOrder: 1,
  isSystem: false,
  isArchived: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ──────────────────────────────────────────────────────────────────────

describe("accounts.list", () => {
  it("returns all non-archived accounts by default", async () => {
    const accounts = [baseAccount, { ...baseAccount, id: "acct-2", code: "2000", name: "Accounts Payable", type: "LIABILITY" as const, normalBalance: "CREDIT" as const }];
    const findMany = vi.fn().mockResolvedValue(accounts);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.list({});
    expect(result).toHaveLength(2);
  });

  it("filters by type ASSET", async () => {
    const findMany = vi.fn().mockResolvedValue([baseAccount]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    await caller.list({ type: "ASSET" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "ASSET" }) })
    );
  });

  it("excludes archived accounts by default", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    await caller.list({});
    const where = findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBe(false);
  });

  it("includes archived when includeArchived=true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    await caller.list({ includeArchived: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBeUndefined();
  });
});

// ─── listFlat ─────────────────────────────────────────────────────────────────

describe("accounts.listFlat", () => {
  it("returns only non-archived accounts", async () => {
    const accounts = [baseAccount];
    const findMany = vi.fn().mockResolvedValue(accounts);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.listFlat();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isArchived: false }) })
    );
    expect(result).toHaveLength(1);
  });

  it("orders by type, sortOrder, code", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    await caller.listFlat();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
      })
    );
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("accounts.create", () => {
  it("throws CONFLICT when account code already exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(baseAccount);
    const caller = createCaller(makeCtx({ chartAccount: { findUnique } }));
    await expect(
      caller.create({ code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" })
    ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("creates an account successfully when code is unique", async () => {
    const created = { ...baseAccount };
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ chartAccount: { findUnique, create } }));
    const result = await caller.create({ code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: ORG,
          code: "1000",
          name: "Cash",
          type: "ASSET",
          normalBalance: "DEBIT",
        }),
      })
    );
    expect(result.id).toBe("acct-1");
  });

  it("calls writeAuditLog after creation", async () => {
    const created = { ...baseAccount };
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ chartAccount: { findUnique, create } }));
    await caller.create({ code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "CREATE",
        entityType: "ChartAccount",
        entityId: "acct-1",
      })
    );
  });

  it("returns the created account", async () => {
    const created = { ...baseAccount, name: "Bank Account", code: "1010" };
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ chartAccount: { findUnique, create } }));
    const result = await caller.create({ code: "1010", name: "Bank Account", type: "ASSET", normalBalance: "DEBIT" });
    expect(result.name).toBe("Bank Account");
    expect(result.code).toBe("1010");
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe("accounts.update", () => {
  it("throws NOT_FOUND when account does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst } }));
    await expect(
      caller.update({ id: "missing", name: "New Name" })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("throws FORBIDDEN when account is a system account", async () => {
    const systemAccount = { ...baseAccount, isSystem: true };
    const findFirst = vi.fn().mockResolvedValue(systemAccount);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst } }));
    await expect(
      caller.update({ id: "acct-1", name: "Hack System" })
    ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("updates the account name", async () => {
    const existing = { ...baseAccount };
    const updated = { ...baseAccount, name: "Petty Cash" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst, update } }));
    const result = await caller.update({ id: "acct-1", name: "Petty Cash" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct-1" } })
    );
    expect(result.name).toBe("Petty Cash");
  });

  it("calls writeAuditLog after update", async () => {
    const existing = { ...baseAccount };
    const updated = { ...baseAccount, name: "Updated" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst, update } }));
    await caller.update({ id: "acct-1", name: "Updated" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "UPDATE",
        entityType: "ChartAccount",
        entityId: "acct-1",
      })
    );
  });
});

// ─── archive ──────────────────────────────────────────────────────────────────

describe("accounts.archive", () => {
  it("throws NOT_FOUND when account does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst } }));
    await expect(
      caller.archive({ id: "missing", archive: true })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("throws FORBIDDEN when account is a system account", async () => {
    const systemAccount = { ...baseAccount, isSystem: true };
    const findFirst = vi.fn().mockResolvedValue(systemAccount);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst } }));
    await expect(
      caller.archive({ id: "acct-1", archive: true })
    ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("archives a non-system account", async () => {
    const existing = { ...baseAccount };
    const archived = { ...baseAccount, isArchived: true };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(archived);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst, update } }));
    const result = await caller.archive({ id: "acct-1", archive: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isArchived: true } })
    );
    expect(result.isArchived).toBe(true);
  });

  it("unarchives a previously archived account", async () => {
    const existing = { ...baseAccount, isArchived: true };
    const unarchived = { ...baseAccount, isArchived: false };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(unarchived);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst, update } }));
    const result = await caller.archive({ id: "acct-1", archive: false });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isArchived: false } })
    );
    expect(result.isArchived).toBe(false);
  });
});

// ─── getBalances ──────────────────────────────────────────────────────────────

describe("accounts.getBalances", () => {
  it("returns balance=0 for account with no journal lines", async () => {
    const accountNoLines = { ...baseAccount, journalLines: [] };
    const findMany = vi.fn().mockResolvedValue([accountNoLines]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    expect(result).toHaveLength(1);
    expect(result[0].balance).toBe(0);
    expect(result[0].totalDebits).toBe(0);
    expect(result[0].totalCredits).toBe(0);
  });

  it("DEBIT-normal account: debits > credits gives positive balance", async () => {
    const account = {
      ...baseAccount,
      normalBalance: "DEBIT" as const,
      journalLines: [
        { debit: dec(500), credit: dec(0) },
        { debit: dec(200), credit: dec(100) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // totalDebits=700, totalCredits=100, balance=600
    expect(result[0].balance).toBe(600);
    expect(result[0].totalDebits).toBe(700);
    expect(result[0].totalCredits).toBe(100);
  });

  it("DEBIT-normal account: credits > debits gives negative balance", async () => {
    const account = {
      ...baseAccount,
      normalBalance: "DEBIT" as const,
      journalLines: [
        { debit: dec(100), credit: dec(300) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // totalDebits=100, totalCredits=300, balance=-200
    expect(result[0].balance).toBe(-200);
  });

  it("CREDIT-normal account: credits > debits gives positive balance", async () => {
    const account = {
      ...baseAccount,
      id: "acct-2",
      code: "2000",
      name: "Accounts Payable",
      type: "LIABILITY" as const,
      normalBalance: "CREDIT" as const,
      journalLines: [
        { debit: dec(0), credit: dec(1000) },
        { debit: dec(200), credit: dec(500) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // totalDebits=200, totalCredits=1500, balance=1300
    expect(result[0].balance).toBe(1300);
    expect(result[0].totalCredits).toBe(1500);
    expect(result[0].totalDebits).toBe(200);
  });

  it("CREDIT-normal account: debits > credits gives negative balance", async () => {
    const account = {
      ...baseAccount,
      normalBalance: "CREDIT" as const,
      journalLines: [
        { debit: dec(500), credit: dec(100) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // totalDebits=500, totalCredits=100, balance = 100-500 = -400
    expect(result[0].balance).toBe(-400);
  });

  it("multi-line aggregation works correctly for DEBIT-normal", async () => {
    const account = {
      ...baseAccount,
      normalBalance: "DEBIT" as const,
      journalLines: [
        { debit: dec(100), credit: dec(0) },
        { debit: dec(200), credit: dec(50) },
        { debit: dec(0), credit: dec(75) },
        { debit: dec(300), credit: dec(25) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // totalDebits = 600, totalCredits = 150, balance = 450
    expect(result[0].totalDebits).toBe(600);
    expect(result[0].totalCredits).toBe(150);
    expect(result[0].balance).toBe(450);
  });

  it("returns correct shape including account metadata", async () => {
    const account = { ...baseAccount, journalLines: [] };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    const item = result[0];
    expect(item).toMatchObject({
      id: "acct-1",
      code: "1000",
      name: "Cash",
      type: "ASSET",
      normalBalance: "DEBIT",
      isSystem: false,
      isArchived: false,
      balance: 0,
    });
  });

  it("handles Prisma Decimal values correctly", async () => {
    // Verify that Number(Prisma.Decimal) works as expected
    const account = {
      ...baseAccount,
      normalBalance: "DEBIT" as const,
      journalLines: [
        { debit: dec(1234.5678), credit: dec(234.5678) },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([account]);
    const caller = createCaller(makeCtx({ chartAccount: { findMany } }));
    const result = await caller.getBalances({});
    // balance = 1234.5678 - 234.5678 = 1000
    expect(result[0].balance).toBeCloseTo(1000, 4);
  });
});
