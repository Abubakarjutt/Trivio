import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);
const mdb = vi.hoisted(() => ({ checkChatDbAccess: vi.fn(), readMessages: vi.fn() }));
vi.mock("@/server/services/sms/messages-db", async (orig) => ({
  ...(await orig<typeof import("@/server/services/sms/messages-db")>()),
  ...mdb,
}));
const svc = vi.hoisted(() => ({ processSms: vi.fn() }));
vi.mock("@/server/services/sms/sms-import.service", async (orig) => ({
  ...(await orig<typeof import("@/server/services/sms/sms-import.service")>()),
  ...svc,
}));

vi.mock("@/server/services/categorize/category-rules.service", () => ({
  createImportCategorizer: vi.fn(async () => ({ tokenize: (t: string) => t, categorize: vi.fn() })),
}));

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { smsImportRouter } from "@/server/routers/smsImport";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ smsImport: smsImportRouter }));
let db: MockDb;
const caller = () =>
  createCaller({
    session: { user: { id: "user-1" }, expires: "2099-01-01" },
    db: db as unknown as PrismaClient,
    ip: "test",
  } as Parameters<typeof createCaller>[0]).smsImport;

const txn = { date: "2026-10-30", description: "KFC", merchantName: "KFC", amount: 1450, type: "DEBIT" as const,
  category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food", possibleDuplicate: false };

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({ id: "user-1", organisationId: "org-1", organisation: { id: "org-1" } });
  mdb.checkChatDbAccess.mockReset();
  svc.processSms.mockReset();
});

describe("smsImport.approve", () => {
  const pendingOk = (n: number) => db.smsImportItem.count.mockResolvedValue(n);

  it("creates one SMS batch with every claimed row and marks items APPROVED", async () => {
    pendingOk(2);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 2 });
    db.smsImportItem.findMany.mockResolvedValue([
      { parsedJson: [txn] },
      { parsedJson: [{ ...txn, merchantName: "Daraz", amount: 900, type: "CREDIT" }] },
    ]);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });

    expect(await caller().approve({ ids: ["i1", "i2", "other-org"] })).toEqual({ approved: 2, transactions: 2, rulesSaved: 0, alsoAppliedTo: 0, alsoAppliedToSaved: 0 });

    expect(db.smsImportItem.count.mock.calls[0]![0].where).toEqual({
      id: { in: ["i1", "i2", "other-org"] }, organisationId: "org-1", status: "PENDING_REVIEW",
    });
    expect(db.statementImportBatch.create.mock.calls[0]![0].data).toMatchObject({
      organisationId: "org-1", fileType: "SMS", status: "DONE",
    });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: ["i1", "i2", "other-org"] }, organisationId: "org-1", status: "PENDING_REVIEW" },
      data: { status: "APPROVED", importBatchId: "b1" },
    });
    expect(db.smsImportItem.findMany.mock.calls[0]![0].where).toEqual({ importBatchId: "b1", organisationId: "org-1" });
    const rows = db.statementTransaction.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ organisationId: "org-1", importBatchId: "b1", merchantName: "Daraz", amount: 900, type: "CREDIT" });
    expect(rows[0]).not.toHaveProperty("possibleDuplicate");
    expect(db.statementImportBatch.update.mock.calls[0]![0]).toEqual({ where: { id: "b1" }, data: { transactionCount: 2 } });
  });

  it("saves the parsedJson read after the claim, not an earlier one", async () => {
    pendingOk(1);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    db.smsImportItem.findMany.mockResolvedValue([{ parsedJson: [{ ...txn, merchantName: "Edited", amount: 1 }] }]);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });
    await caller().approve({ ids: ["i1"] });
    expect(db.smsImportItem.findMany).toHaveBeenCalledTimes(1);
    expect(db.smsImportItem.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(db.smsImportItem.findMany.mock.invocationCallOrder[0]!);
    expect(db.statementTransaction.createMany.mock.calls[0]![0].data[0]).toMatchObject({ merchantName: "Edited", amount: 1 });
  });

  it("does nothing when no pending items match", async () => {
    pendingOk(0);
    expect(await caller().approve({ ids: ["x"] })).toEqual({ approved: 0, transactions: 0, rulesSaved: 0, alsoAppliedTo: 0, alsoAppliedToSaved: 0 });
    expect(db.statementImportBatch.create).not.toHaveBeenCalled();
  });

  it("aborts with CONFLICT when another approval claimed the items first", async () => {
    pendingOk(1);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    const err = await caller().approve({ ids: ["i1"] }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("CONFLICT");
    expect(db.statementTransaction.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a null amount", { ...txn, amount: null }],
    ["an amount of 1e15", { ...txn, amount: 1e15 }],
    ["an impossible date", { ...txn, date: "2026-02-30" }],
  ])("rejects a stored item with %s and saves nothing", async (_label, bad) => {
    pendingOk(2);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 2 });
    db.smsImportItem.findMany.mockResolvedValue([{ parsedJson: [txn] }, { parsedJson: [bad] }]);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });
    const err = await caller().approve({ ids: ["i1", "i2"] }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("One of the selected SMS has an invalid amount or date. Fix or dismiss it, then try again.");
    expect(db.statementTransaction.createMany).not.toHaveBeenCalled();
  });

  it("leaves the items PENDING_REVIEW when validation fails (the claim rolls back)", async () => {
    // Real Prisma rolls back the interactive transaction on throw; model that by
    // only committing the claim when the callback resolves.
    const status = new Map([["i1", "PENDING_REVIEW"]]);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged = new Map(status);
      const smsImportItem = {
        count: vi.fn(async () => [...staged.values()].filter((s) => s === "PENDING_REVIEW").length),
        updateMany: vi.fn(async () => { staged.set("i1", "APPROVED"); return { count: 1 }; }),
        findMany: vi.fn(async () => [{ parsedJson: [{ ...txn, amount: null }] }]),
      };
      const tx = new Proxy(db, { get: (t, k) => (k === "smsImportItem" ? smsImportItem : Reflect.get(t, k)) });
      const out = await fn(tx);
      for (const [k, v] of staged) status.set(k, v);
      return out;
    });
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });
    const err = await caller().approve({ ids: ["i1"] }).catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(status.get("i1")).toBe("PENDING_REVIEW");
  });

  it("clears sample data before saving real transactions", async () => {
    pendingOk(1);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    db.smsImportItem.findMany.mockResolvedValue([{ parsedJson: [txn] }]);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: true });
    await caller().approve({ ids: ["i1"] });
    expect(db.statementTransaction.deleteMany.mock.calls[0]![0]).toEqual({ where: { organisationId: "org-1", isSampleData: true } });
    expect(db.organisation.update.mock.calls[0]![0]).toEqual({ where: { id: "org-1" }, data: { hasSampleData: false } });
  });
});

describe("smsImport.approve rules", () => {
  const cp = { kind: "COUNTERPARTY" as const, matchKey: "0123456789ab", label: "Transfers to ••4567" };
  const setup = (parsedJson: unknown[], others: unknown[] = []) => {
    db.smsImportItem.count.mockResolvedValue(1);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    db.smsImportItem.findMany.mockResolvedValueOnce([{ parsedJson }]).mockResolvedValueOnce(others);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });
    db.statementTransaction.updateMany.mockResolvedValue({ count: 0 });
  };

  it("saves a rule for an answered, remembered row and stores the flags on the transaction", async () => {
    setup([{ ...txn, category: "Rent", ruleKey: cp, needsCategory: false, userCategorized: true, rememberRule: true }]);
    const r = await caller().approve({ ids: ["i1"] });
    expect(r).toMatchObject({ rulesSaved: 1 });
    expect(db.categoryRule.upsert).toHaveBeenCalledWith({
      where: { organisationId_kind_matchKey: { organisationId: "org-1", kind: "COUNTERPARTY", matchKey: "0123456789ab" } },
      create: { organisationId: "org-1", kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567", category: "Rent" },
      update: { category: "Rent", label: "Transfers to ••4567" },
    });
    expect(db.statementTransaction.createMany.mock.calls[0]![0].data[0]).toMatchObject({
      needsCategory: false, ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", ruleLabel: "Transfers to ••4567",
    });
  });

  it("saves no rule when unticked, unanswered, or without a key", async () => {
    setup([
      { ...txn, ruleKey: cp, userCategorized: true, rememberRule: false },
      { ...txn, ruleKey: cp, needsCategory: true },
      { ...txn, ruleKey: null, userCategorized: true },
    ]);
    expect(await caller().approve({ ids: ["i1"] })).toMatchObject({ rulesSaved: 0, alsoAppliedTo: 0, alsoAppliedToSaved: 0 });
    expect(db.categoryRule.upsert).not.toHaveBeenCalled();
  });

  it("last answer wins when two rows answer the same key", async () => {
    setup([
      { ...txn, category: "Rent", ruleKey: cp, userCategorized: true },
      { ...txn, category: "Loans", ruleKey: cp, userCategorized: true },
    ]);
    expect(await caller().approve({ ids: ["i1"] })).toMatchObject({ rulesSaved: 1 });
    expect(db.categoryRule.upsert).toHaveBeenCalledTimes(1);
    expect(db.categoryRule.upsert.mock.calls[0]![0].update.category).toBe("Loans");
  });

  it("fills in other pending SMS that still need a category, and only those", async () => {
    setup([{ ...txn, category: "Rent", ruleKey: cp, userCategorized: true }], [
      { id: "p2", parsedJson: [{ ...txn, ruleKey: cp, needsCategory: true, category: "Transfers" }] },
      { id: "p3", parsedJson: [{ ...txn, ruleKey: cp, needsCategory: false, category: "Gifts" }] },
    ]);
    expect(await caller().approve({ ids: ["i1"] })).toMatchObject({ alsoAppliedTo: 1 });
    expect(db.smsImportItem.findMany.mock.calls[1]![0].where).toEqual({ organisationId: "org-1", status: "PENDING_REVIEW" });
    // calls[0] is the claim; one more for p2 only.
    expect(db.smsImportItem.updateMany).toHaveBeenCalledTimes(2);
    expect(db.smsImportItem.updateMany.mock.calls[1]![0]).toMatchObject({
      where: { id: "p2", organisationId: "org-1", status: "PENDING_REVIEW" },
      data: { parsedJson: [expect.objectContaining({ category: "Rent", needsCategory: false, ruleApplied: true })] },
    });
  });

  it("applies an answer to an unanswered sibling in the same approval before saving", async () => {
    setup([
      { ...txn, category: "Rent", ruleKey: cp, needsCategory: false, userCategorized: true, rememberRule: true },
      { ...txn, category: "Transfers", mccLabel: "Transfers", ruleKey: cp, needsCategory: true },
    ]);
    await caller().approve({ ids: ["i1", "i2"] });
    const saved = db.statementTransaction.createMany.mock.calls[0]![0].data;
    expect(saved).toHaveLength(2);
    for (const row of saved) expect(row).toMatchObject({ category: "Rent", needsCategory: false });
    expect(saved[1]).toMatchObject({ mccLabel: "Rent" });
  });

  it("does not apply an un-remembered answer to a sibling", async () => {
    setup([
      { ...txn, category: "Rent", ruleKey: cp, userCategorized: true, rememberRule: false },
      { ...txn, category: "Transfers", ruleKey: cp, needsCategory: true },
    ]);
    await caller().approve({ ids: ["i1"] });
    expect(db.statementTransaction.createMany.mock.calls[0]![0].data[1]).toMatchObject({ category: "Transfers", needsCategory: true });
  });

  it("fills in this org's saved transactions still flagged for the same key", async () => {
    setup([{ ...txn, category: "Rent", ruleKey: cp, userCategorized: true }]);
    db.statementTransaction.updateMany.mockResolvedValue({ count: 4 });
    expect(await caller().approve({ ids: ["i1"] })).toMatchObject({ alsoAppliedToSaved: 4 });
    expect(db.statementTransaction.updateMany).toHaveBeenCalledWith({
      where: { organisationId: "org-1", ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", needsCategory: true },
      data: { category: "Rent", mccLabel: "Rent", needsCategory: false },
    });
    expect(db.statementTransaction.updateMany.mock.invocationCallOrder[0]!).toBeGreaterThan(
      db.statementTransaction.createMany.mock.invocationCallOrder[0]!
    );
  });
});

describe("smsImport.updateItem", () => {
  beforeEach(() => {
    db.smsImportItem.findFirst.mockResolvedValue({ parsedJson: [txn] });
  });

  it("returns NOT_FOUND when the item is missing", async () => {
    db.smsImportItem.findFirst.mockResolvedValue(null);
    const err = await caller().updateItem({ id: "i1", parsed: [txn] }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(db.smsImportItem.updateMany).not.toHaveBeenCalled();
  });

  it("only edits pending items of this org", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    const err = await caller().updateItem({ id: "i1", parsed: [txn] }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(db.smsImportItem.updateMany.mock.calls[0]![0].where).toEqual({ id: "i1", organisationId: "org-1", status: "PENDING_REVIEW" });
  });

  it.each(["30/10/2026", "2026-02-30", "2026-13-01"])("rejects the date %s", async (date) => {
    const err = await caller().updateItem({ id: "i1", parsed: [{ ...txn, date }] }).catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(db.smsImportItem.updateMany).not.toHaveBeenCalled();
  });

  it.each([1e15, -1, NaN])("rejects the amount %s", async (amount) => {
    const err = await caller().updateItem({ id: "i1", parsed: [{ ...txn, amount }] }).catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(db.smsImportItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("smsImport.updateItem merge", () => {
  it("keeps server-owned fields (ruleKey, ruleApplied) from the stored rows", async () => {
    const stored = { ...txn, ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" }, ruleApplied: false, needsCategory: true };
    db.smsImportItem.findFirst.mockResolvedValue({ parsedJson: [stored] });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    await caller().updateItem({ id: "i1", parsed: [{ ...txn, category: "Rent", ruleKey: { kind: "MERCHANT", matchKey: "evil", label: "x" }, ruleApplied: true, needsCategory: false, userCategorized: true, rememberRule: true }] });
    const saved = db.smsImportItem.updateMany.mock.calls[0]![0];
    expect(saved.where).toEqual({ id: "i1", organisationId: "org-1", status: "PENDING_REVIEW" });
    expect(saved.data.parsedJson[0]).toMatchObject({ category: "Rent", ruleKey: stored.ruleKey, ruleApplied: false, needsCategory: false, userCategorized: true });
  });

  it("rejects a different number of rows", async () => {
    db.smsImportItem.findFirst.mockResolvedValue({ parsedJson: [txn, txn] });
    await expect(caller().updateItem({ id: "i1", parsed: [txn] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("smsImport.checkAccess", () => {
  it("re-activates the source when access is ok", async () => {
    mdb.checkChatDbAccess.mockResolvedValue("ok");
    expect(await caller().checkAccess()).toBe("ok");
    expect(db.smsSource.updateMany.mock.calls[0]![0]).toEqual({ where: { organisationId: "org-1" }, data: { status: "ACTIVE", lastError: null } });
  });
  it("leaves the source alone otherwise", async () => {
    mdb.checkChatDbAccess.mockResolvedValue("no_access");
    expect(await caller().checkAccess()).toBe("no_access");
    expect(db.smsSource.updateMany).not.toHaveBeenCalled();
  });
});

describe("smsImport.getSource", () => {
  it("never returns the BigInt cursor", async () => {
    db.smsSource.findUnique.mockResolvedValue({ id: "s", enabled: true, senderIds: ["HBL"], status: "ACTIVE", lastError: null, lastSyncedAt: null, lastRowId: 99n });
    db.smsImportItem.count.mockResolvedValue(3);
    const r = await caller().getSource();
    expect(r.source).not.toHaveProperty("lastRowId");
    expect(r.approvedCount).toBe(3);
  });
});

describe("smsImport.retry", () => {
  it("re-parses a skipped item and stores the new result", async () => {
    db.smsImportItem.findFirst.mockResolvedValue({ id: "i1", text: "PKR 1,450 at KFC", receivedAt: new Date("2026-10-30T10:00:00Z") });
    db.statementTransaction.findMany.mockResolvedValue([]);
    svc.processSms.mockResolvedValue({ status: "PENDING_REVIEW", redactedText: "PKR 1,450 at KFC", parsed: [txn] });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    expect(await caller().retry({ id: "i1" })).toEqual({ status: "PENDING_REVIEW" });
    expect(svc.processSms.mock.calls[0]![3]).toEqual(expect.objectContaining({ tokenize: expect.any(Function) }));
    expect(db.smsImportItem.findFirst.mock.calls[0]![0].where).toEqual({ id: "i1", organisationId: "org-1", status: { in: ["FAILED", "NO_TRANSACTION"] } });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "i1", organisationId: "org-1", status: { in: ["FAILED", "NO_TRANSACTION"] } },
      data: { status: "PENDING_REVIEW", parsedJson: [txn], errorMessage: null },
    });
  });

  it("returns NOT_FOUND when the item changed status while re-parsing", async () => {
    db.smsImportItem.findFirst.mockResolvedValue({ id: "i1", text: "PKR 1,450 at KFC", receivedAt: new Date("2026-10-30T10:00:00Z") });
    db.statementTransaction.findMany.mockResolvedValue([]);
    svc.processSms.mockResolvedValue({ status: "PENDING_REVIEW", redactedText: "x", parsed: [txn] });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    const err = await caller().retry({ id: "i1" }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("smsImport.suggestSenders", () => {
  it.runIf(process.platform === "darwin")("scans the newest messages first", async () => {
    mdb.readMessages.mockResolvedValue([]);
    await caller().suggestSenders();
    expect(mdb.readMessages.mock.calls[0]![1]).toBe(2000);
    expect(mdb.readMessages.mock.calls[0]![2]).toBe("desc");
  });
});
