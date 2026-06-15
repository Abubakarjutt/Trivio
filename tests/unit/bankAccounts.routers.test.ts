/**
 * bankAccounts router unit tests
 *
 * Tests the bankAccountsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// vi.mock is hoisted — must use literals in the factory
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

vi.mock("@/server/services/reconciliation.service", () => ({
  autoMatchBankAccount: vi.fn().mockResolvedValue(3),
}));

vi.mock("@/server/services/accounting.service", () => ({
  createJournalEntry: vi.fn().mockResolvedValue({
    id: "je-1",
    lines: [
      { id: "jl-bank", accountId: "chart-1" },
      { id: "jl-contra", accountId: "chart-contra" },
    ],
  }),
}));

import { createCallerFactory } from "@/server/trpc";
import { bankAccountsRouter } from "@/server/routers/bankAccounts";
import { autoMatchBankAccount } from "@/server/services/reconciliation.service";
import { createJournalEntry } from "@/server/services/accounting.service";

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

const createCaller = createCallerFactory(bankAccountsRouter);

const baseChartAccount = {
  id: "chart-1",
  code: "1000",
  name: "Main Checking",
  type: "ASSET",
  normalBalance: "DEBIT",
  isArchived: false,
};

const baseBankAccount = {
  id: "ba-1",
  organisationId: ORG,
  name: "Main Checking Account",
  accountId: "chart-1",
  currentBalance: "0.0000",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  chartAccount: { id: "chart-1", code: "1000", name: "Main Checking" },
  _count: { statementLines: 5 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("bankAccounts.list", () => {
  it("returns an empty array when no bank accounts exist", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bankAccount: { findMany } }));
    const result = await caller.list();
    expect(result).toEqual([]);
  });

  it("returns bank accounts with chartAccount and unmatched count", async () => {
    const accounts = [baseBankAccount];
    const findMany = vi.fn().mockResolvedValue(accounts);
    const caller = createCaller(makeCtx({ bankAccount: { findMany } }));
    const result = await caller.list();
    expect(result).toHaveLength(1);
    expect(result[0].chartAccount).toEqual({ id: "chart-1", code: "1000", name: "Main Checking" });
    expect(result[0]._count.statementLines).toBe(5);
  });

  it("queries with the correct organisationId filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bankAccount: { findMany } }));
    await caller.list();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: ORG } })
    );
  });

  it("orders results by createdAt ascending", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bankAccount: { findMany } }));
    await caller.list();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } })
    );
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("bankAccounts.create", () => {
  it("throws BAD_REQUEST when chart account is not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ chartAccount: { findFirst } }));
    await expect(
      caller.create({ name: "My Account", chartAccountId: "nonexistent" })
    ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("throws BAD_REQUEST when chart account is not ASSET type", async () => {
    // findFirst returns null because the query includes type: "ASSET" filter
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(
      makeCtx({ chartAccount: { findFirst } })
    );
    await expect(
      caller.create({ name: "My Account", chartAccountId: "chart-expense" })
    ).rejects.toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: expect.stringContaining("not an ASSET account"),
      })
    );
  });

  it("creates bank account successfully and returns it with chartAccount", async () => {
    const createdAccount = {
      ...baseBankAccount,
      chartAccount: baseChartAccount,
    };
    const findFirst = vi.fn().mockResolvedValue(baseChartAccount);
    const create = vi.fn().mockResolvedValue(createdAccount);
    const caller = createCaller(
      makeCtx({ chartAccount: { findFirst }, bankAccount: { create } })
    );
    const result = await caller.create({ name: "Main Checking Account", chartAccountId: "chart-1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: ORG,
          name: "Main Checking Account",
          accountId: "chart-1",
        }),
      })
    );
    expect(result.chartAccount).toBeDefined();
  });

  it("verifies chart account belongs to the correct org", async () => {
    const findFirst = vi.fn().mockResolvedValue(baseChartAccount);
    const create = vi.fn().mockResolvedValue({ ...baseBankAccount, chartAccount: baseChartAccount });
    const caller = createCaller(
      makeCtx({ chartAccount: { findFirst }, bankAccount: { create } })
    );
    await caller.create({ name: "Test Account", chartAccountId: "chart-1" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: ORG,
          type: "ASSET",
        }),
      })
    );
  });

  it("returns the newly created bank account", async () => {
    const createdAccount = { ...baseBankAccount, name: "New Bank" };
    const findFirst = vi.fn().mockResolvedValue(baseChartAccount);
    const create = vi.fn().mockResolvedValue(createdAccount);
    const caller = createCaller(
      makeCtx({ chartAccount: { findFirst }, bankAccount: { create } })
    );
    const result = await caller.create({ name: "New Bank", chartAccountId: "chart-1" });
    expect(result.name).toBe("New Bank");
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("bankAccounts.getById", () => {
  it("throws NOT_FOUND when the account does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    await expect(caller.getById({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("returns account with statementLines when found", async () => {
    const accountWithLines = {
      ...baseBankAccount,
      chartAccount: { ...baseChartAccount },
      statementLines: [
        { id: "sl-1", date: new Date(), description: "Payment", amount: "100.0000", status: "UNMATCHED", journalLine: null },
      ],
    };
    const findFirst = vi.fn().mockResolvedValue(accountWithLines);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    const result = await caller.getById({ id: "ba-1" });
    expect(result.id).toBe("ba-1");
    expect(result.statementLines).toHaveLength(1);
    expect(result.chartAccount).toBeDefined();
  });

  it("queries with correct organisationId scope", async () => {
    const accountWithLines = { ...baseBankAccount, chartAccount: baseChartAccount, statementLines: [] };
    const findFirst = vi.fn().mockResolvedValue(accountWithLines);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    await caller.getById({ id: "ba-1" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "ba-1", organisationId: ORG }),
      })
    );
  });
});

// ─── importStatementLines ─────────────────────────────────────────────────────

describe("bankAccounts.importStatementLines", () => {
  it("throws NOT_FOUND when bank account does not belong to org", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    await expect(
      caller.importStatementLines({ bankAccountId: "ba-other", lines: [] })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("creates statement lines and returns count", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ba-1" });
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const caller = createCaller(
      makeCtx({ bankAccount: { findFirst }, bankStatementLine: { createMany } })
    );
    const result = await caller.importStatementLines({
      bankAccountId: "ba-1",
      lines: [
        { date: new Date("2026-01-01"), description: "Transfer", amount: "500.00" },
        { date: new Date("2026-01-02"), description: "Refund", amount: "-50.00" },
        { date: new Date("2026-01-03"), description: "Fee", amount: "-10.00" },
      ],
    });
    expect(result.count).toBe(3);
  });

  it("marks all imported lines as UNMATCHED", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ba-1" });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const caller = createCaller(
      makeCtx({ bankAccount: { findFirst }, bankStatementLine: { createMany } })
    );
    await caller.importStatementLines({
      bankAccountId: "ba-1",
      lines: [{ date: new Date(), description: "Test", amount: "100.00" }],
    });
    const callData = createMany.mock.calls[0][0].data;
    expect(callData[0].status).toBe("UNMATCHED");
  });
});

// ─── getStatementLines ────────────────────────────────────────────────────────

describe("bankAccounts.getStatementLines", () => {
  it("throws NOT_FOUND when bank account not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    await expect(
      caller.getStatementLines({ bankAccountId: "ba-missing", page: 1 })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("returns paginated lines with total and pages", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ba-1" });
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([
      { id: "sl-1", amount: "100.0000", status: "UNMATCHED", journalLine: null },
      { id: "sl-2", amount: "200.0000", status: "UNMATCHED", journalLine: null },
    ]);
    const caller = createCaller(
      makeCtx({ bankAccount: { findFirst }, bankStatementLine: { count, findMany } })
    );
    const result = await caller.getStatementLines({ bankAccountId: "ba-1", page: 1 });
    expect(result.lines).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.pages).toBe(1);
  });

  it("filters by status when provided", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ba-1" });
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(
      makeCtx({ bankAccount: { findFirst }, bankStatementLine: { count, findMany } })
    );
    await caller.getStatementLines({ bankAccountId: "ba-1", status: "MATCHED", page: 1 });
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "MATCHED" }) })
    );
  });
});

// ─── autoMatch ────────────────────────────────────────────────────────────────

describe("bankAccounts.autoMatch", () => {
  it("throws NOT_FOUND when bank account not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    await expect(caller.autoMatch({ bankAccountId: "ba-missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("calls autoMatchBankAccount service and returns matched count", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ba-1" });
    const caller = createCaller(makeCtx({ bankAccount: { findFirst } }));
    vi.mocked(autoMatchBankAccount).mockResolvedValue(5);
    const result = await caller.autoMatch({ bankAccountId: "ba-1" });
    expect(autoMatchBankAccount).toHaveBeenCalledWith(expect.anything(), "ba-1", ORG);
    expect(result.matched).toBe(5);
  });
});

// ─── matchLine ────────────────────────────────────────────────────────────────

describe("bankAccounts.matchLine", () => {
  it("throws NOT_FOUND when statement line not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(
      caller.matchLine({ bankStatementLineId: "sl-missing", journalLineId: "jl-1" })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("throws BAD_REQUEST when line is already matched", async () => {
    const statementLine = { id: "sl-1", status: "MATCHED" };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(
      caller.matchLine({ bankStatementLineId: "sl-1", journalLineId: "jl-1" })
    ).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", message: expect.stringContaining("already matched") })
    );
  });

  it("matches statement line to journal line successfully", async () => {
    const statementLine = { id: "sl-1", status: "UNMATCHED" };
    const journalLine = { id: "jl-1" };
    const updated = { id: "sl-1", status: "MATCHED", journalLineId: "jl-1" };
    const slFindFirst = vi.fn().mockResolvedValue(statementLine);
    const jlFindFirst = vi.fn().mockResolvedValue(journalLine);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(
      makeCtx({
        bankStatementLine: { findFirst: slFindFirst, update },
        journalLine: { findFirst: jlFindFirst },
      })
    );
    const result = await caller.matchLine({ bankStatementLineId: "sl-1", journalLineId: "jl-1" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sl-1" },
        data: { status: "MATCHED", journalLineId: "jl-1" },
      })
    );
    expect(result.status).toBe("MATCHED");
  });

  it("throws NOT_FOUND when journal line not found", async () => {
    const statementLine = { id: "sl-1", status: "UNMATCHED" };
    const slFindFirst = vi.fn().mockResolvedValue(statementLine);
    const jlFindFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(
      makeCtx({
        bankStatementLine: { findFirst: slFindFirst },
        journalLine: { findFirst: jlFindFirst },
      })
    );
    await expect(
      caller.matchLine({ bankStatementLineId: "sl-1", journalLineId: "jl-missing" })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

// ─── unmatchLine ──────────────────────────────────────────────────────────────

describe("bankAccounts.unmatchLine", () => {
  it("throws NOT_FOUND when statement line not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(caller.unmatchLine({ bankStatementLineId: "sl-missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when line is not matched", async () => {
    const statementLine = { id: "sl-1", status: "UNMATCHED" };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(caller.unmatchLine({ bankStatementLineId: "sl-1" })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", message: expect.stringContaining("not matched") })
    );
  });

  it("unmatches a matched line successfully", async () => {
    const statementLine = { id: "sl-1", status: "MATCHED", journalLineId: "jl-1" };
    const updated = { id: "sl-1", status: "UNMATCHED", journalLineId: null };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst, update } }));
    const result = await caller.unmatchLine({ bankStatementLineId: "sl-1" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "UNMATCHED", journalLineId: null },
      })
    );
    expect(result.status).toBe("UNMATCHED");
  });
});

// ─── excludeLine ──────────────────────────────────────────────────────────────

describe("bankAccounts.excludeLine", () => {
  it("throws NOT_FOUND when line not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(caller.excludeLine({ bankStatementLineId: "sl-missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("sets line status to EXCLUDED", async () => {
    const statementLine = { id: "sl-1", status: "UNMATCHED" };
    const updated = { id: "sl-1", status: "EXCLUDED", journalLineId: null };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst, update } }));
    const result = await caller.excludeLine({ bankStatementLineId: "sl-1" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXCLUDED", journalLineId: null } })
    );
    expect(result.status).toBe("EXCLUDED");
  });
});

// ─── restoreLine ──────────────────────────────────────────────────────────────

describe("bankAccounts.restoreLine", () => {
  it("throws NOT_FOUND when line not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(caller.restoreLine({ bankStatementLineId: "sl-missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("restores an excluded line back to UNMATCHED", async () => {
    const statementLine = { id: "sl-1", status: "EXCLUDED" };
    const updated = { id: "sl-1", status: "UNMATCHED", journalLineId: null };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst, update } }));
    const result = await caller.restoreLine({ bankStatementLineId: "sl-1" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "UNMATCHED", journalLineId: null } })
    );
    expect(result.status).toBe("UNMATCHED");
  });
});

// ─── createJournalForLine ─────────────────────────────────────────────────────

describe("bankAccounts.createJournalForLine", () => {
  it("throws NOT_FOUND when statement line not found or not UNMATCHED", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bankStatementLine: { findFirst } }));
    await expect(
      caller.createJournalForLine({
        bankStatementLineId: "sl-missing",
        accountId: "chart-expense",
        description: "Office supplies",
      })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("calls createJournalEntry and links the journal line for a positive amount", async () => {
    const statementLine = {
      id: "sl-1",
      status: "UNMATCHED",
      date: new Date("2026-01-01"),
      amount: { toString: () => "100", valueOf: () => 100 },
      bankAccount: { accountId: "chart-1" },
    };
    const findFirst = vi.fn().mockResolvedValue(statementLine);
    const update = vi.fn().mockResolvedValue({ id: "sl-1", status: "CREATED", journalLineId: "jl-bank" });
    const caller = createCaller(
      makeCtx({ bankStatementLine: { findFirst, update } })
    );

    vi.mocked(createJournalEntry).mockResolvedValue({
      id: "je-1",
      lines: [
        { id: "jl-bank", accountId: "chart-1" },
        { id: "jl-contra", accountId: "chart-expense" },
      ],
    } as never);

    const result = await caller.createJournalForLine({
      bankStatementLineId: "sl-1",
      accountId: "chart-expense",
      description: "Consulting income",
    });

    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        description: "Consulting income",
        source: "BANK_IMPORT",
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "CREATED", journalLineId: "jl-bank" },
      })
    );
    expect(result.id).toBe("je-1");
  });
});
