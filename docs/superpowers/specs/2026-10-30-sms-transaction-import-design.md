# SMS Transaction Import — Design

Agreed 2026-10-30 in a brainstorming session, approved section by section. This is the source of truth the implementation plan works from.

## Purpose

The user's bank sends an SMS for every debit-card transaction. Through iPhone **Text Message Forwarding** those SMS also land in the Mac's Messages app. Trivio reads them from the local Messages database, extracts the transaction with the existing AI parser, and puts it in a **review queue**. Nothing becomes a `StatementTransaction` until the user approves it (CLAUDE.md: AI extraction always requires user confirmation).

This replaces the old email-forwarding import (`<token>@import.trivio-ai.com` → Cloudflare Email Worker → `/api/email/inbound`), which stopped working when Trivio became a local desktop app: there is no public URL for the worker to POST to.

## Decisions

| Area | Decision |
|---|---|
| Source | SMS only, read from `~/Library/Messages/chat.db`. Email/IMAP was considered and dropped |
| Platform | macOS only. On Windows and in the web build, the settings card is hidden and the poller never starts |
| Access | User grants **Full Disk Access** to Trivio.app (to the terminal app in `npm run dev`). The Next server child process inherits it |
| Reader | `/usr/bin/sqlite3 -readonly -json` (ships with macOS). Not `node:sqlite` (the packaged server runs on Electron 33's Node 20.18, which lacks it), not `better-sqlite3` (native rebuild against Electron's ABI) |
| Which messages | Only those whose sender matches a user-configured list of bank sender IDs |
| Confirmation | Always a review queue; never auto-saved |
| Stored text | The SMS body **after PII redaction** is stored, so the reviewer sees what the bank said next to the parsed row |
| First enable | Looks back 7 days |
| Cadence | Every 60 s while the app runs; AI only runs on new matching messages |
| Old email path | Removed entirely (route, worker, token column, UI) |

## 1. Data model

**`SmsSource`**, at most one per organisation:
- `id`, `organisationId` (unique, FK, cascade), `enabled Boolean @default(true)`
- `senderIds String[]`: as stored, display form; matching normalises both sides (lowercase, strip spaces, `+`, `-`)
- `lastRowId BigInt?`: high-water mark on `chat.db`'s `message.ROWID`. `null` means "never synced" → use the 7-day look-back
- `lastSyncedAt DateTime?`, `status SmsSourceStatus @default(ACTIVE)` (`ACTIVE | NO_ACCESS | ERROR`), `lastError String?`
- `createdAt`, `updatedAt`

**`SmsImportItem`**, one per bank SMS fetched:
- `id`, `organisationId` (FK, cascade), `sourceId` (FK → `SmsSource`, cascade)
- `messageGuid String`: `message.guid` from `chat.db`
- `sender String`, `receivedAt DateTime`
- `text String`: redacted SMS body
- `parsedJson Json`: `ParsedSmsTransaction[]`, each `{ date, description, merchantName, amount, type: "DEBIT" | "CREDIT", category, mccCode, mccLabel, possibleDuplicate: boolean }`
- `status SmsImportStatus` (`PENDING_REVIEW | APPROVED | DISMISSED | FAILED | NO_TRANSACTION`)
- `errorMessage String?`, `importBatchId String?` (FK → `StatementImportBatch`, set null)
- `createdAt`, `updatedAt`
- `@@unique([organisationId, messageGuid])`, `@@index([organisationId, status])`

**Changed:** `StatementFileType` gains `SMS`.

**Removed:** `Organisation.emailImportToken`. One migration does all of the above.

## 2. The poller

`instrumentation.ts` calls `startSmsPoller()` (in `server/services/sms-poller.service.ts`) when `process.platform === "darwin"` and `NEXT_RUNTIME === "nodejs"`. A `setInterval` of 60 s, guarded by an in-flight flag so ticks never overlap. Each tick loads every `SmsSource` with `enabled = true` and `status != NO_ACCESS`.

Per source:

1. **Read** (`server/services/messages-db.ts`): spawn `/usr/bin/sqlite3 -readonly -json <home>/Library/Messages/chat.db <SQL>` via `execFile` (no shell). The SQL is a constant template; the only interpolated values are integers (`lastRowId`, or an Apple-epoch timestamp for the first sync) validated with `Number.isSafeInteger`/`BigInt` before formatting. Selects `m.ROWID, m.guid, m.text, hex(m.attributedBody), m.date, h.id AS sender` from `message m JOIN handle h ON m.handle_id = h.ROWID` where `m.is_from_me = 0` and `m.ROWID > ?` (or `m.date > ?` on first sync), `ORDER BY m.ROWID LIMIT 200`. Apple `date` is nanoseconds since 2001-01-01 UTC; convert to a JS `Date`.
2. **Decode** (`server/services/attributed-body.ts`): when `text` is null/empty, `decodeAttributedBody(hex)` extracts the string from the typedstream blob: find the `NSString` class marker, skip to the `0x2B` (`+`) type byte, read the length (one byte, or `0x81` + 2-byte LE, or `0x82` + 4-byte LE), then read that many UTF-8 bytes. Returns `null` if the structure isn't found.
3. **Filter:** keep messages whose normalised `sender` is in the normalised `senderIds`.
4. **Parse** (`server/services/sms-import.service.ts`, `processSms(text)`): `redactPiiText` → `parseTransactionsFromText` → `deduplicateIncoming` → `categorizeBatch`. Zero results → `NO_TRANSACTION`.
5. **Duplicate flag:** `detectDuplicates` against the org's existing `StatementTransaction`s (same query the old route used). Matches are kept with `possibleDuplicate: true`, not dropped.
6. **Save:** walk the batch in `ROWID` order. For a matching message, upsert `SmsImportItem` on `(organisationId, messageGuid)`, then set `SmsSource.lastRowId` to that `ROWID`. Non-matching messages only advance an in-memory cursor; it is written with the next matching message's update, or once at the end of the batch. `lastRowId` therefore never passes an unprocessed match: a crash at worst re-reads some messages (harmless thanks to the unique key) and never skips one.

After the batch: set `lastSyncedAt = now`, `status = ACTIVE`, `lastError = null`.

**Errors:**
| Failure | Result |
|---|---|
| `sqlite3` stderr contains `authorization denied` / `unable to open database` and the file exists | `status = NO_ACCESS`; source skipped until `checkAccess` succeeds |
| `chat.db` does not exist | `status = ERROR`, `lastError = "Messages isn't set up on this Mac"` |
| Other `sqlite3` failure | `status = ERROR`, `lastError` = first stderr line; retried next tick |
| AI/parse throws for one message | Item `FAILED` with `errorMessage`; tick continues; `lastRowId` still advances |

## 3. API: `smsImport` tRPC router

`server/routers/smsImport.ts`, registered in the app router. Every procedure is `protectedProcedure` and scoped by `ctx.organisationId`.

- `getSource()` → source or `null`, plus `platformSupported: process.platform === "darwin"`
- `saveSource({ senderIds: string[] (1–20, each 1–64 chars), enabled: boolean })`: upsert
- `checkAccess()` → `"ok" | "no_access" | "missing"`; on `ok`, sets `status = ACTIVE` so the poller resumes
- `suggestSenders()` → up to 20 `{ sender, lastText (redacted, 80 chars), count }` from the last 30 days: non-phone-number handles, plus phone-number handles whose messages contain a currency amount (`/(PKR|Rs\.?|USD|\$|£|€|AED)\s?[\d,]+(\.\d+)?/i`)
- `listItems({ status })`, `pendingCount()`
- `updateItem({ id, parsed: ParsedSmsTransaction[] })`: only while `PENDING_REVIEW`
- `approve({ ids })`: one `db.$transaction`. Clear sample data (as `/api/pf/import/[batchId]/confirm` does), create a `StatementImportBatch` (`fileType: SMS`, `status: DONE`, `filename: "SMS import <date>"`), `createMany` the transactions, mark items `APPROVED` with `importBatchId`. Ignores ids not in `PENDING_REVIEW`.
- `dismiss({ ids })` → `DISMISSED`
- `retry({ id })`: re-runs `processSms` on the stored text for `FAILED`/`NO_TRANSACTION` items

## 4. UI

**Settings → "SMS Import" card** (`app/(app)/settings/_components/sms-import-card.tsx`) replaces the Email Import card. Rendered only when `platformSupported`. Three steps, each showing ✓ when done:
1. **iPhone:** instructions for Settings → Messages → Text Message Forwarding → enable this Mac.
2. **Full Disk Access:** *Open System Settings* button → new preload bridge `window.trivio.openPrivacySettings()` → main process `shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")`. Outside Electron, show the path as text instead. *Check again* button → `checkAccess`.
3. **Bank senders:** chip input plus a *Suggest senders* button that lists `suggestSenders` results with checkboxes.

Footer: enabled toggle and a status line ("Last checked 2 min ago · 14 imported", or the `NO_ACCESS`/`ERROR` message in red).

**Transactions page review** (`app/(app)/pf/transactions/_components/sms-review-sheet.tsx`): when `pendingCount > 0` (refetched every 60 s), a banner "📱 N transactions from SMS to review" opens a sheet. One card per item: redacted SMS text (muted, mono), sender and received time, and the parsed rows editable inline (date, merchant, amount, debit/credit, category using the existing category picker). An amber **Possible duplicate** badge marks flagged rows; those start unchecked, all others start checked. Footer: **Approve selected** / **Dismiss selected**. A collapsed **Skipped (n)** section lists `NO_TRANSACTION` and `FAILED` items with **Retry**.

## 5. Removing the email path

Deleted: `app/api/email/inbound/route.ts` and its test, `cloudflare/email-worker/`, `app/(app)/settings/_components/email-import-card.tsx`, the `EmailImportBanner` in `import-dialog.tsx`, `org.resetEmailImportToken`, the `emailImportToken` props and queries in `settings/page.tsx`, `pf/transactions/page.tsx`, `import-dialog.tsx`, `EMAIL_WEBHOOK_SECRET` from env validation and `.env.example`, and the `app/api/email/**` / worker comment entries in `vitest.config.ts`. `StatementFileType.EMAIL` stays (existing batches use it).

## 6. Testing

Unit tests (`tests/unit/sms-import/`, Vitest):
- `decodeAttributedBody`: fixtures for 1-byte, `0x81` and `0x82` length forms, non-ASCII text (e.g. `₨`), and a blob without `NSString` → `null`
- Apple-epoch conversion; sender normalisation and matching
- `messages-db`: `execFile` mocked: SQL contains no non-integer interpolation, stderr mapped to `NO_ACCESS` / `ERROR`, first-sync uses the date bound
- Poller tick with mocked reader and parser: filters by sender, writes the right statuses, advances `lastRowId` per message, skips `NO_ACCESS` sources, never overlaps
- Router: `approve` creates one SMS batch and its transactions and marks items `APPROVED`; ignores other orgs' items and non-pending items; `updateItem` rejects non-pending items

Manual, on the **packaged** build (the riskiest assumption, so done first, as a spike): grant Full Disk Access to Trivio.app and confirm the server child can run `sqlite3` on `chat.db`. Then send a test transaction SMS and confirm it appears in review within ~60 s.

Before tagging a release: `next build` (lint errors only show there).

## Out of scope

Email/IMAP import, Windows (Phone Link), Android, auto-approve rules, posting SMS transactions as double-entry journal entries (they are PF `StatementTransaction`s, like every other statement import).
