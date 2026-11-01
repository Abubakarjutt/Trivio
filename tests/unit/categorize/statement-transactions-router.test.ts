import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(
  createTRPCRouter({ statementTransactions: statementTransactionsRouter })
);
let db: MockDb;
const caller = () =>
  createCaller({
    session: { user: { id: "user-1" }, expires: "2099-01-01" },
    db: db as unknown as PrismaClient,
    ip: "test",
  } as Parameters<typeof createCaller>[0]).statementTransactions;
const flagged = {
  id: "t1",
  organisationId: "org-1",
  merchantName: "IBFT",
  needsCategory: true,
  ruleKind: "COUNTERPARTY",
  ruleMatchKey: "0123456789ab",
  ruleLabel: "Transfers to ••4567",
};

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({
    id: "user-1",
    organisationId: "org-1",
    organisation: { id: "org-1" },
  });
  db.statementTransaction.findFirst.mockResolvedValue(flagged);
  db.statementTransaction.update.mockResolvedValue({
    ...flagged,
    category: "Rent",
    needsCategory: false,
  });
  db.statementTransaction.updateMany.mockResolvedValue({ count: 3 });
  db.smsImportItem.findMany.mockResolvedValue([]);
});

describe("updateCategory", () => {
  it("clears the flag without touching rules when remember is off", async () => {
    const r = await caller().updateCategory({ id: "t1", category: "Rent" });
    expect(db.statementTransaction.update.mock.calls[0]![0].data).toMatchObject({
      category: "Rent",
      needsCategory: false,
    });
    expect(db.categoryRule.upsert).not.toHaveBeenCalled();
    expect(r.alsoUpdated).toBe(0);
  });

  it("remembers the rule and fills in only other flagged rows with the same key in the org", async () => {
    const r = await caller().updateCategory({ id: "t1", category: "Rent", remember: true });
    expect(db.categoryRule.upsert.mock.calls[0]![0]).toEqual({
      where: {
        organisationId_kind_matchKey: {
          organisationId: "org-1",
          kind: "COUNTERPARTY",
          matchKey: "0123456789ab",
        },
      },
      create: {
        organisationId: "org-1",
        kind: "COUNTERPARTY",
        matchKey: "0123456789ab",
        label: "Transfers to ••4567",
        category: "Rent",
      },
      update: { category: "Rent", label: "Transfers to ••4567" },
    });
    expect(db.statementTransaction.updateMany.mock.calls[0]![0]).toEqual({
      where: {
        organisationId: "org-1",
        ruleKind: "COUNTERPARTY",
        ruleMatchKey: "0123456789ab",
        needsCategory: true,
        id: { not: "t1" },
      },
      data: { category: "Rent", mccLabel: "Rent", needsCategory: false },
    });
    expect(r.alsoUpdated).toBe(3);
  });

  it("also fills in this org's SMS still waiting in review for the same key", async () => {
    const key = { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" };
    const waiting = { date: "2026-10-30", description: "Raast", merchantName: "Raast", amount: 5000, type: "DEBIT",
      category: "Transfers", mccCode: "0000", mccLabel: "Transfers", possibleDuplicate: false, ruleKey: key, needsCategory: true };
    db.smsImportItem.findMany.mockResolvedValue([
      { id: "s1", parsedJson: [waiting] },
      { id: "s2", parsedJson: [{ ...waiting, needsCategory: false, category: "Gifts" }] },
      { id: "s3", parsedJson: [{ ...waiting, ruleKey: { ...key, matchKey: "other" } }] },
    ]);
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    const r = await caller().updateCategory({ id: "t1", category: "Rent", remember: true });
    expect(db.smsImportItem.findMany.mock.calls[0]![0].where).toEqual({ organisationId: "org-1", status: "PENDING_REVIEW" });
    expect(db.smsImportItem.updateMany).toHaveBeenCalledTimes(1);
    expect(db.smsImportItem.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "s1", organisationId: "org-1", status: "PENDING_REVIEW" },
      data: { parsedJson: [{ ...waiting, category: "Rent", mccLabel: "Rent", needsCategory: false, ruleApplied: true }] },
    });
    expect(r.alsoUpdated).toBe(4); // 3 saved rows + 1 SMS
  });

  it("ignores remember for a row with no rule key", async () => {
    db.statementTransaction.findFirst.mockResolvedValue({
      ...flagged,
      ruleKind: null,
      ruleMatchKey: null,
    });
    await caller().updateCategory({ id: "t1", category: "Rent", remember: true });
    expect(db.categoryRule.upsert).not.toHaveBeenCalled();
  });

  it("is org-scoped", async () => {
    db.statementTransaction.findFirst.mockResolvedValue(null);
    await expect(
      caller().updateCategory({ id: "x", category: "Rent", remember: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.statementTransaction.findFirst.mock.calls[0]![0].where).toEqual({
      id: "x",
      organisationId: "org-1",
    });
  });
});

describe("needs-category", () => {
  it("counts this org's flagged, non-excluded rows", async () => {
    db.statementTransaction.count.mockResolvedValue(12);
    expect(await caller().needsCategoryCount()).toBe(12);
    expect(db.statementTransaction.count.mock.calls[0]![0].where).toEqual({
      organisationId: "org-1",
      needsCategory: true,
      isExcluded: false,
    });
  });

  it("filters the list", async () => {
    db.statementTransaction.findMany.mockResolvedValue([]);
    await caller().list({ needsCategory: true });
    expect(db.statementTransaction.findMany.mock.calls[0]![0].where).toMatchObject({
      organisationId: "org-1",
      needsCategory: true,
    });
  });
});
