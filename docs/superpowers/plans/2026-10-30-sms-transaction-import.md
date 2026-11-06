# SMS Transaction Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trivio reads debit-card SMS alerts from the Mac's Messages database, parses them into transactions, and queues them for the user to approve; the old email-forwarding import is removed.

**Architecture:** A poller started from `instrumentation.ts` (macOS only) reads new rows from `~/Library/Messages/chat.db` every 60 s through `/usr/bin/sqlite3 -readonly -json`, keeps messages from user-listed bank senders, runs them through the existing redact → AI parse → categorise pipeline, and stores each as an `SmsImportItem`. A `smsImport` tRPC router powers a Settings card (setup + senders) and a review sheet on the Transactions page; approving creates ordinary `StatementTransaction`s in an `SMS` import batch.

**Tech Stack:** Next.js 15 App Router, tRPC v11 (`orgProcedure`), Prisma + PostgreSQL, Vitest, Electron 33 (server child runs on Electron's Node 20.18), macOS `/usr/bin/sqlite3`.

**Spec:** `docs/superpowers/specs/2026-10-30-sms-transaction-import-design.md`

## Global Constraints

- macOS only: the poller starts only when `process.platform === "darwin"`; the Settings card renders only when `platformSupported` is true.
- Never auto-save: every parsed SMS lands as `PENDING_REVIEW` (or `NO_TRANSACTION`/`FAILED`); only `smsImport.approve` creates `StatementTransaction`s.
- Every query is scoped by `organisationId` (`ctx.organisationId` from `orgProcedure`).
- Money stays `Decimal(19,4)` in the DB; parsed amounts are plain numbers in JSON until approval writes them.
- Store only the **PII-redacted** SMS text (`redactPiiText`).
- Read `chat.db` only via `execFile("/usr/bin/sqlite3", ["-readonly", "-json", CHAT_DB_PATH, sql])` — no shell, no `node:sqlite`, no `better-sqlite3`. The only values interpolated into SQL are non-negative `bigint`s.
- First sync looks back 7 days; poll every 60 s; at most 200 rows per read.
- Tests: Vitest under `tests/unit/sms-import/` (already matched by `tests/unit/**/*.test.ts`); router tests use `makeDb` from `tests/unit/outreach/helpers.ts`.
- Before any release tag: `npm run build` (lint errors only show there).

**Deviations from the spec (decided while planning):**
- Procedures use `orgProcedure` (the codebase's org-scoped procedure), not `protectedProcedure`.
- No new preload bridge: the existing `window.trivioDesktop.openExternal` is reused, and the main-process allow-list gains exactly the Full Disk Access settings URL.
- SMS code lives in `server/services/sms/` (like `server/services/outreach/`), not as flat files.
- `saveSource` accepts 0–20 senders so the user can remove the last one.

## Review Focus

1. **Sender written differently in Messages than the user typed it** (`+92 300-1234567` vs `+923001234567`, `hbl` vs `HBL`) → still matches. Test in Task 2.
2. **Backlog after the app was closed for days** (hundreds of non-bank messages before a bank SMS) → the tick pages through up to 10 × 200 rows instead of advancing one page per minute. Test in Task 6.
3. **OTP / promo / balance SMS from the same bank sender** → `NO_TRANSACTION`, visible under "Skipped", never silently lost. Tests in Task 5 and Task 6.
4. **SMS with no year or a misread date** (e.g. "on 30-Oct", AI returns `2023-10-30`) → falls back to the SMS received date when the parsed date is invalid or more than 3 days away. Test in Task 5.
5. **Approve clicked twice / two windows approve the same item** → only one set of transactions is created (claim-then-insert inside one DB transaction; the loser gets `CONFLICT` and rolls back). Test in Task 7.

---

### Task 1: Remove the email-forwarding import

**Files:**
- Delete: `app/api/email/inbound/route.ts`, `app/api/email/inbound/route.test.ts`, `cloudflare/email-worker/` (whole directory), `app/(app)/settings/_components/email-import-card.tsx`
- Modify: `server/routers/org.ts:234-243` (remove `resetEmailImportToken`)
- Modify: `app/(app)/settings/page.tsx:6,25,165-168`
- Modify: `app/(app)/pf/transactions/page.tsx:417` (and possibly `:92`)
- Modify: `app/(app)/pf/transactions/_components/import-dialog.tsx` (prop at ~45/49, banner at ~290-293, `EmailImportBanner` function from ~428 to its end)
- Modify: `vitest.config.ts` (the `"app/api/email/**/*.test.ts"` include and the two `cloudflare/email-worker` comment lines)
- Modify: `prisma/schema.prisma:126,174` (remove `emailImportToken` field and its `@@index`)
- Create: migration via `prisma migrate dev`

**Interfaces:**
- Consumes: nothing.
- Produces: `Organisation` no longer has `emailImportToken`; `ImportDialogProps` no longer has `emailImportToken`.

- [ ] **Step 1: Start the database**

Run: `docker compose up -d`
Expected: postgres container running.

- [ ] **Step 2: Delete the email path files**

```bash
git rm -r app/api/email/inbound cloudflare/email-worker "app/(app)/settings/_components/email-import-card.tsx"
```

- [ ] **Step 3: Remove `resetEmailImportToken` from `server/routers/org.ts`**

Delete the whole procedure (lines 234-243, from `resetEmailImportToken: orgProcedure.mutation(` through its closing `}),` and the blank line after it).

- [ ] **Step 4: Remove the card from `app/(app)/settings/page.tsx`**

Delete line 6 `import { EmailImportCard } from "./_components/email-import-card";`, line 25 `const emailImportToken = user.organisation?.emailImportToken ?? "";` (and the blank line after it), and this block at ~165-168:

```tsx
          {/* Email Import */}
          {emailImportToken && (
            <EmailImportCard initialToken={emailImportToken} />
          )}
```

(Task 9 puts the SMS card in this exact spot.)

- [ ] **Step 5: Remove the banner from the import dialog**

In `app/(app)/pf/transactions/_components/import-dialog.tsx`:
- remove `emailImportToken?: string | null;` from `ImportDialogProps` and `emailImportToken` from the destructured props of `ImportDialog`;
- remove the JSX block:
```tsx
            {/* Email auto-import banner */}
            {emailImportToken && (
              <EmailImportBanner emailImportToken={emailImportToken} />
            )}
```
- delete the `// ── Email Import Banner ──…` comment and the entire `function EmailImportBanner(...) { ... }` that follows it.

In `app/(app)/pf/transactions/page.tsx` remove line 417 `emailImportToken={org?.emailImportToken}`. Then run `grep -n "org?\.\|org\." "app/(app)/pf/transactions/page.tsx"`; if nothing else uses `org`, also remove `const { data: org } = trpc.org.get.useQuery();` (line 92).

- [ ] **Step 6: Clean `vitest.config.ts`**

Remove `"app/api/email/**/*.test.ts",` and these two comment lines:
```ts
      // cloudflare/email-worker tests require a Cloudflare Workers runtime (postal-mime uses `self`)
      // and cannot run under Vitest's Node.js environment. Run them with wrangler test instead.
```

- [ ] **Step 7: Drop the column**

In `prisma/schema.prisma` delete `  emailImportToken     String           @unique @default(cuid())` and `  @@index([emailImportToken])` from `model Organisation`. Then:

Run: `npx prisma migrate dev --name drop_email_import_token`
Expected: a new `prisma/migrations/<timestamp>_drop_email_import_token/migration.sql` that drops the index(es) and `ALTER TABLE "Organisation" DROP COLUMN "emailImportToken"`; "Your database is now in sync".

- [ ] **Step 8: Verify nothing references the old path**

Run: `grep -rn "emailImportToken\|EMAIL_WEBHOOK_SECRET\|import.trivio-ai\|email/inbound\|EmailImport" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=dist-server --exclude-dir=release --exclude-dir=docs --exclude-dir=graphify-out --exclude-dir=prisma .`
Expected: no output. (If `.env.example` or README mentions `EMAIL_WEBHOOK_SECRET` or the import address, delete those lines and re-run.)

- [ ] **Step 9: Typecheck and test**

Run: `npm run typecheck && npm run test`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: remove email-forwarding transaction import

The Cloudflare worker POSTed to a hosted URL that no longer exists now that
Trivio is a local desktop app. SMS import replaces it."
```

---

### Task 2: SMS helpers — Apple time, sender matching, attributedBody decoder

**Files:**
- Create: `server/services/sms/apple-time.ts`, `server/services/sms/sender.ts`, `server/services/sms/attributed-body.ts`
- Test: `tests/unit/sms-import/helpers.test.ts`

**Interfaces:**
- Produces:
  - `APPLE_EPOCH_MS: number`, `appleToDate(value: number): Date`, `dateToAppleNs(date: Date): bigint`
  - `normalizeSender(id: string): string`, `makeSenderMatcher(senderIds: string[]): (sender: string) => boolean`, `isPhoneNumber(id: string): boolean`
  - `decodeAttributedBody(hex: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

`tests/unit/sms-import/helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APPLE_EPOCH_MS, appleToDate, dateToAppleNs } from "@/server/services/sms/apple-time";
import { isPhoneNumber, makeSenderMatcher, normalizeSender } from "@/server/services/sms/sender";
import { decodeAttributedBody } from "@/server/services/sms/attributed-body";

// Builds an attributedBody blob shaped like the ones Messages writes:
// typedstream header, class chain, "NSString", bookkeeping bytes, '+', length, UTF-8.
function blob(text: string): string {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const len =
    n < 0x80 ? Buffer.from([n])
    : n <= 0xffff ? Buffer.from([0x81, n & 0xff, n >> 8])
    : Buffer.from([0x82, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  const head = Buffer.from(
    "\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+",
    "latin1",
  );
  return Buffer.concat([head, len, body, Buffer.from([0x86, 0x84])]).toString("hex");
}

describe("apple time", () => {
  it("converts nanoseconds since 2001 to a Date", () => {
    const d = new Date("2026-10-30T09:15:00Z");
    const ns = Number(dateToAppleNs(d)); // sqlite3 -json hands us a lossy JS number
    expect(appleToDate(ns).toISOString()).toBe("2026-10-30T09:15:00.000Z");
  });
  it("still reads the old seconds-based format", () => {
    expect(appleToDate(0).getTime()).toBe(APPLE_EPOCH_MS);
    expect(appleToDate(86_400).toISOString()).toBe("2001-01-02T00:00:00.000Z");
  });
  it("dateToAppleNs is exact for whole milliseconds", () => {
    expect(dateToAppleNs(new Date(APPLE_EPOCH_MS + 1))).toBe(1_000_000n);
  });
});

describe("sender matching", () => {
  it("normalises case, spaces, plus, dashes and brackets", () => {
    expect(normalizeSender(" +92 (300) 123-4567 ")).toBe("923001234567");
    expect(normalizeSender("HBL")).toBe("hbl");
  });
  it("matches differently written forms of the same sender", () => {
    const m = makeSenderMatcher(["HBL", "+92 300-1234567"]);
    expect(m("hbl")).toBe(true);
    expect(m("+923001234567")).toBe(true);
    expect(m("MCB")).toBe(false);
  });
  it("ignores empty sender ids", () => {
    expect(makeSenderMatcher(["", "  "])("")).toBe(false);
  });
  it("detects phone numbers", () => {
    expect(isPhoneNumber("+923001234567")).toBe(true);
    expect(isPhoneNumber("8250")).toBe(false);
    expect(isPhoneNumber("HBL")).toBe(false);
  });
});

describe("decodeAttributedBody", () => {
  it("reads a short string (1-byte length)", () => {
    expect(decodeAttributedBody(blob("PKR 2,450 spent at FOODPANDA"))).toBe("PKR 2,450 spent at FOODPANDA");
  });
  it("reads a 2-byte length (0x81)", () => {
    const text = "x".repeat(300);
    expect(decodeAttributedBody(blob(text))).toBe(text);
  });
  it("reads a 4-byte length (0x82)", () => {
    const text = "y".repeat(70_000);
    expect(decodeAttributedBody(blob(text))).toBe(text);
  });
  it("uses byte length for non-ASCII text", () => {
    expect(decodeAttributedBody(blob("₨ 1,200 at Café Ñ"))).toBe("₨ 1,200 at Café Ñ");
  });
  it("returns null for missing, foreign or truncated blobs", () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody("")).toBeNull();
    expect(decodeAttributedBody(Buffer.from("no marker here").toString("hex"))).toBeNull();
    const full = blob("hello world");
    expect(decodeAttributedBody(full.slice(0, full.length - 12))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/helpers.test.ts`
Expected: FAIL — cannot resolve `@/server/services/sms/apple-time`.

- [ ] **Step 3: Implement**

`server/services/sms/apple-time.ts`:

```ts
// Messages stores dates relative to 2001-01-01 UTC (Apple's Cocoa epoch):
// nanoseconds on macOS 10.13+, seconds on older databases.
export const APPLE_EPOCH_MS = 978_307_200_000;

export function appleToDate(value: number): Date {
  // Nanosecond values exceed 2^53, so they arrive slightly rounded; round to
  // whole milliseconds instead of letting Date truncate 0.9999 ms down.
  const ms = value > 1e14 ? Math.round(value / 1e6) : value * 1000;
  return new Date(APPLE_EPOCH_MS + ms);
}

export function dateToAppleNs(date: Date): bigint {
  return BigInt(date.getTime() - APPLE_EPOCH_MS) * 1_000_000n;
}
```

`server/services/sms/sender.ts`:

```ts
// Messages shows the same sender in different shapes ("+92 300-1234567",
// "+923001234567", "HBL"/"hbl"); compare on a normalised form.
export function normalizeSender(id: string): string {
  return id.toLowerCase().replace(/[\s+\-()]/g, "");
}

export function makeSenderMatcher(senderIds: string[]): (sender: string) => boolean {
  const wanted = new Set(senderIds.map(normalizeSender).filter(Boolean));
  return (sender) => wanted.has(normalizeSender(sender));
}

export function isPhoneNumber(id: string): boolean {
  return /^\d{7,}$/.test(normalizeSender(id));
}
```

`server/services/sms/attributed-body.ts`:

```ts
// Newer macOS often leaves message.text empty and stores the body only in
// attributedBody, an NSArchiver "typedstream". The plain string follows the
// NSString class name: a few bookkeeping bytes, then '+' (0x2B), then a length
// (one byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE), then UTF-8 bytes.
const MARKER = Buffer.from("NSString", "latin1");
const PLUS = 0x2b;
const SEARCH_WINDOW = 16;

export function decodeAttributedBody(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  const at = buf.indexOf(MARKER);
  if (at < 0) return null;

  let i = at + MARKER.length;
  const windowEnd = Math.min(buf.length, i + SEARCH_WINDOW);
  while (i < windowEnd && buf[i] !== PLUS) i++;
  if (i >= windowEnd) return null;
  i++;
  if (i >= buf.length) return null;

  let len: number;
  const lead = buf[i]!;
  if (lead === 0x81) {
    if (i + 3 > buf.length) return null;
    len = buf.readUInt16LE(i + 1);
    i += 3;
  } else if (lead === 0x82) {
    if (i + 5 > buf.length) return null;
    len = buf.readUInt32LE(i + 1);
    i += 5;
  } else {
    len = lead;
    i += 1;
  }
  if (i + len > buf.length) return null;
  return buf.subarray(i, i + len).toString("utf8");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/sms-import/helpers.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/sms tests/unit/sms-import/helpers.test.ts
git commit -m "feat(sms): Apple time, sender matching and attributedBody decoding"
```

---

### Task 3: Read `chat.db` through `/usr/bin/sqlite3`

**Files:**
- Create: `server/services/sms/messages-db.ts`
- Test: `tests/unit/sms-import/messages-db.test.ts`

**Interfaces:**
- Consumes: `appleToDate`, `dateToAppleNs`, `decodeAttributedBody` (Task 2).
- Produces:
  - `SQLITE_BIN = "/usr/bin/sqlite3"`, `CHAT_DB_PATH: string`, `PAGE_SIZE = 200`
  - `interface ChatMessage { rowId: bigint; guid: string; sender: string; text: string | null; receivedAt: Date }`
  - `type ChatDbErrorKind = "no_access" | "missing" | "error"`
  - `class ChatDbError extends Error { readonly kind: ChatDbErrorKind }`
  - `type MessageCursor = { afterRowId: bigint } | { since: Date }`
  - `readMessages(cursor: MessageCursor, limit?: number): Promise<ChatMessage[]>`
  - `checkChatDbAccess(): Promise<"ok" | ChatDbErrorKind>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/sms-import/messages-db.test.ts`:

```ts
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
  cp.execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: Cb) => cb(null, stdout, ""));
}
function sqliteFails(stderr: string) {
  cp.execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: Cb) => cb(new Error("exit 1"), "", stderr));
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
    sqliteReturns(JSON.stringify([
      { rowId: 7, guid: "g-7", text: "PKR 500 at KFC", body: null, date, sender: "HBL" },
      { rowId: 8, guid: "g-8", text: null, body: hex, date, sender: "HBL" },
    ]));
    const rows = await readMessages({ afterRowId: 0n });
    expect(rows).toEqual([
      { rowId: 7n, guid: "g-7", sender: "HBL", text: "PKR 500 at KFC", receivedAt: new Date("2026-10-30T09:00:00Z") },
      { rowId: 8n, guid: "g-8", sender: "HBL", text: "hello", receivedAt: new Date("2026-10-30T09:00:00Z") },
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
    await expect(readMessages({ afterRowId: 0n })).rejects.toMatchObject({ kind: "error", message: "Error: database is locked" });
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/messages-db.test.ts`
Expected: FAIL — cannot resolve `@/server/services/sms/messages-db`.

- [ ] **Step 3: Implement**

`server/services/sms/messages-db.ts`:

```ts
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
export const CHAT_DB_PATH = join(homedir(), "Library", "Messages", "chat.db");
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
  constructor(public readonly kind: ChatDbErrorKind, message: string) {
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
  const firstLine = stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "sqlite3 failed";
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
        resolve(out ? (JSON.parse(out) as unknown[]) : []);
      },
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

export async function readMessages(cursor: MessageCursor, limit = PAGE_SIZE): Promise<ChatMessage[]> {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/sms-import/messages-db.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/sms/messages-db.ts tests/unit/sms-import/messages-db.test.ts
git commit -m "feat(sms): read chat.db via the macOS sqlite3 CLI"
```

---

### Task 4: SPIKE — confirm the packaged server can read `chat.db`

This is the riskiest assumption in the spec. **If it fails, stop and report back before Task 5.**

**Files:**
- Modify: `instrumentation.ts` (boot-time access log; Task 6 keeps it and adds the poller next to it)

**Interfaces:**
- Consumes: `checkChatDbAccess` (Task 3).

- [ ] **Step 1: Log access at boot**

In `instrumentation.ts`, at the end of `register()` (after the tax-regime `try/catch`), add:

```ts
  if (process.platform === "darwin") {
    try {
      const { checkChatDbAccess } = await import("@/server/services/sms/messages-db");
      console.info("[sms] chat.db access:", await checkChatDbAccess());
    } catch (err) {
      console.error("[sms] access check failed:", err);
    }
  }
```

- [ ] **Step 2: Dev check (terminal permission)**

Run: `npm run dev`, then load http://localhost:3000.
Expected in the terminal: `[sms] chat.db access: no_access` if the terminal app lacks Full Disk Access, `ok` if it has it. Either is fine — this only proves the classifier.

- [ ] **Step 3: Build the packaged app**

Run: `npm run build:desktop`
Expected: `release/mac-arm64/Trivio.app` produced.

- [ ] **Step 4: Grant Full Disk Access and launch through Launch Services**

System Settings → Privacy & Security → Full Disk Access → `+` → choose `release/mac-arm64/Trivio.app` → enable. Then launch with `open` (not from the terminal directly, so macOS treats Trivio — not Terminal — as the responsible app). The server child's output is forwarded to the main process as `[next] …` (`desktop/main.ts` `spawnAppServer`):

```bash
open -n --stdout "$PWD/spike-sms.log" --stderr "$PWD/spike-sms.log" release/mac-arm64/Trivio.app
sleep 20; grep "\[sms\]" spike-sms.log
```

Expected: `[next] [sms] chat.db access: ok`.

- [ ] **Step 5: Confirm a just-arrived SMS is visible (WAL check)**

Have a test SMS sent to the phone. Within a minute, with Messages open, run in a terminal that has Full Disk Access (skip if none does — Task 11 Step 2 covers this end to end):

```bash
/usr/bin/sqlite3 -readonly ~/Library/Messages/chat.db "SELECT ROWID, datetime(date/1000000000 + 978307200,'unixepoch') FROM message ORDER BY ROWID DESC LIMIT 1;"
```

Expected: the new message's timestamp — a read-only connection sees rows still in the write-ahead log.

- [ ] **Step 6: Record the result and commit**

Quit Trivio, delete `spike-sms.log`. If Step 4 printed `ok`:

```bash
git add instrumentation.ts
git commit -m "feat(sms): log chat.db access at boot (spike: packaged app inherits Full Disk Access)"
```

If it printed `no_access`: **stop.** Report the log lines; the design then needs the read moved into the Electron main process.

---

### Task 5: Turn one SMS into reviewable transactions

**Files:**
- Create: `server/services/sms/sms-import.service.ts`
- Test: `tests/unit/sms-import/sms-import.service.test.ts`

**Interfaces:**
- Consumes: `redactPiiText` (`@/server/services/pii-redaction.service`), `parseTransactionsFromText` (`@/server/services/pdf-statement.service`), `deduplicateIncoming`, `detectDuplicates`, `ExistingTransaction` (`@/server/services/statement-parser.service`), `categorizeBatch` (`@/server/services/statement-categorization.service`).
- Produces:
  - `interface ParsedSmsTransaction { date: string; description: string; merchantName: string; amount: number; type: "DEBIT" | "CREDIT"; category: string; mccCode: string; mccLabel: string; possibleDuplicate: boolean }`
  - `type ProcessSmsResult = { status: "PENDING_REVIEW"; redactedText: string; parsed: ParsedSmsTransaction[] } | { status: "NO_TRANSACTION"; redactedText: string; parsed: [] } | { status: "FAILED"; redactedText: string; parsed: []; error: string }`
  - `processSms(text: string, receivedAt: Date, existing: ExistingTransaction[]): Promise<ProcessSmsResult>`
  - `resolveDate(parsed: string, receivedAt: Date): string`, `localDateString(d: Date): string`
  - `loadExistingForDedup(db: Pick<PrismaClient, "statementTransaction">, organisationId: string, now: Date): Promise<ExistingTransaction[]>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/sms-import/sms-import.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ parseTransactionsFromText: vi.fn() }));
vi.mock("@/server/services/pdf-statement.service", () => pdf);
const cat = vi.hoisted(() => ({ categorizeBatch: vi.fn() }));
vi.mock("@/server/services/statement-categorization.service", () => cat);
const pii = vi.hoisted(() => ({ redactPiiText: vi.fn((s: string) => s.replace(/\d{4} \d{4}/g, "[CARD]")) }));
vi.mock("@/server/services/pii-redaction.service", () => pii);

import { loadExistingForDedup, processSms, resolveDate } from "@/server/services/sms/sms-import.service";

const RECEIVED = new Date(2026, 9, 30, 14, 5); // 30 Oct 2026 14:05 local
const kfc = { date: "2026-10-30", description: "KFC DHA", amount: 1450, type: "DEBIT" as const };
const catKfc = { description: "KFC DHA", merchantName: "KFC", mccCode: "5814", mccLabel: "Fast Food", category: "Food & Dining" };

beforeEach(() => {
  pdf.parseTransactionsFromText.mockReset();
  cat.categorizeBatch.mockReset();
});

describe("processSms", () => {
  it("redacts, parses and categorises into PENDING_REVIEW", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    cat.categorizeBatch.mockResolvedValue([catKfc]);
    const r = await processSms("Card 1234 5678 used PKR 1,450 at KFC DHA", RECEIVED, []);
    expect(pdf.parseTransactionsFromText).toHaveBeenCalledWith("Card [CARD] used PKR 1,450 at KFC DHA");
    expect(r).toEqual({
      status: "PENDING_REVIEW",
      redactedText: "Card [CARD] used PKR 1,450 at KFC DHA",
      parsed: [{ date: "2026-10-30", description: "KFC DHA", merchantName: "KFC", amount: 1450, type: "DEBIT",
                 category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food", possibleDuplicate: false }],
    });
  });

  it("returns NO_TRANSACTION for an OTP or promo", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([]);
    const r = await processSms("Your OTP is 482913. Do not share.", RECEIVED, []);
    expect(r.status).toBe("NO_TRANSACTION");
    expect(cat.categorizeBatch).not.toHaveBeenCalled();
  });

  it("returns FAILED with the error when the parser throws", async () => {
    pdf.parseTransactionsFromText.mockRejectedValue(new Error("Gemini 503"));
    expect(await processSms("PKR 10 at X", RECEIVED, [])).toMatchObject({ status: "FAILED", error: "Gemini 503", parsed: [] });
  });

  it("flags, but keeps, a transaction that already exists", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc]);
    cat.categorizeBatch.mockResolvedValue([catKfc]);
    const r = await processSms("PKR 1,450 at KFC DHA", RECEIVED, [
      { id: "t1", date: "2026-10-30", description: "KFC DHA", amount: 1450 },
    ]);
    expect(r.status).toBe("PENDING_REVIEW");
    expect(r.parsed[0]!.possibleDuplicate).toBe(true);
  });

  it("keeps both transactions from a two-transaction SMS", async () => {
    pdf.parseTransactionsFromText.mockResolvedValue([kfc, { ...kfc, description: "REFUND DARAZ", amount: 900, type: "CREDIT" }]);
    cat.categorizeBatch.mockResolvedValue([catKfc, { ...catKfc, description: "REFUND DARAZ", merchantName: "Daraz", category: "Shopping" }]);
    const r = await processSms("two txns", RECEIVED, []);
    expect(r.parsed.map((p) => [p.merchantName, p.type])).toEqual([["KFC", "DEBIT"], ["Daraz", "CREDIT"]]);
  });
});

describe("resolveDate", () => {
  it("keeps a plausible parsed date", () => {
    expect(resolveDate("2026-10-29", RECEIVED)).toBe("2026-10-29");
  });
  it("falls back to the received date for a wrong year", () => {
    expect(resolveDate("2023-10-30", RECEIVED)).toBe("2026-10-30");
  });
  it("falls back for garbage", () => {
    expect(resolveDate("30-Oct", RECEIVED)).toBe("2026-10-30");
    expect(resolveDate("", RECEIVED)).toBe("2026-10-30");
  });
});

describe("loadExistingForDedup", () => {
  it("loads the org's last 90 days as plain numbers", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "a", date: new Date("2026-10-01"), description: "X", amount: { toString: () => "12.5000" } }]);
    const rows = await loadExistingForDedup({ statementTransaction: { findMany } } as never, "org-1", new Date("2026-10-30T00:00:00Z"));
    expect(findMany.mock.calls[0]![0].where).toEqual({ organisationId: "org-1", date: { gte: new Date("2026-08-01T00:00:00Z") } });
    expect(rows).toEqual([{ id: "a", date: new Date("2026-10-01"), description: "X", amount: 12.5 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/sms-import.service.test.ts`
Expected: FAIL — cannot resolve `@/server/services/sms/sms-import.service`.

- [ ] **Step 3: Implement**

`server/services/sms/sms-import.service.ts`:

```ts
// One SMS → zero or more transactions for the review queue. Reuses the same
// redact → parse → dedupe → categorise steps as statement imports. Nothing here
// writes StatementTransactions: approval does (smsImport.approve).
import type { PrismaClient } from "@prisma/client";
import { redactPiiText } from "@/server/services/pii-redaction.service";
import { parseTransactionsFromText } from "@/server/services/pdf-statement.service";
import {
  deduplicateIncoming,
  detectDuplicates,
  type ExistingTransaction,
} from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";

export interface ParsedSmsTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  merchantName: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category: string;
  mccCode: string;
  mccLabel: string;
  possibleDuplicate: boolean;
}

export type ProcessSmsResult =
  | { status: "PENDING_REVIEW"; redactedText: string; parsed: ParsedSmsTransaction[] }
  | { status: "NO_TRANSACTION"; redactedText: string; parsed: [] }
  | { status: "FAILED"; redactedText: string; parsed: []; error: string };

const MAX_DATE_DRIFT_DAYS = 3;
const DEDUP_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Bank SMS often omit the year ("on 30-Oct"), so the AI can guess wrong.
// Trust the parsed date only when it is a real date close to when the SMS arrived.
export function resolveDate(parsed: string, receivedAt: Date): string {
  const fallback = localDateString(receivedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return fallback;
  const t = Date.parse(`${parsed}T12:00:00`);
  if (Number.isNaN(t)) return fallback;
  return Math.abs(t - receivedAt.getTime()) / DAY_MS > MAX_DATE_DRIFT_DAYS ? fallback : parsed;
}

export async function processSms(
  text: string,
  receivedAt: Date,
  existing: ExistingTransaction[],
): Promise<ProcessSmsResult> {
  const redactedText = redactPiiText(text);
  try {
    const raw = deduplicateIncoming(await parseTransactionsFromText(redactedText));
    if (raw.length === 0) return { status: "NO_TRANSACTION", redactedText, parsed: [] };

    const dated = raw.map((t) => ({ ...t, date: resolveDate(t.date, receivedAt) }));
    const dupes = new Set(detectDuplicates(dated, existing).duplicates.map((d) => d.incoming));
    const categories = await categorizeBatch(dated.map((t) => t.description));

    const parsed = dated.map((t, i): ParsedSmsTransaction => ({
      date: t.date,
      description: t.description,
      merchantName: categories[i]?.merchantName ?? t.description,
      amount: t.amount,
      type: t.type,
      category: categories[i]?.category ?? "Other",
      mccCode: categories[i]?.mccCode ?? "0000",
      mccLabel: categories[i]?.mccLabel ?? "Uncategorized",
      possibleDuplicate: dupes.has(t),
    }));
    return { status: "PENDING_REVIEW", redactedText, parsed };
  } catch (err) {
    return {
      status: "FAILED",
      redactedText,
      parsed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loadExistingForDedup(
  db: Pick<PrismaClient, "statementTransaction">,
  organisationId: string,
  now: Date,
): Promise<ExistingTransaction[]> {
  const rows = await db.statementTransaction.findMany({
    where: { organisationId, date: { gte: new Date(now.getTime() - DEDUP_WINDOW_DAYS * DAY_MS) } },
    select: { id: true, date: true, description: true, amount: true },
  });
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/sms-import/sms-import.service.test.ts`
Expected: PASS (9 tests). If "flags, but keeps" fails, check whether `detectDuplicates` (`server/services/statement-parser.service.ts:200`) puts the same object reference in `duplicates[].incoming`; if it copies, key the set on `` `${t.date}|${t.amount}|${t.description}` `` instead.

- [ ] **Step 5: Commit**

```bash
git add server/services/sms/sms-import.service.ts tests/unit/sms-import/sms-import.service.test.ts
git commit -m "feat(sms): parse one SMS into reviewable transactions"
```

---

### Task 6: Schema + poller

**Files:**
- Modify: `prisma/schema.prisma` (new enums/models, back-relations on `Organisation` and `StatementImportBatch`, `SMS` in `StatementFileType`)
- Create: migration via `prisma migrate dev`
- Create: `server/services/sms/sms-poller.service.ts`
- Modify: `instrumentation.ts` (replace the Task 4 block with access log + poller start)
- Test: `tests/unit/sms-import/sms-poller.test.ts`

**Interfaces:**
- Consumes: `readMessages`, `ChatDbError`, `PAGE_SIZE`, `MessageCursor`, `ChatMessage`, `checkChatDbAccess` (Task 3); `makeSenderMatcher` (Task 2); `processSms`, `loadExistingForDedup` (Task 5).
- Produces:
  - Prisma models `SmsSource`, `SmsImportItem`; enums `SmsSourceStatus`, `SmsImportStatus`; `StatementFileType.SMS`
  - `interface PollerDeps { db: PrismaClient; readMessages: typeof readMessages; processSms: typeof processSms; now: () => Date }`
  - `runSmsTick(deps: PollerDeps): Promise<void>`, `startSmsPoller(deps: PollerDeps): void`
  - constants `POLL_INTERVAL_MS = 60_000`, `FIRST_SYNC_LOOKBACK_DAYS = 7`, `MAX_PAGES_PER_TICK = 10`

- [ ] **Step 1: Add the schema**

In `prisma/schema.prisma`, add `SMS` to `enum StatementFileType` (after `EMAIL`). Add to `model Organisation` (next to the other relation lists):

```prisma
  smsSource             SmsSource?
  smsImportItems        SmsImportItem[]
```

Add to `model StatementImportBatch` (after `transactions StatementTransaction[]`):

```prisma
  smsImportItems SmsImportItem[]
```

Append after `model StatementTransaction`:

```prisma
// ─── SMS Import ───────────────────────────────────────────────────────────────

enum SmsSourceStatus {
  ACTIVE
  NO_ACCESS
  ERROR
}

enum SmsImportStatus {
  PENDING_REVIEW
  APPROVED
  DISMISSED
  FAILED
  NO_TRANSACTION
}

/// Reads bank SMS from the Mac's Messages database (macOS only).
model SmsSource {
  id             String          @id @default(cuid())
  organisationId String          @unique
  organisation   Organisation    @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  enabled        Boolean         @default(true)
  /// Bank sender ids as the user typed them; matched after normalising.
  senderIds      String[]
  /// Highest chat.db message.ROWID processed; null = never synced (7-day look-back).
  lastRowId      BigInt?
  lastSyncedAt   DateTime?
  status         SmsSourceStatus @default(ACTIVE)
  lastError      String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  items SmsImportItem[]
}

/// One bank SMS waiting for (or past) review. Never a transaction by itself.
model SmsImportItem {
  id             String                @id @default(cuid())
  organisationId String
  organisation   Organisation          @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  sourceId       String
  source         SmsSource             @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  messageGuid    String
  sender         String
  receivedAt     DateTime
  /// SMS body after PII redaction.
  text           String
  /// ParsedSmsTransaction[] (server/services/sms/sms-import.service.ts)
  parsedJson     Json
  status         SmsImportStatus       @default(PENDING_REVIEW)
  errorMessage   String?
  importBatchId  String?
  importBatch    StatementImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  @@unique([organisationId, messageGuid])
  @@index([organisationId, status])
}
```

Run: `npx prisma migrate dev --name sms_import`
Expected: new migration with `CREATE TYPE "SmsSourceStatus"`, `CREATE TABLE "SmsSource"`, `CREATE TABLE "SmsImportItem"`, `ALTER TYPE "StatementFileType" ADD VALUE 'SMS'`; "Your database is now in sync".

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Write the failing poller tests**

`tests/unit/sms-import/sms-poller.test.ts`:

```ts
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
    expect(db.smsSource.findMany.mock.calls[0]![0].where).toEqual({ enabled: true, status: { not: "NO_ACCESS" } });
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
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/sms-poller.test.ts`
Expected: FAIL — cannot resolve `@/server/services/sms/sms-poller.service`.

- [ ] **Step 4: Implement the poller**

`server/services/sms/sms-poller.service.ts`:

```ts
// Checks the Messages database every minute for new SMS from the user's bank
// senders and queues them for review. Started from instrumentation.ts on macOS.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ExistingTransaction } from "@/server/services/statement-parser.service";
import { ChatDbError, PAGE_SIZE, type ChatMessage, type MessageCursor, type readMessages } from "./messages-db";
import { makeSenderMatcher } from "./sender";
import { loadExistingForDedup, type processSms } from "./sms-import.service";

export const POLL_INTERVAL_MS = 60_000;
export const FIRST_SYNC_LOOKBACK_DAYS = 7;
export const MAX_PAGES_PER_TICK = 10;

export interface PollerDeps {
  db: PrismaClient;
  readMessages: typeof readMessages;
  processSms: typeof processSms;
  now: () => Date;
}

interface SourceRow {
  id: string;
  organisationId: string;
  senderIds: string[];
  lastRowId: bigint | null;
}

async function importOne(
  deps: PollerDeps,
  source: SourceRow,
  msg: ChatMessage,
  existing: ExistingTransaction[],
): Promise<void> {
  const { db } = deps;
  const already = await db.smsImportItem.findUnique({
    where: { organisationId_messageGuid: { organisationId: source.organisationId, messageGuid: msg.guid } },
    select: { id: true },
  });
  if (already) return;

  const base = {
    organisationId: source.organisationId,
    sourceId: source.id,
    messageGuid: msg.guid,
    sender: msg.sender,
    receivedAt: msg.receivedAt,
  };
  if (!msg.text) {
    await db.smsImportItem.create({
      data: { ...base, text: "", parsedJson: [], status: "FAILED", errorMessage: "Couldn't read this message's text" },
    });
    return;
  }
  const result = await deps.processSms(msg.text, msg.receivedAt, existing);
  await db.smsImportItem.create({
    data: {
      ...base,
      text: result.redactedText,
      parsedJson: result.parsed as unknown as Prisma.InputJsonValue,
      status: result.status,
      errorMessage: result.status === "FAILED" ? result.error : null,
    },
  });
}

// lastRowId only ever moves to a message that is fully handled, so a crash
// re-reads (harmless: unique guid) but never skips a bank SMS.
async function syncSource(deps: PollerDeps, source: SourceRow): Promise<void> {
  const matches = makeSenderMatcher(source.senderIds);
  const setRowId = (rowId: bigint) =>
    deps.db.smsSource.update({ where: { id: source.id }, data: { lastRowId: rowId } });

  let cursor: MessageCursor =
    source.lastRowId == null
      ? { since: new Date(deps.now().getTime() - FIRST_SYNC_LOOKBACK_DAYS * 86_400_000) }
      : { afterRowId: source.lastRowId };
  let existing: ExistingTransaction[] | null = null;

  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const messages = await deps.readMessages(cursor);
    if (messages.length === 0) return;

    let lastWritten: bigint | null = null;
    for (const msg of messages) {
      if (matches(msg.sender)) {
        existing ??= await loadExistingForDedup(deps.db, source.organisationId, deps.now());
        await importOne(deps, source, msg, existing);
        await setRowId(msg.rowId);
        lastWritten = msg.rowId;
      }
    }
    const last = messages[messages.length - 1]!.rowId;
    if (lastWritten !== last) await setRowId(last);
    cursor = { afterRowId: last };
    if (messages.length < PAGE_SIZE) return;
  }
}

let running = false;

export async function runSmsTick(deps: PollerDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    const sources = await deps.db.smsSource.findMany({
      where: { enabled: true, status: { not: "NO_ACCESS" } },
      select: { id: true, organisationId: true, senderIds: true, lastRowId: true },
    });
    for (const source of sources) {
      try {
        await syncSource(deps, source);
        await deps.db.smsSource.update({
          where: { id: source.id },
          data: { lastSyncedAt: deps.now(), status: "ACTIVE", lastError: null },
        });
      } catch (err) {
        const noAccess = err instanceof ChatDbError && err.kind === "no_access";
        await deps.db.smsSource.update({
          where: { id: source.id },
          data: {
            status: noAccess ? "NO_ACCESS" : "ERROR",
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  } finally {
    running = false;
  }
}

// Next dev re-runs instrumentation on reload; keep a single timer per process.
const g = globalThis as typeof globalThis & { __trivioSmsPoller?: NodeJS.Timeout };

export function startSmsPoller(deps: PollerDeps): void {
  if (g.__trivioSmsPoller) return;
  const tick = () => {
    runSmsTick(deps).catch((err) => console.error("[sms] tick failed:", err));
  };
  tick();
  g.__trivioSmsPoller = setInterval(tick, POLL_INTERVAL_MS);
  g.__trivioSmsPoller.unref?.();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/sms-import/sms-poller.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Start it from `instrumentation.ts`**

Replace the Task 4 block with:

```ts
  if (process.platform === "darwin") {
    try {
      const messagesDb = await import("@/server/services/sms/messages-db");
      const { processSms } = await import("@/server/services/sms/sms-import.service");
      const { startSmsPoller } = await import("@/server/services/sms/sms-poller.service");
      console.info("[sms] chat.db access:", await messagesDb.checkChatDbAccess());
      startSmsPoller({ db, readMessages: messagesDb.readMessages, processSms, now: () => new Date() });
    } catch (err) {
      console.error("[sms] poller failed to start:", err);
    }
  }
```

(`db` is already imported at the top of `register()`.)

- [ ] **Step 7: Typecheck and full test run**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add prisma server/services/sms/sms-poller.service.ts instrumentation.ts tests/unit/sms-import/sms-poller.test.ts
git commit -m "feat(sms): SmsSource/SmsImportItem schema and the chat.db poller"
```

---

### Task 7: `smsImport` tRPC router

**Files:**
- Create: `server/services/sms/suggest.ts`
- Create: `server/routers/smsImport.ts`
- Modify: `server/root.ts` (import + register `smsImport`)
- Test: `tests/unit/sms-import/suggest.test.ts`, `tests/unit/sms-import/router.test.ts`

**Interfaces:**
- Consumes: `orgProcedure`, `createTRPCRouter` (`@/server/trpc`); `readMessages`, `checkChatDbAccess`, `ChatDbError`, `ChatMessage` (Task 3); `normalizeSender`, `isPhoneNumber` (Task 2); `processSms`, `loadExistingForDedup`, `localDateString`, `ParsedSmsTransaction` (Task 5); `redactPiiText`.
- Produces (`trpc.smsImport.*`):
  - `getSource` → `{ platformSupported: boolean; approvedCount: number; source: null | { id: string; enabled: boolean; senderIds: string[]; status: "ACTIVE" | "NO_ACCESS" | "ERROR"; lastError: string | null; lastSyncedAt: Date | null } }`
  - `saveSource({ senderIds: string[] (0–20, each 1–64), enabled: boolean })` → `{ ok: true }`
  - `checkAccess` (mutation) → `"ok" | "no_access" | "missing" | "error"`
  - `suggestSenders` (query) → `SenderSuggestion[]` = `{ sender: string; lastText: string; count: number }[]`
  - `listItems({ statuses })` → `{ id; sender; receivedAt; text; status; errorMessage; parsed: ParsedSmsTransaction[] }[]`
  - `pendingCount` → `number`
  - `updateItem({ id, parsed })`, `approve({ ids })` → `{ approved: number; transactions: number }`, `dismiss({ ids })` → `{ dismissed: number }`, `retry({ id })` → `{ status }`

- [ ] **Step 1: Write the failing suggestion tests**

`tests/unit/sms-import/suggest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rankSenderSuggestions } from "@/server/services/sms/suggest";
import type { ChatMessage } from "@/server/services/sms/messages-db";

let row = 0;
const m = (sender: string, text: string | null, at = "2026-10-29T10:00:00Z"): ChatMessage => ({
  rowId: BigInt(++row), guid: `g${row}`, sender, text, receivedAt: new Date(at),
});
const upper = (s: string) => s.toUpperCase();

describe("rankSenderSuggestions", () => {
  it("suggests short codes and names, ranked by count, with the latest text redacted and trimmed", () => {
    const out = rankSenderSuggestions([
      m("HBL", "PKR 100 at A", "2026-10-28T10:00:00Z"),
      m("hbl", "PKR 200 at B ".repeat(10), "2026-10-29T10:00:00Z"),
      m("8250", "Rs. 50 debited"),
    ], upper);
    expect(out.map((s) => [s.sender, s.count])).toEqual([["HBL", 2], ["8250", 1]]);
    expect(out[0]!.lastText).toBe("PKR 200 AT B ".repeat(10).slice(0, 80));
  });

  it("drops personal phone numbers and email handles unless they mention money", () => {
    const out = rankSenderSuggestions([
      m("+923001234567", "see you at 5"),
      m("+923009999999", "USD 25.00 charged on card"),
      m("friend@icloud.com", "PKR 500 for lunch?"),
      m("HBL", null),
    ], upper);
    expect(out.map((s) => s.sender)).toEqual(["+923009999999"]);
  });

  it("returns at most 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => m(`BANK${i}`, "PKR 1"));
    expect(rankSenderSuggestions(many, upper)).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/suggest.test.ts`
Expected: FAIL — cannot resolve `@/server/services/sms/suggest`.

- [ ] **Step 3: Implement `suggest.ts`**

`server/services/sms/suggest.ts`:

```ts
import type { ChatMessage } from "./messages-db";
import { isPhoneNumber, normalizeSender } from "./sender";

export interface SenderSuggestion {
  sender: string;
  lastText: string;
  count: number;
}

const CURRENCY_AMOUNT = /(PKR|Rs\.?|USD|\$|£|€|AED)\s?[\d,]+(\.\d+)?/i;
const MAX_SUGGESTIONS = 20;
const PREVIEW_CHARS = 80;

// Banks send from short codes ("8250") or names ("HBL"). Personal numbers only
// count when the message mentions money; iMessage email handles never do.
export function rankSenderSuggestions(
  messages: ChatMessage[],
  redact: (text: string) => string,
): SenderSuggestion[] {
  const bySender = new Map<string, SenderSuggestion & { lastAt: number }>();
  for (const msg of messages) {
    if (!msg.text || msg.sender.includes("@")) continue;
    if (isPhoneNumber(msg.sender) && !CURRENCY_AMOUNT.test(msg.text)) continue;
    const key = normalizeSender(msg.sender);
    const at = msg.receivedAt.getTime();
    const prev = bySender.get(key);
    if (!prev) {
      bySender.set(key, { sender: msg.sender, lastText: msg.text, count: 1, lastAt: at });
    } else {
      prev.count++;
      if (at >= prev.lastAt) {
        prev.lastText = msg.text;
        prev.lastAt = at;
      }
    }
  }
  return [...bySender.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ sender, lastText, count }) => ({ sender, count, lastText: redact(lastText).slice(0, PREVIEW_CHARS) }));
}
```

Run: `npx vitest run tests/unit/sms-import/suggest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write the failing router tests**

`tests/unit/sms-import/router.test.ts`:

```ts
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
  it("creates one SMS batch with every parsed row and marks items APPROVED", async () => {
    db.smsImportItem.findMany.mockResolvedValue([
      { id: "i1", parsedJson: [txn] },
      { id: "i2", parsedJson: [{ ...txn, merchantName: "Daraz", amount: 900, type: "CREDIT" }] },
    ]);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 2 });
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });

    expect(await caller().approve({ ids: ["i1", "i2", "other-org"] })).toEqual({ approved: 2, transactions: 2 });

    expect(db.smsImportItem.findMany.mock.calls[0]![0].where).toEqual({
      id: { in: ["i1", "i2", "other-org"] }, organisationId: "org-1", status: "PENDING_REVIEW",
    });
    expect(db.statementImportBatch.create.mock.calls[0]![0].data).toMatchObject({
      organisationId: "org-1", fileType: "SMS", status: "DONE", transactionCount: 2,
    });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: ["i1", "i2"] }, organisationId: "org-1", status: "PENDING_REVIEW" },
      data: { status: "APPROVED", importBatchId: "b1" },
    });
    const rows = db.statementTransaction.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ organisationId: "org-1", importBatchId: "b1", merchantName: "Daraz", amount: 900, type: "CREDIT" });
    expect(rows[0]).not.toHaveProperty("possibleDuplicate");
  });

  it("does nothing when no pending items match", async () => {
    db.smsImportItem.findMany.mockResolvedValue([]);
    expect(await caller().approve({ ids: ["x"] })).toEqual({ approved: 0, transactions: 0 });
    expect(db.statementImportBatch.create).not.toHaveBeenCalled();
  });

  it("aborts with CONFLICT when another approval claimed the items first", async () => {
    db.smsImportItem.findMany.mockResolvedValue([{ id: "i1", parsedJson: [txn] }]);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    const err = await caller().approve({ ids: ["i1"] }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("CONFLICT");
    expect(db.statementTransaction.createMany).not.toHaveBeenCalled();
  });

  it("clears sample data before saving real transactions", async () => {
    db.smsImportItem.findMany.mockResolvedValue([{ id: "i1", parsedJson: [txn] }]);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: true });
    await caller().approve({ ids: ["i1"] });
    expect(db.statementTransaction.deleteMany.mock.calls[0]![0]).toEqual({ where: { organisationId: "org-1", isSampleData: true } });
    expect(db.organisation.update.mock.calls[0]![0]).toEqual({ where: { id: "org-1" }, data: { hasSampleData: false } });
  });
});

describe("smsImport.updateItem", () => {
  it("only edits pending items of this org", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 0 });
    const err = await caller().updateItem({ id: "i1", parsed: [txn] }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(db.smsImportItem.updateMany.mock.calls[0]![0].where).toEqual({ id: "i1", organisationId: "org-1", status: "PENDING_REVIEW" });
  });

  it("rejects a malformed date", async () => {
    const err = await caller().updateItem({ id: "i1", parsed: [{ ...txn, date: "30/10/2026" }] }).catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
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
    expect(await caller().retry({ id: "i1" })).toEqual({ status: "PENDING_REVIEW" });
    expect(db.smsImportItem.findFirst.mock.calls[0]![0].where).toEqual({ id: "i1", organisationId: "org-1", status: { in: ["FAILED", "NO_TRANSACTION"] } });
    expect(db.smsImportItem.update.mock.calls[0]![0]).toEqual({
      where: { id: "i1" }, data: { status: "PENDING_REVIEW", parsedJson: [txn], errorMessage: null },
    });
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run tests/unit/sms-import/router.test.ts`
Expected: FAIL — cannot resolve `@/server/routers/smsImport`.

- [ ] **Step 6: Implement the router**

`server/routers/smsImport.ts`:

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { ChatDbError, checkChatDbAccess, readMessages } from "@/server/services/sms/messages-db";
import { rankSenderSuggestions } from "@/server/services/sms/suggest";
import {
  loadExistingForDedup,
  localDateString,
  processSms,
  type ParsedSmsTransaction,
} from "@/server/services/sms/sms-import.service";
import { redactPiiText } from "@/server/services/pii-redaction.service";

const SUGGEST_LOOKBACK_DAYS = 30;
const SUGGEST_SCAN_LIMIT = 2000;

const parsedTxn = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  merchantName: z.string().min(1).max(200),
  amount: z.number().finite().nonnegative(),
  type: z.enum(["DEBIT", "CREDIT"]),
  category: z.string().min(1).max(100),
  mccCode: z.string().max(10),
  mccLabel: z.string().max(200),
  possibleDuplicate: z.boolean(),
});
const statusEnum = z.enum(["PENDING_REVIEW", "APPROVED", "DISMISSED", "FAILED", "NO_TRANSACTION"]);
const ids = z.array(z.string().min(1)).min(1).max(500);

export const smsImportRouter = createTRPCRouter({
  getSource: orgProcedure.query(async ({ ctx }) => {
    const source = await ctx.db.smsSource.findUnique({ where: { organisationId: ctx.organisationId } });
    const approvedCount = source
      ? await ctx.db.smsImportItem.count({ where: { organisationId: ctx.organisationId, status: "APPROVED" } })
      : 0;
    return {
      platformSupported: process.platform === "darwin",
      approvedCount,
      source: source && {
        id: source.id,
        enabled: source.enabled,
        senderIds: source.senderIds,
        status: source.status,
        lastError: source.lastError,
        lastSyncedAt: source.lastSyncedAt,
      },
    };
  }),

  saveSource: orgProcedure
    .input(z.object({ senderIds: z.array(z.string().trim().min(1).max(64)).max(20), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const senderIds = [...new Set(input.senderIds)];
      await ctx.db.smsSource.upsert({
        where: { organisationId: ctx.organisationId },
        create: { organisationId: ctx.organisationId, senderIds, enabled: input.enabled },
        update: { senderIds, enabled: input.enabled },
      });
      return { ok: true as const };
    }),

  checkAccess: orgProcedure.mutation(async ({ ctx }) => {
    const result = await checkChatDbAccess();
    if (result === "ok") {
      await ctx.db.smsSource.updateMany({
        where: { organisationId: ctx.organisationId },
        data: { status: "ACTIVE", lastError: null },
      });
    }
    return result;
  }),

  suggestSenders: orgProcedure.query(async () => {
    if (process.platform !== "darwin") return [];
    try {
      const since = new Date(Date.now() - SUGGEST_LOOKBACK_DAYS * 86_400_000);
      const messages = await readMessages({ since }, SUGGEST_SCAN_LIMIT);
      return rankSenderSuggestions(messages, redactPiiText);
    } catch (err) {
      if (err instanceof ChatDbError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  }),

  listItems: orgProcedure
    .input(z.object({ statuses: z.array(statusEnum).min(1) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.smsImportItem.findMany({
        where: { organisationId: ctx.organisationId, status: { in: input.statuses } },
        orderBy: { receivedAt: "desc" },
        take: 200,
        select: { id: true, sender: true, receivedAt: true, text: true, parsedJson: true, status: true, errorMessage: true },
      });
      return items.map(({ parsedJson, ...rest }) => ({ ...rest, parsed: parsedJson as unknown as ParsedSmsTransaction[] }));
    }),

  pendingCount: orgProcedure.query(({ ctx }) =>
    ctx.db.smsImportItem.count({ where: { organisationId: ctx.organisationId, status: "PENDING_REVIEW" } }),
  ),

  updateItem: orgProcedure
    .input(z.object({ id: z.string().min(1), parsed: z.array(parsedTxn).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.smsImportItem.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId, status: "PENDING_REVIEW" },
        data: { parsedJson: input.parsed as unknown as Prisma.InputJsonValue },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  // Claiming the items (status → APPROVED) before inserting makes a second,
  // concurrent approval of the same items match zero rows and roll back.
  approve: orgProcedure
    .input(z.object({ ids }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const organisationId = ctx.organisationId;
        const items = await tx.smsImportItem.findMany({
          where: { id: { in: input.ids }, organisationId, status: "PENDING_REVIEW" },
          select: { id: true, parsedJson: true },
        });
        if (items.length === 0) return { approved: 0, transactions: 0 };
        const rows = items.flatMap((it) => it.parsedJson as unknown as ParsedSmsTransaction[]);

        const batch = await tx.statementImportBatch.create({
          data: {
            organisationId,
            filename: `SMS import ${localDateString(new Date())}`,
            fileType: "SMS",
            status: "DONE",
            transactionCount: rows.length,
          },
        });
        const claimed = await tx.smsImportItem.updateMany({
          where: { id: { in: items.map((i) => i.id) }, organisationId, status: "PENDING_REVIEW" },
          data: { status: "APPROVED", importBatchId: batch.id },
        });
        if (claimed.count !== items.length) {
          throw new TRPCError({ code: "CONFLICT", message: "Some of these were already approved. Refresh and try again." });
        }

        const org = await tx.organisation.findUnique({ where: { id: organisationId }, select: { hasSampleData: true } });
        if (org?.hasSampleData) {
          await tx.statementTransaction.deleteMany({ where: { organisationId, isSampleData: true } });
          await tx.organisation.update({ where: { id: organisationId }, data: { hasSampleData: false } });
        }

        await tx.statementTransaction.createMany({
          data: rows.map((r) => ({
            organisationId,
            importBatchId: batch.id,
            date: new Date(r.date),
            description: r.description,
            merchantName: r.merchantName,
            amount: r.amount,
            type: r.type,
            category: r.category,
            mccCode: r.mccCode,
            mccLabel: r.mccLabel,
          })),
        });
        return { approved: items.length, transactions: rows.length };
      }),
    ),

  dismiss: orgProcedure
    .input(z.object({ ids }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.smsImportItem.updateMany({
        where: {
          id: { in: input.ids },
          organisationId: ctx.organisationId,
          status: { in: ["PENDING_REVIEW", "FAILED", "NO_TRANSACTION"] },
        },
        data: { status: "DISMISSED" },
      });
      return { dismissed: res.count };
    }),

  retry: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.smsImportItem.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId, status: { in: ["FAILED", "NO_TRANSACTION"] } },
        select: { id: true, text: true, receivedAt: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (!item.text) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This message has no readable text." });
      const existing = await loadExistingForDedup(ctx.db, ctx.organisationId, new Date());
      const result = await processSms(item.text, item.receivedAt, existing);
      await ctx.db.smsImportItem.update({
        where: { id: item.id },
        data: {
          status: result.status,
          parsedJson: result.parsed as unknown as Prisma.InputJsonValue,
          errorMessage: result.status === "FAILED" ? result.error : null,
        },
      });
      return { status: result.status };
    }),
});
```

In `server/root.ts`, add after the `watchlistsRouter` import:

```ts
import { smsImportRouter } from "@/server/routers/smsImport";
```

and in `appRouter`, after `watchlists: watchlistsRouter,`:

```ts
  smsImport: smsImportRouter,
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/unit/sms-import/`
Expected: PASS (all six files).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add server/routers/smsImport.ts server/root.ts server/services/sms/suggest.ts tests/unit/sms-import/suggest.test.ts tests/unit/sms-import/router.test.ts
git commit -m "feat(sms): smsImport router — setup, review, approve"
```

---

### Task 8: Let the desktop app open the Full Disk Access settings page

**Files:**
- Create: `desktop/external-url.ts`
- Modify: `desktop/main.ts:584-587`
- Test: `tests/unit/desktop-external-url.test.ts`

**Interfaces:**
- Produces: `PRIVACY_FULL_DISK_ACCESS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`, `isAllowedExternalUrl(url: string): boolean`. The renderer opens it with the existing `getDesktop()?.openExternal(url)` (`lib/desktop.ts`).

- [ ] **Step 1: Write the failing test**

`tests/unit/desktop-external-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PRIVACY_FULL_DISK_ACCESS_URL, isAllowedExternalUrl } from "@/desktop/external-url";

describe("isAllowedExternalUrl", () => {
  it("allows http(s) and exactly the Full Disk Access settings page", () => {
    expect(isAllowedExternalUrl("https://trivio-ai.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl(PRIVACY_FULL_DISK_ACCESS_URL)).toBe(true);
  });
  it("refuses every other scheme or settings pane", () => {
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")).toBe(false);
    expect(isAllowedExternalUrl(`${PRIVACY_FULL_DISK_ACCESS_URL}&x`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/desktop-external-url.test.ts`
Expected: FAIL — cannot resolve `@/desktop/external-url`.

- [ ] **Step 3: Implement and wire into `main.ts`**

`desktop/external-url.ts`:

```ts
// URLs the renderer may ask the main process to open. Besides web links, only
// the Full Disk Access pane (needed for SMS import) — never arbitrary schemes.
export const PRIVACY_FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

export function isAllowedExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === PRIVACY_FULL_DISK_ACCESS_URL;
}
```

In `desktop/main.ts`, add `import { isAllowedExternalUrl } from "./external-url";` with the other local imports, and change the handler at ~584:

```ts
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (isAllowedExternalUrl(url)) return shell.openExternal(url);
    return undefined;
  });
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/desktop-external-url.test.ts && npm run typecheck:desktop`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add desktop/external-url.ts desktop/main.ts tests/unit/desktop-external-url.test.ts
git commit -m "feat(desktop): allow opening the Full Disk Access settings pane"
```

---

### Task 9: Settings → SMS Import card

**Files:**
- Create: `app/(app)/settings/_components/sms-import-card.tsx`
- Modify: `app/(app)/settings/page.tsx` (import + render where the Email Import card was)

**Interfaces:**
- Consumes: `trpc.smsImport.getSource / saveSource / checkAccess / suggestSenders` (Task 7); `getDesktop` (`@/lib/desktop`); `Button`, `Input`; `toast` (`sonner`).

- [ ] **Step 1: Write the card**

`app/(app)/settings/_components/sms-import-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getDesktop } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Must match PRIVACY_FULL_DISK_ACCESS_URL in desktop/external-url.ts: the main
// process opens only that exact non-http URL.
const FULL_DISK_ACCESS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

type Access = "ok" | "no_access" | "missing" | "error";
const ACCESS_TEXT: Record<Exclude<Access, "ok">, string> = {
  no_access: "Trivio can't read Messages yet. Turn on Full Disk Access for Trivio, then click Check again.",
  missing: "Messages isn't set up on this Mac. Sign in to Messages with your Apple ID first.",
  error: "Couldn't read Messages. Try again in a minute.",
};

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function SmsImportCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.smsImport.getSource.useQuery();
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);

  const save = trpc.smsImport.saveSource.useMutation({
    onSuccess: () => utils.smsImport.getSource.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const check = trpc.smsImport.checkAccess.useMutation({
    onSuccess: (r) => {
      setAccess(r);
      void utils.smsImport.getSource.invalidate();
    },
  });
  const suggestions = trpc.smsImport.suggestSenders.useQuery(undefined, {
    enabled: showSuggest,
    retry: false,
  });

  if (!data?.platformSupported) return null;

  const source = data.source;
  const senders = source?.senderIds ?? [];
  const enabled = source?.enabled ?? true;
  const hasAccess = access === "ok" || (access === null && source?.status === "ACTIVE" && !!source.lastSyncedAt);
  const setSenders = (next: string[]) => save.mutate({ senderIds: next, enabled });
  const addSender = (id: string) => {
    const v = id.trim();
    if (v && !senders.includes(v)) setSenders([...senders, v]);
    setDraft("");
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <span className="text-sm">📱</span>
        </div>
        <div>
          <h2 className="font-semibold text-sm">SMS Import</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trivio reads your bank&apos;s SMS alerts on this Mac and asks you to approve each transaction.
          </p>
        </div>
      </div>

      <ol className="space-y-3 text-xs">
        <li className="space-y-1">
          <p className="font-semibold text-foreground">1. Send iPhone texts to this Mac</p>
          <p className="text-muted-foreground">
            On your iPhone: Settings → Messages → <span className="font-medium text-foreground">Text Message Forwarding</span> → turn on this Mac.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-semibold text-foreground">
            2. Allow Trivio to read Messages {hasAccess && <span className="text-emerald-600">✓</span>}
          </p>
          <p className="text-muted-foreground">
            System Settings → Privacy &amp; Security → <span className="font-medium text-foreground">Full Disk Access</span> → turn on Trivio.
          </p>
          <div className="flex gap-2">
            {getDesktop() && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => getDesktop()?.openExternal(FULL_DISK_ACCESS_URL)}>
                Open System Settings
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? "Checking…" : "Check again"}
            </Button>
          </div>
          {access && access !== "ok" && <p className="text-red-600">{ACCESS_TEXT[access]}</p>}
        </li>

        <li className="space-y-1.5">
          <p className="font-semibold text-foreground">
            3. Your bank&apos;s SMS senders {senders.length > 0 && <span className="text-emerald-600">✓</span>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {senders.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono">
                {s}
                <button type="button" aria-label={`Remove ${s}`} className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSenders(senders.filter((x) => x !== s))}>×</button>
              </span>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSender(draft); }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. HBL or 8250" className="h-7 text-xs" maxLength={64} />
            <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={!draft.trim()}>Add</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSuggest((v) => !v)}>
              Suggest senders
            </Button>
          </form>
          {showSuggest && (
            <div className="rounded-lg border border-border/40 bg-muted/30 p-2 space-y-1">
              {suggestions.isLoading && <p className="text-muted-foreground">Looking at the last 30 days…</p>}
              {suggestions.error && <p className="text-red-600">{suggestions.error.message}</p>}
              {suggestions.data?.length === 0 && <p className="text-muted-foreground">No likely bank senders found.</p>}
              {suggestions.data?.map((s) => (
                <label key={s.sender} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={senders.includes(s.sender)}
                    onChange={(e) => (e.target.checked ? addSender(s.sender) : setSenders(senders.filter((x) => x !== s.sender)))} />
                  <span>
                    <span className="font-mono font-medium text-foreground">{s.sender}</span>
                    <span className="text-muted-foreground"> · {s.count} msg · “{s.lastText}”</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </li>
      </ol>

      <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => save.mutate({ senderIds: senders, enabled: e.target.checked })} />
          Import SMS automatically
        </label>
        <span className={source?.status && source.status !== "ACTIVE" ? "text-red-600" : "text-muted-foreground"}>
          {source?.status === "NO_ACCESS" ? ACCESS_TEXT.no_access
            : source?.status === "ERROR" ? (source.lastError ?? ACCESS_TEXT.error)
            : source?.lastSyncedAt ? `Last checked ${timeAgo(new Date(source.lastSyncedAt))} · ${data.approvedCount} imported`
            : "Not checked yet"}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it**

In `app/(app)/settings/page.tsx` add `import { SmsImportCard } from "./_components/sms-import-card";` with the other component imports, and where the Email Import block was (just before `{/* Privacy & Data (GDPR) */}`):

```tsx
          {/* SMS Import (macOS only — the card hides itself elsewhere) */}
          <SmsImportCard />
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Check it in the app**

Run: `npm run dev`, open http://localhost:3000/settings.
Expected: the SMS Import card shows; **Check again** shows the red Full Disk Access message if the terminal lacks access (or ✓ if it has it); adding `HBL` shows a chip and survives a reload; **Suggest senders** lists senders or shows the access error; unticking "Import SMS automatically" survives a reload.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/_components/sms-import-card.tsx" "app/(app)/settings/page.tsx"
git commit -m "feat(sms): Settings card for SMS import setup"
```

---

### Task 10: Review banner and sheet on the Transactions page

**Files:**
- Create: `app/(app)/pf/transactions/_components/sms-review-sheet.tsx`
- Modify: `app/(app)/pf/transactions/page.tsx` (import + render `<SmsReviewBanner />` right after `<PageHeader … />`)

**Interfaces:**
- Consumes: `trpc.smsImport.pendingCount / listItems / updateItem / approve / dismiss / retry` (Task 7); `ParsedSmsTransaction` type (Task 5); `CategoryPicker` (`./category-picker`, props `{ value, onChange, triggerClassName }`); `Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter` (`@/components/ui/sheet`); `Button`, `Input`.
- Produces: `export function SmsReviewBanner()`.

- [ ] **Step 1: Write the component**

`app/(app)/pf/transactions/_components/sms-review-sheet.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import type { ParsedSmsTransaction } from "@/server/services/sms/sms-import.service";
import { CategoryPicker } from "./category-picker";

const POLL_MS = 60_000;

export function SmsReviewBanner() {
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = trpc.smsImport.pendingCount.useQuery(undefined, { refetchInterval: POLL_MS });
  if (count === 0 && !open) return null;
  return (
    <>
      {count > 0 && (
        <button type="button" onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm text-blue-800 hover:bg-blue-100">
          <span>📱 {count} transaction{count === 1 ? "" : "s"} from SMS to review</span>
          <span className="font-semibold">Review</span>
        </button>
      )}
      <SmsReviewSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function SmsReviewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const pending = trpc.smsImport.listItems.useQuery({ statuses: ["PENDING_REVIEW"] }, { enabled: open });
  const skipped = trpc.smsImport.listItems.useQuery({ statuses: ["NO_TRANSACTION", "FAILED"] }, { enabled: open });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const seen = useRef(new Set<string>());

  // New items start selected unless they look like duplicates. Refetches after
  // an edit keep whatever the user ticked or unticked.
  useEffect(() => {
    const items = pending.data;
    if (!items) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => items.some((i) => i.id === id)));
      for (const item of items) {
        if (seen.current.has(item.id)) continue;
        seen.current.add(item.id);
        if (!item.parsed.some((p) => p.possibleDuplicate)) next.add(item.id);
      }
      return next;
    });
  }, [pending.data]);

  const refresh = async () => {
    await Promise.all([
      utils.smsImport.listItems.invalidate(),
      utils.smsImport.pendingCount.invalidate(),
      utils.statementTransactions.list.invalidate(),
    ]);
  };
  const update = trpc.smsImport.updateItem.useMutation({
    onError: (e) => toast.error(e.message),
    onSettled: () => utils.smsImport.listItems.invalidate(),
  });
  const approve = trpc.smsImport.approve.useMutation({
    onSuccess: (r) => { toast.success(`Added ${r.transactions} transaction${r.transactions === 1 ? "" : "s"}`); void refresh(); },
    onError: (e) => { toast.error(e.message); void refresh(); },
  });
  const dismiss = trpc.smsImport.dismiss.useMutation({ onSuccess: () => void refresh() });
  const retry = trpc.smsImport.retry.useMutation({ onSuccess: () => void refresh(), onError: (e) => toast.error(e.message) });

  const busy = update.isPending || approve.isPending || dismiss.isPending;
  const ids = [...selected];
  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const editRow = (itemId: string, rows: ParsedSmsTransaction[], index: number, patch: Partial<ParsedSmsTransaction>) =>
    update.mutate({ id: itemId, parsed: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Transactions from SMS</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto py-4">
          {pending.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing to review.</p>}
          {pending.data?.map((item) => (
            <div key={item.id} className="rounded-xl border border-border/60 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label="Select" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p>
                  <p className="font-mono text-xs text-muted-foreground break-words">{item.text}</p>
                </div>
              </div>
              {item.parsed.map((row, i) => (
                <div key={i} className="grid grid-cols-[7.5rem_1fr_6rem] items-center gap-2 pl-6">
                  <Input type="date" defaultValue={row.date} className="h-7 text-xs"
                    onBlur={(e) => { if (e.target.value && e.target.value !== row.date) editRow(item.id, item.parsed, i, { date: e.target.value }); }} />
                  <Input defaultValue={row.merchantName} className="h-7 text-xs" maxLength={200}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== row.merchantName) editRow(item.id, item.parsed, i, { merchantName: v }); }} />
                  <div className="flex items-center gap-1">
                    <button type="button" title="Switch debit/credit"
                      className={`text-xs font-semibold ${row.type === "DEBIT" ? "text-red-500" : "text-emerald-500"}`}
                      onClick={() => editRow(item.id, item.parsed, i, { type: row.type === "DEBIT" ? "CREDIT" : "DEBIT" })}>
                      {row.type === "DEBIT" ? "−" : "+"}
                    </button>
                    <Input type="number" step="0.01" min="0" defaultValue={row.amount} className="h-7 text-xs tabular-nums"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== row.amount) editRow(item.id, item.parsed, i, { amount: v });
                      }} />
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    <CategoryPicker value={row.category} onChange={(c) => editRow(item.id, item.parsed, i, { category: c })}
                      triggerClassName="h-6 px-2 text-xs rounded-full bg-muted" />
                    {row.possibleDuplicate && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Possible duplicate</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {(skipped.data?.length ?? 0) > 0 && (
            <div className="pt-2">
              <button type="button" className="text-xs font-medium text-muted-foreground" onClick={() => setShowSkipped((v) => !v)}>
                {showSkipped ? "▾" : "▸"} Skipped ({skipped.data!.length})
              </button>
              {showSkipped && skipped.data!.map((item) => (
                <div key={item.id} className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-muted/40 p-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">
                      {item.status === "FAILED" ? `Couldn't read: ${item.errorMessage ?? "unknown error"}` : "No transaction found"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground break-words">{item.text}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" className="h-6 text-xs" disabled={retry.isPending || !item.text} onClick={() => retry.mutate({ id: item.id })}>Retry</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => dismiss.mutate({ ids: [item.id] })}>Hide</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SheetFooter className="gap-2 border-t pt-3">
          <Button variant="outline" disabled={busy || ids.length === 0} onClick={() => dismiss.mutate({ ids })}>
            Dismiss selected
          </Button>
          <Button disabled={busy || ids.length === 0} onClick={() => approve.mutate({ ids })}>
            {approve.isPending ? "Adding…" : `Approve selected (${ids.length})`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Render it**

In `app/(app)/pf/transactions/page.tsx` add `import { SmsReviewBanner } from "./_components/sms-review-sheet";` next to the other `./_components/*` imports, and directly after the closing `/>` of `<PageHeader … />`:

```tsx

      <SmsReviewBanner />
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (If a lint rule rejects importing a type from `@/server/...` in a client component, move `ParsedSmsTransaction` to `types/sms-import.ts`, re-export it from `sms-import.service.ts`, and import it from `@/types/sms-import` here.)

- [ ] **Step 4: Check it in the app**

With `npm run dev` running (and the terminal given Full Disk Access so the poller can read Messages), add your bank's sender in Settings and wait up to a minute.
Expected: the banner appears on `/pf/transactions`; the sheet lists the SMS with parsed rows; editing merchant, amount, date, sign and category survives closing and reopening the sheet; unticking an item survives an edit to another item; **Approve selected** adds the rows to the transactions table and the banner goes away; an OTP from the bank shows under **Skipped** with **Retry**.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/pf/transactions/_components/sms-review-sheet.tsx" "app/(app)/pf/transactions/page.tsx"
git commit -m "feat(sms): review and approve SMS transactions on the Transactions page"
```

---

### Task 11: Final verification

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm run typecheck:desktop && npm run lint && npm run test && npm run build`
Expected: all PASS. (`npm run build` is what surfaces Next lint errors — required before any release tag.)

- [ ] **Step 2: Packaged end-to-end**

Run: `npm run build:desktop`. Make sure `release/mac-arm64/Trivio.app` has Full Disk Access (re-add it if macOS dropped it after the rebuild) and open it from Finder.
Expected: Settings → SMS Import shows ✓ on step 2 after **Check again**; with your bank sender added, a real or test bank SMS appears in the Transactions review banner within ~60 s; approving it adds the transaction.

- [ ] **Step 3: Report**

Summarise test counts and the packaged-app result. Leave the branch `feat/sms-import` for review — do not merge or tag.
