/**
 * GDPR router tests
 *
 * Tests auditLog, exportData, deleteAccount, purgeOldChatMessages, and
 * recordConsent procedures via createCallerFactory with fully mocked Prisma.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mocks (must be hoisted before imports) ───────────────────────────────────

vi.mock("@/server/middleware/rateLimit", () => ({
  registerRateLimiter: vi.fn().mockReturnValue({ allowed: true, retryAfterSec: 0 }),
  exportRateLimiter: vi.fn(),
  deletionRateLimiter: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue("127.0.0.1"),
  }),
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
import { gdprRouter } from "@/server/routers/gdpr";
import { db } from "@/lib/db";

// ── Typed mock handle ─────────────────────────────────────────────────────────

const mockUserFindUnique = db.user.findUnique as ReturnType<typeof vi.fn>;

// ── Caller factory ────────────────────────────────────────────────────────────

const createCaller = createCallerFactory(gdprRouter);

/** Helper to build a full ctx.db mock for each test */
function makeDbMock(overrides: Record<string, unknown> = {}) {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
      update: vi.fn().mockResolvedValue({ id: "user-1", organisationId: "org-1" }),
    },
    organisation: {
      findUnique: vi.fn().mockResolvedValue({ users: [{ id: "user-1" }] }),
      delete: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    bill: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    contact: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    journalEntry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    budget: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    chatMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    session: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Create a transaction proxy that uses the same mock db
      const txDb: Record<string, unknown> = {};
      return fn(txDb);
    }),
    ...overrides,
  };
}

function makeOrgCaller(dbMock = makeDbMock()) {
  return createCaller({
    session: { user: { id: "user-1" } } as any,
    db: dbMock as any,
    organisationId: "org-1",
    organisation: { id: "org-1", name: "Test Org" } as any,
    user: { id: "user-1", organisationId: "org-1" } as any,
  } as any);
}

function makeProtectedCaller(dbMock = makeDbMock()) {
  return createCaller({
    session: { user: { id: "user-1" } } as any,
    db: dbMock as any,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default orgProcedure middleware: db.user.findUnique returns org user
  mockUserFindUnique.mockResolvedValue({
    id: "user-1",
    organisationId: "org-1",
    organisation: { id: "org-1", name: "Test Org" },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdprRouter.auditLog
// ─────────────────────────────────────────────────────────────────────────────

describe("gdprRouter.auditLog", () => {
  it("returns {logs:[]} when no logs exist", async () => {
    const dbMock = makeDbMock();
    dbMock.auditLog.findMany.mockResolvedValue([]);

    const caller = makeOrgCaller(dbMock);
    const result = await caller.auditLog({ limit: 50 });

    expect(result).toEqual({ logs: [] });
  });

  it("returns logs with user info", async () => {
    const dbMock = makeDbMock();
    const logs = [
      {
        id: "log-1",
        action: "EXPORT",
        entityType: "Organisation",
        entityId: "org-1",
        createdAt: new Date("2024-01-01"),
        user: { name: "Alice", email: "alice@example.com" },
      },
    ];
    dbMock.auditLog.findMany.mockResolvedValue(logs);

    const caller = makeOrgCaller(dbMock);
    const result = await caller.auditLog({ limit: 50 });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].user).toEqual({ name: "Alice", email: "alice@example.com" });
    expect(result.logs[0].action).toBe("EXPORT");
  });

  it("respects the limit parameter", async () => {
    const dbMock = makeDbMock();
    dbMock.auditLog.findMany.mockResolvedValue([]);

    const caller = makeOrgCaller(dbMock);
    await caller.auditLog({ limit: 10 });

    expect(dbMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdprRouter.exportData
// ─────────────────────────────────────────────────────────────────────────────

describe("gdprRouter.exportData", () => {
  it("returns all required top-level fields", async () => {
    const dbMock = makeDbMock();
    const user = {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      role: "OWNER",
      createdAt: new Date(),
      gdprConsentAt: null,
    };
    const org = { id: "org-1", name: "Test Org", currency: "USD", createdAt: new Date() };

    dbMock.user.findUnique.mockResolvedValue(user);
    dbMock.organisation.findUnique = vi.fn().mockResolvedValue(org);

    const caller = makeOrgCaller(dbMock);
    const result = await caller.exportData();

    expect(result).toHaveProperty("exportedAt");
    expect(result).toHaveProperty("user");
    expect(result).toHaveProperty("organisation");
    expect(result).toHaveProperty("invoices");
    expect(result).toHaveProperty("bills");
    expect(result).toHaveProperty("contacts");
    expect(result).toHaveProperty("journalEntries");
    expect(result).toHaveProperty("budgets");
  });

  it("converts invoice totalAmount to string", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "A", email: "a@b.com", role: "OWNER", createdAt: new Date(), gdprConsentAt: null });
    dbMock.organisation.findUnique = vi.fn().mockResolvedValue({ id: "org-1", name: "Org", currency: "USD", createdAt: new Date() });
    dbMock.invoice.findMany.mockResolvedValue([
      { id: "inv-1", number: "INV-001", status: "SENT", totalAmount: { toString: () => "1000.0000" }, createdAt: new Date() },
    ]);

    const caller = makeOrgCaller(dbMock);
    const result = await caller.exportData();

    expect(typeof result.invoices[0].totalAmount).toBe("string");
  });

  it("converts bill totalAmount to string", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "A", email: "a@b.com", role: "OWNER", createdAt: new Date(), gdprConsentAt: null });
    dbMock.organisation.findUnique = vi.fn().mockResolvedValue({ id: "org-1", name: "Org", currency: "USD", createdAt: new Date() });
    dbMock.bill.findMany.mockResolvedValue([
      { id: "bill-1", number: "BILL-001", status: "SENT", totalAmount: { toString: () => "500.0000" }, createdAt: new Date() },
    ]);

    const caller = makeOrgCaller(dbMock);
    const result = await caller.exportData();

    expect(typeof result.bills[0].totalAmount).toBe("string");
  });

  it("writes an audit log on export", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "A", email: "a@b.com", role: "OWNER", createdAt: new Date(), gdprConsentAt: null });
    dbMock.organisation.findUnique = vi.fn().mockResolvedValue({ id: "org-1", name: "Org", currency: "USD", createdAt: new Date() });

    const caller = makeOrgCaller(dbMock);
    await caller.exportData();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "EXPORT" }),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdprRouter.deleteAccount
// ─────────────────────────────────────────────────────────────────────────────

describe("gdprRouter.deleteAccount", () => {
  function makeDeleteCaller(dbMock = makeDbMock()) {
    // deleteAccount uses protectedProcedure (not orgProcedure)
    return createCaller({
      session: { user: { id: "user-1" } } as any,
      db: dbMock as any,
    } as any);
  }

  it("throws NOT_FOUND when user doesn't exist", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue(null);

    const caller = makeDeleteCaller(dbMock);
    await expect(caller.deleteAccount({ confirmText: "DELETE" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("anonymises user PII and deletes sessions inside the transaction", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({
      email: "alice@example.com",
      organisationId: "org-1",
    });

    const txUser = { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn() };
    const txOrg = {
      findUnique: vi.fn().mockResolvedValue({ users: [{ id: "user-1" }, { id: "user-2" }] }),
      delete: vi.fn().mockResolvedValue({}),
    };
    const txSession = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };

    dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ user: txUser, organisation: txOrg, session: txSession });
    });

    const caller = makeDeleteCaller(dbMock);
    const result = await caller.deleteAccount({ confirmText: "DELETE" });

    expect(result).toEqual({ success: true });
    expect(txUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Deleted User",
          email: expect.stringContaining("deleted"),
        }),
      })
    );
    expect(txSession.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });

  it("deletes org when user is the only member", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({
      email: "alice@example.com",
      organisationId: "org-1",
    });

    const txUser = { update: vi.fn().mockResolvedValue({}) };
    const txOrg = {
      findUnique: vi.fn().mockResolvedValue({ users: [{ id: "user-1" }] }),
      delete: vi.fn().mockResolvedValue({}),
    };
    const txSession = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };

    dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ user: txUser, organisation: txOrg, session: txSession });
    });

    const caller = makeDeleteCaller(dbMock);
    await caller.deleteAccount({ confirmText: "DELETE" });

    expect(txOrg.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } })
    );
  });

  it("does not delete org when other users remain", async () => {
    const dbMock = makeDbMock();
    dbMock.user.findUnique.mockResolvedValue({
      email: "alice@example.com",
      organisationId: "org-1",
    });

    const txUser = { update: vi.fn().mockResolvedValue({}) };
    const txOrg = {
      findUnique: vi.fn().mockResolvedValue({ users: [{ id: "user-1" }, { id: "user-2" }] }),
      delete: vi.fn().mockResolvedValue({}),
    };
    const txSession = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };

    dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ user: txUser, organisation: txOrg, session: txSession });
    });

    const caller = makeDeleteCaller(dbMock);
    await caller.deleteAccount({ confirmText: "DELETE" });

    expect(txOrg.delete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdprRouter.purgeOldChatMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("gdprRouter.purgeOldChatMessages", () => {
  it("deletes messages older than the cutoff and returns count", async () => {
    const dbMock = makeDbMock();
    dbMock.chatMessage.deleteMany.mockResolvedValue({ count: 42 });

    const caller = makeOrgCaller(dbMock);
    const result = await caller.purgeOldChatMessages({ olderThanDays: 365 });

    expect(result).toEqual({ deleted: 42 });
    expect(dbMock.chatMessage.deleteMany).toHaveBeenCalledOnce();
  });

  it("returns {deleted: 0} when no messages match", async () => {
    const dbMock = makeDbMock();
    dbMock.chatMessage.deleteMany.mockResolvedValue({ count: 0 });

    const caller = makeOrgCaller(dbMock);
    const result = await caller.purgeOldChatMessages({ olderThanDays: 30 });

    expect(result).toEqual({ deleted: 0 });
  });

  it("writes an audit log after deletion", async () => {
    const dbMock = makeDbMock();
    dbMock.chatMessage.deleteMany.mockResolvedValue({ count: 5 });

    const caller = makeOrgCaller(dbMock);
    await caller.purgeOldChatMessages({ olderThanDays: 90 });

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE", entityType: "ChatMessage" }),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gdprRouter.recordConsent
// ─────────────────────────────────────────────────────────────────────────────

describe("gdprRouter.recordConsent", () => {
  it("updates gdprConsentAt and returns {success: true}", async () => {
    const dbMock = makeDbMock();
    dbMock.user.update.mockResolvedValue({ organisationId: "org-1" });

    const caller = makeProtectedCaller(dbMock);
    const result = await caller.recordConsent();

    expect(result).toEqual({ success: true });
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ gdprConsentAt: expect.any(Date) }),
      })
    );
  });

  it("writes a GdprConsent audit log when user has an org", async () => {
    const dbMock = makeDbMock();
    dbMock.user.update.mockResolvedValue({ organisationId: "org-1" });

    const caller = makeProtectedCaller(dbMock);
    await caller.recordConsent();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE", entityType: "GdprConsent" }),
      })
    );
  });

  it("does not write audit log when user has no organisationId", async () => {
    const dbMock = makeDbMock();
    dbMock.user.update.mockResolvedValue({ organisationId: null });

    const caller = makeProtectedCaller(dbMock);
    await caller.recordConsent();

    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });
});
