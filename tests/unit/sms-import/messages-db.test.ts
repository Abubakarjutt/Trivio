import { beforeEach, describe, expect, it, vi } from "vitest";

const cp = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => cp);
const fsp = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("node:fs/promises", () => fsp);

import {
  CHAT_DB_PATH,
  ChatDbError,
  SQLITE_BIN,
  checkChatDbAccess,
  readMessages,
} from "@/server/services/sms/messages-db";
import { dateToAppleNs } from "@/server/services/sms/apple-time";

type Cb = (err: Error | null, stdout: string, stderr: string) => void;
function sqliteReturns(stdout: string) {
  cp.execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: Cb) =>
    cb(null, stdout, "")
  );
}
function sqliteFails(stderr: string) {
  cp.execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: Cb) =>
    cb(new Error("exit 1"), "", stderr)
  );
}
const sqlOf = () => cp.execFile.mock.calls[0]![1][3] as string;

beforeEach(() => {
  cp.execFile.mockReset();
  fsp.stat.mockReset();
});

describe("readMessages", () => {
  it("runs sqlite3 read-only with JSON output and a ROWID bound", async () => {
    sqliteReturns("[]");
    await readMessages({ afterRowId: 41n });
    const [bin, args] = cp.execFile.mock.calls[0]!;
    expect(bin).toBe(SQLITE_BIN);
    expect(args.slice(0, 3)).toEqual(["-readonly", "-json", CHAT_DB_PATH]);
    expect(sqlOf()).toContain("m.ROWID > 41");
    expect(sqlOf()).toContain("m.is_from_me = 0");
    expect(sqlOf()).toContain("LIMIT 200");
  });

  it("uses an Apple-nanosecond date bound on first sync", async () => {
    sqliteReturns("[]");
    const since = new Date("2026-10-23T00:00:00Z");
    await readMessages({ since });
    expect(sqlOf()).toContain(`m.date > ${dateToAppleNs(since).toString()}`);
  });

  it("maps rows, decoding attributedBody when text is empty", async () => {
    const hex = Buffer.concat([
      Buffer.from("\x84\x08NSString\x01\x94\x84\x01+", "latin1"),
      Buffer.from([5]),
      Buffer.from("hello"),
    ]).toString("hex");
    const date = Number(dateToAppleNs(new Date("2026-10-30T09:00:00Z")));
    sqliteReturns(
      JSON.stringify([
        { rowId: 7, guid: "g-7", text: "PKR 500 at KFC", body: null, date, sender: "HBL" },
        { rowId: 8, guid: "g-8", text: null, body: hex, date, sender: "HBL" },
      ])
    );
    const rows = await readMessages({ afterRowId: 0n });
    expect(rows).toEqual([
      {
        rowId: 7n,
        guid: "g-7",
        sender: "HBL",
        text: "PKR 500 at KFC",
        receivedAt: new Date("2026-10-30T09:00:00Z"),
      },
      {
        rowId: 8n,
        guid: "g-8",
        sender: "HBL",
        text: "hello",
        receivedAt: new Date("2026-10-30T09:00:00Z"),
      },
    ]);
  });

  it("treats empty stdout as no rows", async () => {
    sqliteReturns("");
    expect(await readMessages({ afterRowId: 0n })).toEqual([]);
  });

  it("refuses negative bounds and bad limits without running sqlite3", async () => {
    await expect(readMessages({ afterRowId: -1n })).rejects.toBeInstanceOf(RangeError);
    await expect(readMessages({ afterRowId: 0n }, 0)).rejects.toBeInstanceOf(RangeError);
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it("maps 'authorization denied' to no_access", async () => {
    sqliteFails('Error: unable to open database "x": authorization denied');
    await expect(readMessages({ afterRowId: 0n })).rejects.toMatchObject({ kind: "no_access" });
  });

  it("maps 'unable to open' + missing file to missing", async () => {
    sqliteFails("Error: unable to open database file");
    fsp.stat.mockRejectedValue(Object.assign(new Error("nope"), { code: "ENOENT" }));
    const err = await readMessages({ afterRowId: 0n }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatDbError);
    expect(err).toMatchObject({ kind: "missing", message: "Messages isn't set up on this Mac" });
  });

  it("maps 'unable to open' + EPERM on the file to no_access", async () => {
    sqliteFails("Error: unable to open database file");
    fsp.stat.mockRejectedValue(Object.assign(new Error("nope"), { code: "EPERM" }));
    await expect(readMessages({ afterRowId: 0n })).rejects.toMatchObject({ kind: "no_access" });
  });

  it("maps anything else to error with the first stderr line", async () => {
    sqliteFails("Error: database is locked\nmore");
    await expect(readMessages({ afterRowId: 0n })).rejects.toMatchObject({
      kind: "error",
      message: "Error: database is locked",
    });
  });

  it("rejects with error when sqlite3 returns malformed JSON", async () => {
    sqliteReturns("not json");
    await expect(readMessages({ afterRowId: 0n })).rejects.toMatchObject({
      kind: "error",
      message: "Unreadable sqlite3 output",
    });
  });
});

describe("checkChatDbAccess", () => {
  it("returns ok when a real table can be read", async () => {
    sqliteReturns('[{"ROWID":1}]');
    expect(await checkChatDbAccess()).toBe("ok");
    expect(sqlOf()).toContain("FROM message");
  });
  it("returns the error kind otherwise", async () => {
    sqliteFails("authorization denied");
    expect(await checkChatDbAccess()).toBe("no_access");
  });
});
