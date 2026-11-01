# Category Rules, Ambiguity Prompts and SMS Notifications — Design

Agreed 2026-11-01 in a brainstorming session, approved section by section. Builds on the SMS import (`docs/superpowers/specs/2026-10-30-sms-transaction-import-design.md`) on branch `feat/sms-import`. This is the source of truth the implementation plan works from.

## Purpose

SMS (and statement) categorisation is reliable for named merchants but guesses on transfers to phone numbers/accounts, ATM cash, wallet top-ups and cryptic POS codes — and never says when it is guessing. This feature:

1. **Flags ambiguous rows** and asks the user "where did this money go?".
2. **Remembers answers** as rules (opt-out checkbox), so a counterparty or merchant is asked about once.
3. Shows a **persistent in-app notification** for every SMS transaction that reaches review, closable only by its × button.

Rules apply to **SMS and statement imports**.

## Decisions

| Area | Decision |
|---|---|
| Learning | Answering offers "☑ Always use <category> for <label>", ticked by default; untick for one-offs |
| Scope | Rules apply to SMS and statement (PDF/CSV/image) imports |
| Statements | Save as today (no new review step); ambiguous rows saved with `needsCategory` and surfaced on the Transactions page |
| Matching | Exact match on counterparty (phone/account token) or normalised merchant name. No keyword/contains, no amount rules |
| Counterparty privacy | Numbers never reach the AI or stored text; a keyed-hash token is used instead (Approach A) |
| Notification trigger | When an SMS reaches `PENDING_REVIEW` (not on approve). `NO_TRANSACTION`/`FAILED` items get none |
| Notification close | Only the × in the **top-left** corner. Approve/dismiss/reload/restart do not remove it |
| Existing data | Old transactions start `needsCategory = false`; old SMS items start with notifications closed; old `[PHONE REDACTED]` text can only match merchant rules |
| Rule edits | Affect future imports only; never rewrite saved transactions |

Out of scope: notes on transactions, amount-based or keyword rules, a "new rule" form, retro-applying rules to history, macOS system notifications, notifications for statement imports.

## 1. Counterparty tokens

- `Organisation.counterpartySecret String?` — 32 random bytes (hex), generated lazily on first use, never sent anywhere.
- `server/services/counterparty-token.ts`: `tokenizeCounterparties(text, secret)` runs **before** the existing `redactPiiText` in the import paths only (SMS `processSms`, statement import route). It replaces:
  - phone numbers (PK mobile `03xx-xxxxxxx`, `+92…`, labelled phone, international) → `[PHONE ••4567 #<hash>]`
  - IBANs and labelled account numbers → `[ACCT ••1234 #<hash>]`
  where `<hash>` = first 12 hex chars of `HMAC-SHA256(secret, normalisedDigits)` and `••NNNN` is the last 4 digits. Normalisation: digits only; PK mobiles normalised to `92XXXXXXXXXX` so `0300…` and `+92300…` match.
- The token contains no full number, so the subsequent `redactPiiText` leaves it intact and the AI, the stored SMS text and statement descriptions only ever contain tokens. Card numbers stay redacted as today (cards are not counterparties).
- `extractRuleKey(description, merchantName)` → `{ kind: "COUNTERPARTY", matchKey: <hash>, label: "Transfers to ••4567" }` if the description contains a token (first token wins), else `{ kind: "MERCHANT", matchKey: normaliseMerchant(merchantName), label: merchantName }` when the merchant name is non-empty, else `null`. `normaliseMerchant`: lowercase, trim, collapse whitespace.
- Other callers of `redactPiiText` (chat, exports, etc.) are unchanged.

## 2. Data model (one migration)

**New `CategoryRule`:**
- `id`, `organisationId` (FK, cascade), `kind CategoryRuleKind` (`COUNTERPARTY | MERCHANT`), `matchKey String`, `label String`, `category String`
- `timesApplied Int @default(0)`, `lastAppliedAt DateTime?`, `createdAt`, `updatedAt`
- `@@unique([organisationId, kind, matchKey])`, `@@index([organisationId])`

**Changed:**
- `Organisation.counterpartySecret String?`
- `StatementTransaction`: `needsCategory Boolean @default(false)`, `ruleKind CategoryRuleKind?`, `ruleMatchKey String?`, `ruleLabel String?`, `@@index([organisationId, needsCategory])`
- `SmsImportItem.notificationClosedAt DateTime?`; the migration sets it to `now()` for all existing rows.
- `ParsedSmsTransaction` (JSON) gains `needsCategory: boolean`, `ruleKey: { kind, matchKey, label } | null`, `rememberRule: boolean` (default `true`), `userCategorized: boolean` (default `false`; set `true` by the review UI when the user picks a category for that row). Older parsed rows without these fields read as `needsCategory: false`, `ruleKey: null`, `userCategorized: false`.

## 3. Categorising with rules

`server/services/category-rules.service.ts` → `categorizeWithRules(db, organisationId, rows: { description, merchantName? }[])` returns per row `{ category, merchantName, mccCode, mccLabel, needsCategory, ruleKey, ruleApplied: boolean }`:

1. Compute `ruleKey` per row (merchant name from the parser when present).
2. Load matching rules in one query. Lookup order per row: `COUNTERPARTY` rule for a token in the description, then `MERCHANT` rule on the merchant name.
3. Rule hit → `category` from the rule, `needsCategory: false`, `ruleApplied: true`; Gemini is not called for that row. Increment `timesApplied`, set `lastAppliedAt` (one `updateMany`/`update` per rule used).
4. Remaining rows → one `categorizeBatch` call (unchanged service). Then `needsCategory = true` if any of:
   - category is `Transfers` or `Other`
   - the description contains a counterparty token
   - the categoriser fell back (no API key, quota exhausted, error, invalid output). `categorizeBatch` is extended to report this per row (`fallback: boolean`) without changing its other outputs.
5. After AI categorisation, `ruleKey` is recomputed with the AI's cleaned `merchantName` for merchant keys.

Callers: `processSms` (SMS) and both `categorizeBatch` call sites in `app/api/pf/import/route.ts` (statements) switch to `categorizeWithRules`; the statement route writes `needsCategory`, `ruleKind`, `ruleMatchKey`, `ruleLabel` on `createMany`, and the duplicate-confirm route carries them through `pendingDuplicatesJson`.

## 4. SMS review sheet

- Flagged rows show an amber **"Where did this money go?"** label beside the category picker.
- For any row with a `ruleKey`, choosing a category reveals "☑ Always use <category> for <label>" (ticked by default) bound to `rememberRule`; it travels in `updateItem`'s `parsed` payload (schema extended). Choosing a category on any row sets `userCategorized: true` and `needsCategory: false`.
- Approve is **not** blocked by unanswered flags; those rows are saved with `needsCategory: true`.
- **`approve`**, inside its existing `$transaction`, after inserting rows:
  1. For each inserted row with `ruleKey`, `rememberRule` and `userCategorized` (including correcting a row a rule had already categorised): upsert `CategoryRule` on `(organisationId, kind, matchKey)` with that category.
  2. For each rule upserted, update other `PENDING_REVIEW` items of the org whose parsed rows have the same `ruleKey` and `needsCategory: true`: set the row's category, `needsCategory: false`.
  3. Return `{ transactions, rulesSaved, alsoAppliedTo }`; the sheet toasts "Also applied to N other SMS" when `alsoAppliedTo > 0`.
- Inserted `StatementTransaction`s carry `needsCategory` and the rule key columns.

## 5. Transactions page

- Banner when `count(needsCategory) > 0`: **"N transactions need a category"**; clicking it applies a `needsCategory` filter to the list (`statementTransactions.list` gains `needsCategory?: boolean`; new `statementTransactions.needsCategoryCount`).
- Changing a category (existing category update procedure) on a row with a rule key shows the same ticked **Always use…** checkbox. The procedure gains `remember?: boolean`. On save:
  - set the category, `needsCategory = false`
  - if `remember`: upsert the rule, then update every **other** transaction of the org with the same `ruleKind`+`ruleMatchKey` **and `needsCategory = true`** to that category with `needsCategory = false`; return `alsoUpdated` → toast "Also updated N other transactions".
- Transactions with `needsCategory = false` are never changed by a rule.
- The checkbox also appears when correcting an unflagged row that has a rule key.

## 6. Notifications

- `smsImport.notifications()` → items of the org with `status` ever having reached review (`PENDING_REVIEW`, `APPROVED` or `DISMISSED`) and `notificationClosedAt IS NULL`, newest first, max 50, each with `{ id, receivedAt, firstRow, extraRows, flagged, ruleApplied }`.
- `smsImport.closeNotification({ id })` → `updateMany` scoped by `organisationId` setting `notificationClosedAt = now()`; count 0 → `NOT_FOUND`.
- `components/sms-notifications.tsx` (client), mounted once in the `(app)` layout, polls every 60 s; renders only on macOS-supported orgs (`getSource().platformSupported`).
- Stack fixed bottom-right; scrolls when more than 4. Each card: **× in the top-left corner** (the only close), 📱 title, body text:
  - flagged: "Rs 5,000 transfer to ••4567 — where did this go?" (amount formatted with the org currency; "transfer to <label>" from `ruleKey.label`, else merchant)
  - rule applied: "Rs 25,000 · Rent (remembered)"
  - otherwise: "Rs 2,450 · Imtiaz · Debit"
  - "and N more" when the SMS parsed into several rows
  - **Review →** link opens the SMS review sheet on the Transactions page (does not close the card).
- Approving, dismissing, retrying, reloading or restarting do not close a notification.

## 7. Settings → Category rules

- New card `app/(app)/settings/_components/category-rules-card.tsx`: lists rules (label, kind as "Transfer"/"Merchant", category via the existing category picker, `timesApplied`, `lastAppliedAt`), **Delete** per rule.
- Router `categoryRules`: `list`, `update({ id, category })`, `delete({ id })`, all `orgProcedure`, scoped by `organisationId`.
- No create form; edits/deletes affect future imports only.

## 8. Testing

Unit (Vitest):
- `tokenizeCounterparties`: same number → same token across formats (`0300-1234567`, `+923001234567`); different numbers → different tokens; output never contains the full digits; different secrets → different hashes; `redactPiiText` output for non-import callers unchanged; tokens survive `redactPiiText`.
- `extractRuleKey`: token beats merchant; merchant normalisation; empty → `null`.
- `categorizeWithRules`: rule hit skips `categorizeBatch`; counterparty rule beats merchant rule; each ambiguity trigger; `timesApplied` increments; other org's rules ignored.
- `approve`: saves rules only for answered + remembered rows; applies to other pending items with same key; does not touch unflagged rows; returns counts.
- Transactions category update with `remember`: updates only `needsCategory` rows with the same key in the same org.
- `notifications` / `closeNotification`: org-scoped; approve does not close; `NO_TRANSACTION`/`FAILED` excluded.
- `categoryRules` router: org-scoped list/update/delete.

Manual (packaged app): a Raast/IBFT SMS is flagged; its notification asks the question; answering with "Always use" ticked and approving saves the rule; the next SMS to the same number arrives categorised and its notification says "(remembered)"; closing via × is the only way it disappears, including across an app restart.
