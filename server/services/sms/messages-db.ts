// Reads the Messages database (~/Library/Messages/chat.db) through the
// sqlite3 CLI that ships with macOS. The packaged server runs on Electron 33's
// Node 20, which has no node:sqlite, and a native sqlite module would have to
// be rebuilt against Electron — the CLI avoids both. Reading the file needs
// Full Disk Access, which the server inherits from Trivio.app.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { appleToDate, dateToAppleNs } from "./apple-time";
import { decodeAttributedBody } from "./attributed-body";

export const SQLITE_BIN = "/usr/bin/sqlite3";
// HOME first: Next's output file tracing statically evaluates os.homedir()
// and would otherwise try to copy the user's Messages database into the
// standalone build (next.config.ts also excludes it as a second guard).
export const CHAT_DB_PATH = join(process.env.HOME || homedir(), "Library", "Messages", "chat.db");
export const PAGE_SIZE = 200;

export interface ChatMessage {
  rowId: bigint;
  guid: string;
  sender: string;
  text: string | null;
  receivedAt: Date;
}

export type ChatDbErrorKind = "no_access" | "missing" | "error";

export class ChatDbError extends Error {
  constructor(
    public readonly kind: ChatDbErrorKind,
    message: string
  ) {
    super(message);
    this.name = "ChatDbError";
  }
}

export type MessageCursor = { afterRowId: bigint } | { since: Date };

interface RawRow {
  rowId: number;
  guid: string;
  text: string | null;
  body: string | null;
  date: number;
  sender: string;
}

// The only values ever interpolated into SQL go through here.
function sqlInt(n: bigint): string {
  if (n < 0n) throw new RangeError(`negative SQL bound: ${n}`);
  return n.toString();
}

async function classify(stderr: string): Promise<ChatDbError> {
  const firstLine =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "sqlite3 failed";
  if (/authorization denied|not authorized|operation not permitted/i.test(stderr)) {
    return new ChatDbError("no_access", firstLine);
  }
  if (/unable to open database/i.test(stderr)) {
    try {
      await stat(CHAT_DB_PATH);
      return new ChatDbError("error", firstLine);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return new ChatDbError("missing", "Messages isn't set up on this Mac");
      }
      return new ChatDbError("no_access", firstLine);
    }
  }
  return new ChatDbError("error", firstLine);
}

function runSql(sql: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    execFile(
      SQLITE_BIN,
      ["-readonly", "-json", CHAT_DB_PATH, sql],
      { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 },
      (err, stdout, stderr) => {
        if (err) {
          void classify(String(stderr || err.message)).then(reject);
          return;
        }
        const out = String(stdout).trim();
        try {
          resolve(out ? (JSON.parse(out) as unknown[]) : []);
        } catch {
          reject(new ChatDbError("error", "Unreadable sqlite3 output"));
        }
      }
    );
  });
}

function toMessage(r: RawRow): ChatMessage {
  const text = r.text && r.text.trim() ? r.text : decodeAttributedBody(r.body);
  return {
    rowId: BigInt(r.rowId),
    guid: r.guid,
    sender: r.sender,
    text,
    receivedAt: appleToDate(r.date),
  };
}

export async function readMessages(
  cursor: MessageCursor,
  limit = PAGE_SIZE
): Promise<ChatMessage[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`bad limit: ${limit}`);
  const bound =
    "afterRowId" in cursor
      ? `m.ROWID > ${sqlInt(cursor.afterRowId)}`
      : `m.date > ${sqlInt(dateToAppleNs(cursor.since))}`;
  const sql =
    "SELECT m.ROWID AS rowId, m.guid AS guid, m.text AS text, hex(m.attributedBody) AS body, " +
    "m.date AS date, h.id AS sender " +
    "FROM message m JOIN handle h ON m.handle_id = h.ROWID " +
    `WHERE m.is_from_me = 0 AND ${bound} ORDER BY m.ROWID LIMIT ${limit};`;
  const rows = (await runSql(sql)) as RawRow[];
  return rows.map(toMessage);
}

// Must touch a real table: sqlite3 opens the file lazily, so "SELECT 1"
// would succeed even without Full Disk Access.
export async function checkChatDbAccess(): Promise<"ok" | ChatDbErrorKind> {
  try {
    await runSql("SELECT ROWID FROM message ORDER BY ROWID DESC LIMIT 1;");
    return "ok";
  } catch (e) {
    return e instanceof ChatDbError ? e.kind : "error";
  }
}
