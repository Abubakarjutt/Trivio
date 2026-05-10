import { describe, it, expect, vi } from "vitest";
import { autoMatchBankAccount } from "@/server/services/reconciliation.service";
import { Prisma } from "@prisma/client";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    bankAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    bankStatementLine: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    journalLine: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("autoMatchBankAccount", () => {
  it("returns 0 when bank account not found", async () => {
    const prisma = makePrisma({ bankAccount: { findFirst: vi.fn().mockResolvedValue(null) } });
    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(0);
  });

  it("returns 0 when no unmatched statement lines", async () => {
    const prisma = makePrisma({
      bankAccount: { findFirst: vi.fn().mockResolvedValue({ id: "ba-1", accountId: "chart-1" }) },
      bankStatementLine: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    });
    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(0);
  });

  it("matches a statement line to an exact journal line (positive amount = credit)", async () => {
    const statementDate = new Date("2026-01-15");
    const journalDate = new Date("2026-01-15");

    const prisma = makePrisma({
      bankAccount: { findFirst: vi.fn().mockResolvedValue({ id: "ba-1", accountId: "chart-1" }) },
      bankStatementLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sl-1", date: statementDate, amount: new Prisma.Decimal(500), status: "UNMATCHED" },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "jl-1",
            debit: null,
            credit: new Prisma.Decimal(500),
            journalEntry: { date: journalDate, organisationId: "org-1" },
            bankStatementLines: [],
          },
        ]),
      },
    });

    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(1);
    expect(prisma.bankStatementLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sl-1" },
        data: expect.objectContaining({ status: "MATCHED", journalLineId: "jl-1" }),
      })
    );
  });

  it("does not match when amount differs", async () => {
    // The service passes `credit: absAmount` to Prisma WHERE — so the DB returns
    // no candidates when the journal line's credit (499) ≠ statement amount (500).
    // We simulate that by having findMany return [] for the journalLine query.
    const prisma = makePrisma({
      bankAccount: { findFirst: vi.fn().mockResolvedValue({ id: "ba-1", accountId: "chart-1" }) },
      bankStatementLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sl-1", date: new Date("2026-01-15"), amount: new Prisma.Decimal(500), status: "UNMATCHED" },
        ]),
        update: vi.fn(),
      },
      journalLine: {
        // DB returns nothing because credit=499 ≠ 500 (filtered in WHERE clause)
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(0);
    expect(prisma.bankStatementLine.update).not.toHaveBeenCalled();
  });

  it("does not auto-match when multiple candidates found (ambiguous)", async () => {
    const prisma = makePrisma({
      bankAccount: { findFirst: vi.fn().mockResolvedValue({ id: "ba-1", accountId: "chart-1" }) },
      bankStatementLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sl-1", date: new Date("2026-01-15"), amount: new Prisma.Decimal(500), status: "UNMATCHED" },
        ]),
        update: vi.fn(),
      },
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: "jl-1", debit: null, credit: new Prisma.Decimal(500), journalEntry: { date: new Date("2026-01-15"), organisationId: "org-1" }, bankStatementLines: [] },
          { id: "jl-2", debit: null, credit: new Prisma.Decimal(500), journalEntry: { date: new Date("2026-01-16"), organisationId: "org-1" }, bankStatementLines: [] },
        ]),
      },
    });

    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(0); // Ambiguous — should not match
    expect(prisma.bankStatementLine.update).not.toHaveBeenCalled();
  });

  it("handles negative amounts (debit side)", async () => {
    const prisma = makePrisma({
      bankAccount: { findFirst: vi.fn().mockResolvedValue({ id: "ba-1", accountId: "chart-1" }) },
      bankStatementLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sl-1", date: new Date("2026-01-10"), amount: new Prisma.Decimal(-300), status: "UNMATCHED" },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "jl-1",
            debit: new Prisma.Decimal(300),
            credit: null,
            journalEntry: { date: new Date("2026-01-10"), organisationId: "org-1" },
            bankStatementLines: [],
          },
        ]),
      },
    });

    const count = await autoMatchBankAccount(prisma, "ba-1", "org-1");
    expect(count).toBe(1);
  });
});
