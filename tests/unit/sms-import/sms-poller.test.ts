import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDbError, type ChatMessage } from "@/server/services/sms/messages-db";
import { runSmsTick, type PollerDeps } from "@/server/services/sms/sms-poller.service";
import { makeDb, type MockDb } from "../outreach/helpers";

const NOW = new Date("2026-10-30T12:00:00Z");
let db: MockDb;
let readMessages: ReturnType<typeof vi.fn>;
let processSms: ReturnType<typeof vi.fn>;
const deps = (): PollerDeps => ({
  db: db as unknown as PrismaClient,
  readMessages: readMessages as never,
  processSms: processSms as never,
  now: () => NOW,
});

const source = (over: Partial<{ lastRowId: bigint | null; senderIds: string[] }> = {}) => ({
  id: "src-1", organisationId: "org-1", senderIds: ["HBL"], lastRowId: 10n as bigint | null, ...over,
});
const msg = (rowId: number, sender = "HBL", text: string | null = `PKR ${rowId} at X`): ChatMessage => ({
  rowId: BigInt(rowId), guid: `g-${rowId}`, sender, text, receivedAt: NOW,
});
const parsedRow = { date: "2026-10-30", description: "X", merchantName: "X", amount: 5, type: "DEBIT",
  category: "Other", mccCode: "0000", mccLabel: "Uncategorized", possibleDuplicate: false };

beforeEach(() => {
  db = makeDb();
  db.statementTransaction.findMany.mockResolvedValue([]);
  db.smsImportItem.findUnique.mockResolvedValue(null);
  readMessages = vi.fn().mockResolvedValue([]);
  processSms = vi.fn().mockResolvedValue({ status: "PENDING_REVIEW", redactedText: "red", parsed: [parsedRow] });
});

describe("runSmsTick", () => {
  it("only loads enabled sources that have access", async () => {
    db.smsSource.findMany.mockResolvedValue([]);
    await runSmsTick(deps());
    expect(db.smsSource.findMany.mock.calls[0]![0].where).toEqual({
      enabled: true, status: { not: "NO_ACCESS" }, senderIds: { isEmpty: false },
    });
  });

  it("looks back 7 days on first sync", async () => {
    db.smsSource.findMany.mockResolvedValue([source({ lastRowId: null })]);
    await runSmsTick(deps());
    expect(readMessages).toHaveBeenCalledWith({ since: new Date("2026-10-23T12:00:00Z") });
  });

  it("imports only bank senders and stores the redacted text", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11, "Mom"), msg(12, "hbl")]);
    await runSmsTick(deps());
    expect(processSms).toHaveBeenCalledTimes(1);
    expect(processSms).toHaveBeenCalledWith("PKR 12 at X", NOW, []);
    expect(db.smsImportItem.create.mock.calls[0]![0].data).toMatchObject({
      organisationId: "org-1", sourceId: "src-1", messageGuid: "g-12", sender: "hbl",
      text: "red", status: "PENDING_REVIEW", parsedJson: [parsedRow], errorMessage: null,
    });
  });

  it("stores NO_TRANSACTION and FAILED results too", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11), msg(12)]);
    processSms
      .mockResolvedValueOnce({ status: "NO_TRANSACTION", redactedText: "otp", parsed: [] })
      .mockResolvedValueOnce({ status: "FAILED", redactedText: "x", parsed: [], error: "boom" });
    await runSmsTick(deps());
    const created = db.smsImportItem.create.mock.calls.map((c) => c[0].data);
    expect(created.map((d) => [d.status, d.errorMessage])).toEqual([["NO_TRANSACTION", null], ["FAILED", "boom"]]);
  });

  it("marks a bank SMS with unreadable text FAILED without calling the AI", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11, "HBL", null)]);
    await runSmsTick(deps());
    expect(processSms).not.toHaveBeenCalled();
    expect(db.smsImportItem.create.mock.calls[0]![0].data).toMatchObject({ status: "FAILED", text: "" });
  });

  it("skips messages already imported", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11)]);
    db.smsImportItem.findUnique.mockResolvedValue({ id: "existing" });
    await runSmsTick(deps());
    expect(processSms).not.toHaveBeenCalled();
    expect(db.smsImportItem.create).not.toHaveBeenCalled();
  });

  it("advances lastRowId after each import and to the last row of the page", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11), msg(12, "Mom"), msg(13, "Mom")]);
    await runSmsTick(deps());
    const rowIds = db.smsSource.update.mock.calls
      .map((c) => c[0].data.lastRowId)
      .filter((v) => v !== undefined);
    expect(rowIds).toEqual([11n, 13n]);
  });

  it("keeps paging through a backlog within one tick", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    const fullPage = Array.from({ length: 200 }, (_, i) => msg(11 + i, "Mom"));
    readMessages.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([msg(211)]);
    await runSmsTick(deps());
    expect(readMessages).toHaveBeenCalledTimes(2);
    expect(readMessages.mock.calls[1]![0]).toEqual({ afterRowId: 210n });
    expect(processSms).toHaveBeenCalledTimes(1);
  });

  it("marks the source ACTIVE after a clean sync", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    await runSmsTick(deps());
    expect(db.smsSource.update.mock.calls.at(-1)![0]).toEqual({
      where: { id: "src-1" }, data: { lastSyncedAt: NOW, status: "ACTIVE", lastError: null },
    });
  });

  it("records NO_ACCESS and ERROR from the reader", async () => {
    db.smsSource.findMany.mockResolvedValue([source(), { ...source(), id: "src-2" }]);
    readMessages
      .mockRejectedValueOnce(new ChatDbError("no_access", "authorization denied"))
      .mockRejectedValueOnce(new ChatDbError("missing", "Messages isn't set up on this Mac"));
    await runSmsTick(deps());
    const updates = db.smsSource.update.mock.calls.map((c) => c[0]);
    expect(updates).toEqual([
      { where: { id: "src-1" }, data: { status: "NO_ACCESS", lastError: "authorization denied" } },
      { where: { id: "src-2" }, data: { status: "ERROR", lastError: "Messages isn't set up on this Mac" } },
    ]);
  });

  it("never runs two ticks at once", async () => {
    let release!: () => void;
    db.smsSource.findMany.mockReturnValue(new Promise((r) => { release = () => r([]); }));
    const first = runSmsTick(deps());
    await runSmsTick(deps());
    release();
    await first;
    expect(db.smsSource.findMany).toHaveBeenCalledTimes(1);
  });

  it("records a FAILED item and carries on when one message blows up", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11), msg(12)]);
    db.smsImportItem.create.mockRejectedValueOnce(new Error("invalid byte sequence"));
    await runSmsTick(deps());
    const created = db.smsImportItem.create.mock.calls.map((c) => c[0].data);
    expect(created).toHaveLength(3);
    expect(created[1]).toMatchObject({
      messageGuid: "g-11", status: "FAILED", text: "", parsedJson: [], errorMessage: "invalid byte sequence",
    });
    expect(created[2]).toMatchObject({ messageGuid: "g-12", status: "PENDING_REVIEW" });
    const updates = db.smsSource.update.mock.calls.map((c) => c[0].data);
    expect(updates.map((d) => d.lastRowId).filter((v) => v !== undefined)).toEqual([11n, 12n]);
    expect(updates.at(-1)).toEqual({ lastSyncedAt: NOW, status: "ACTIVE", lastError: null });
    errSpy.mockRestore();
  });

  it("strips NUL characters before parsing", async () => {
    db.smsSource.findMany.mockResolvedValue([source()]);
    readMessages.mockResolvedValueOnce([msg(11, "HBL", "PKR 5\u0000 at X")]);
    await runSmsTick(deps());
    expect(processSms).toHaveBeenCalledWith("PKR 5 at X", NOW, []);
  });
});
