import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

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
const row = {
  date: "2026-10-30",
  description: "Raast",
  merchantName: "Raast",
  amount: 5000,
  type: "DEBIT",
  category: "Transfers",
  mccCode: "0000",
  mccLabel: "Transfers",
  possibleDuplicate: false,
  needsCategory: true,
  ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" },
  ruleApplied: false,
};

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({
    id: "user-1",
    organisationId: "org-1",
    organisation: { id: "org-1" },
  });
});

describe("smsImport.notifications", () => {
  it("lists this org's open notifications for SMS that reached review, skipping rowless items", async () => {
    const at = new Date("2026-10-30T10:00:00Z");
    db.smsImportItem.findMany.mockResolvedValue([
      { id: "a", receivedAt: at, parsedJson: [row, { ...row, merchantName: "Other" }] },
      { id: "b", receivedAt: at, parsedJson: [] }, // hidden from Skipped: no rows
      { id: "c", receivedAt: at, parsedJson: null }, // malformed: skipped, not a crash
    ]);
    expect(await caller().notifications()).toEqual([
      {
        id: "a",
        receivedAt: at,
        amount: 5000,
        type: "DEBIT",
        merchantName: "Raast",
        category: "Transfers",
        counterpartyLabel: "Transfers to ••4567",
        flagged: true,
        ruleApplied: false,
        extraRows: 1,
      },
    ]);
    expect(db.smsImportItem.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        organisationId: "org-1",
        notificationClosedAt: null,
        status: { in: ["PENDING_REVIEW", "APPROVED", "DISMISSED"] },
      },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });
  });
});

describe("smsImport.closeNotification", () => {
  it("closes only this org's notification", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    await caller().closeNotification({ id: "a" });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "a", organisationId: "org-1" },
      data: { notificationClosedAt: expect.any(Date) },
    });
  });

  it("is NOT_FOUND for another org's item", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    await expect(caller().closeNotification({ id: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("dismiss leaves notifications open", () => {
  it("never writes notificationClosedAt", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    await caller().dismiss({ ids: ["a"] });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0].data).not.toHaveProperty(
      "notificationClosedAt"
    );
  });
});
