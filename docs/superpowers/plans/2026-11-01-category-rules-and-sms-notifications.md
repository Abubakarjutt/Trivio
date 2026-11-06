# Category Rules, Ambiguity Prompts and SMS Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag imported transactions whose category is a guess and ask the user about them. Remember the answers as exact-match category rules for both SMS and statement imports. Show a persistent in-app notification for every SMS transaction that reaches review.

**Architecture:**
- Before redaction, import text gets a keyed-hash token in place of each counterparty number, e.g. `[PHONE ••4567 #<12 hex>]`. Rules can then match a counterparty without the number ever reaching the AI or storage.
- `categorizeWithRules` wraps the existing Gemini categoriser. Rule hits skip the AI. Rows that miss are categorised by the AI and flagged `needsCategory` when the category is ambiguous.
- When the user answers in the SMS review sheet or on the Transactions page, a `CategoryRule` is upserted. Other still-flagged rows with the same key get the same category.
- A polled notification stack in the app shell shows each SMS until its × is clicked.

**Tech Stack:** Next.js 15 App Router, tRPC v11 (`orgProcedure`), Prisma/Postgres, Vitest, React client components, Tailwind, sonner toasts, Node `crypto` (HMAC-SHA256).

**Spec:** `docs/superpowers/specs/2026-11-01-category-rules-and-sms-notifications-design.md`. The plan deviates on one point: the two new services live under `server/services/categorize/` instead of directly in `server/services/`, so the three new categorisation files sit together.

## Global Constraints

- Every query and write is scoped by `ctx.organisationId` or the import's `organisationId`. Never read or write another org's rows or rules.
- Money stays `Decimal(19,4)` in the DB. JSON amounts are numbers, non-negative and `< 1e15`, as today.
- AI extraction still needs user confirmation. SMS stay in the review queue. Statement imports keep their current flow, with no new review step.
- A rule never changes a transaction whose `needsCategory` is `false`, whether the user or a rule categorised it. Editing or deleting a rule affects future imports only.
- In the SMS path, full phone numbers, IBANs and labelled account numbers never reach Gemini or the stored SMS text.
  - Tokens look like `[PHONE ••NNNN #hhhhhhhhhhhh]` or `[ACCT ••NNNN #hhhhhhhhhhhh]`, with 12 lowercase hex characters.
  - Card numbers are never tokenized; the existing card redaction stays.
- The notification × sits in the **top-left** corner and is the only way to close a notification. Approve, dismiss, retry, reload and restart never close one.
- Old data: existing transactions start with `needsCategory = false`, and existing SMS items start with `notificationClosedAt = now()`.
- Prisma and DB commands:
  - Prefix them with `DATABASE_URL="postgresql://autoaccounts:autoaccounts@localhost:5432/autoaccounts"` (Docker Postgres).
  - Run `npx prisma migrate deploy` before generating a migration.
  - Generate migrations with `prisma migrate diff` + `migrate deploy`, never `migrate dev`.
  - Never reset the DB.
- `npm run typecheck` has 57 pre-existing errors in untouched test files (embedded-db, export/route, chat-pf-transaction, chat/route). "Typecheck passes" means no new errors in the files a task touches (`npm run typecheck 2>&1 | grep <paths>`). `npm run build` must pass.
- Work on branch `feat/sms-import`. Do not merge, push or tag.

## Review Focus

1. **Gemini rewrites or drops the token in a parsed SMS description** (e.g. returns `"Raast transfer"`). The row must still get the SMS's counterparty key from the hint. Pinned by the "hint" tests in Tasks 2 and 3.
2. **The same number written differently** (`0300-1234567`, `03001234567`, `+92 300 1234567`, `923001234567`) must produce one token, and a 16-digit card number must produce none. Pinned by Task 1 tests.
3. **Re-importing a statement that overlaps one imported before this feature.** Stored descriptions hold raw numbers while new ones hold tokens, yet the overlap must still be detected as duplicates. Existing descriptions are tokenized in memory before `detectDuplicates`. Pinned by the `tokenizeExisting` test in Task 5 and the dedup test in Task 3.
4. **Two rows in one approval answer the same counterparty with different categories.** The result must be one rule (the last answer wins) and no unique-constraint error. Pinned by Task 4.
5. **A notification for an item with no parsed rows.** An SMS hidden from Skipped is `DISMISSED` with `[]`, and it must be skipped rather than crash. Pinned by Task 9.

---

## File structure

| File | Responsibility |
|---|---|
| `server/services/categorize/counterparty-token.ts` (new) | Pure helpers: tokenize numbers, find tokens, derive rule keys |
| `server/services/categorize/category-rules.service.ts` (new) | Org secret, `categorizeWithRules`, `createImportCategorizer` |
| `server/services/categorize/statement-rows.ts` (new) | Pure helpers: build `StatementTransaction` row data; tokenize dedup inputs |
| `server/services/statement-categorization.service.ts` | Adds a `fallback` flag to each result |
| `server/services/pdf-statement.service.ts` | Prompt asks Gemini to copy tokens verbatim |
| `server/services/sms/sms-import.service.ts` | `processSms` takes an `ImportCategorizer`; new parsed-row fields |
| `server/services/sms/sms-poller.service.ts`, `instrumentation-node.ts` | Pass a per-org categorizer |
| `server/routers/smsImport.ts` | `updateItem` keeps server-owned fields; `approve` saves rules; notifications |
| `server/routers/statementTransactions.ts` | `needsCategory` filter and count; `updateCategory({ remember })` |
| `server/routers/categoryRules.ts` (new), `server/root.ts` | Rule list, update and delete |
| `app/api/pf/import/route.ts`, `app/api/pf/import/[batchId]/confirm/route.ts` | Statement imports use rules and store the flags |
| `app/(app)/pf/transactions/_components/sms-review-sheet.tsx` | Flag label, remember checkbox, open via `?smsReview=1` |
| `app/(app)/pf/transactions/_components/remember-rule-dialog.tsx` (new), `needs-category-banner.tsx` (new), `page.tsx` | Asking and remembering on the Transactions page |
| `components/sms-notifications.tsx` (new), `app/(app)/_components/app-shell.tsx` | Notification stack |
| `app/(app)/settings/_components/category-rules-card.tsx` (new), `settings/page.tsx` | Manage rules |
| `prisma/schema.prisma`, `prisma/migrations/20261101120000_category_rules/` | Data model |

---

### Task 1: Counterparty tokens and rule keys

**Files:**
- Create: `server/services/categorize/counterparty-token.ts`
- Test: `tests/unit/categorize/counterparty-token.test.ts`

**Interfaces:**
- Produces:
  - `type RuleKind = "COUNTERPARTY" | "MERCHANT"`
  - `interface RuleKey { kind: RuleKind; matchKey: string; label: string }`
  - `tokenizeCounterparties(text: string, secret: string): string`
  - `findTokens(text: string): string[]` returns full token strings, in order
  - `hasCounterpartyToken(text: string): boolean`
  - `normaliseMerchant(name: string): string`
  - `candidateRuleKeys(description: string, merchantName: string, hint?: string | null): RuleKey[]` returns the counterparty key first
  - `extractRuleKey(description: string, merchantName: string, hint?: string | null): RuleKey | null`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/categorize/counterparty-token.test.ts
import { describe, expect, it } from "vitest";
import {
  candidateRuleKeys,
  extractRuleKey,
  findTokens,
  hasCounterpartyToken,
  normaliseMerchant,
  tokenizeCounterparties,
} from "@/server/services/categorize/counterparty-token";
import { redactPiiText } from "@/server/services/pii-redaction.service";

const S = "a".repeat(64);
const tok = (t: string) => tokenizeCounterparties(t, S);

describe("tokenizeCounterparties", () => {
  it("gives one token for the same PK mobile in every format", () => {
    const forms = ["0300-1234567", "03001234567", "+92 300 1234567", "923001234567", "+923001234567"];
    const tokens = forms.map((f) => findTokens(tok(`Raast to ${f} done`))[0]);
    expect(tokens[0]).toMatch(/^\[PHONE ••4567 #[0-9a-f]{12}\]$/);
    expect(new Set(tokens).size).toBe(1);
  });

  it("gives different numbers different tokens and never keeps the digits", () => {
    const a = tok("IBFT to 03001234567");
    const b = tok("IBFT to 03217654321");
    expect(findTokens(a)[0]).not.toBe(findTokens(b)[0]);
    expect(a).not.toContain("1234567");
    expect(a).not.toContain("0300");
  });

  it("depends on the secret", () => {
    expect(findTokens(tokenizeCounterparties("to 03001234567", "b".repeat(64)))[0]).not.toBe(findTokens(tok("to 03001234567"))[0]);
  });

  it("tokenizes IBANs and labelled account numbers as ACCT, keeping the label", () => {
    expect(tok("sent to PK36SCBL0000001123456702")).toMatch(/sent to \[ACCT ••6702 #[0-9a-f]{12}\]/);
    expect(tok("Transfer to A/C No. 1234-5678-9012")).toMatch(/A\/C No\. \[ACCT ••9012 #[0-9a-f]{12}\]/);
  });

  it("leaves card numbers and masked accounts alone", () => {
    expect(tok("Card 4111 1111 1111 1111 used")).toBe("Card 4111 1111 1111 1111 used");
    expect(tok("A/C ****1234 debited")).toBe("A/C ****1234 debited");
  });

  it("is idempotent, even when a hash is all digits, and tokens survive redactPiiText", () => {
    const once = tok("Raast to 03001234567");
    expect(tok(once)).toBe(once);
    expect(tok("[PHONE ••4567 #a03001234567]")).toBe("[PHONE ••4567 #a03001234567]");
    expect(redactPiiText(once)).toBe(once);
  });
});

describe("rule keys", () => {
  const t = findTokens(tok("to 03001234567"))[0]!;
  const hash = t.match(/#([0-9a-f]{12})/)![1];

  it("prefers the counterparty token over the merchant", () => {
    expect(extractRuleKey(`Raast ${t}`, "Raast")).toEqual({ kind: "COUNTERPARTY", matchKey: hash, label: "Transfers to ••4567" });
    expect(candidateRuleKeys(`Raast ${t}`, "Raast").map((k) => k.kind)).toEqual(["COUNTERPARTY", "MERCHANT"]);
  });

  it("uses the hint when the description has no token", () => {
    expect(extractRuleKey("Raast transfer", "Raast", t)).toMatchObject({ kind: "COUNTERPARTY", matchKey: hash });
  });

  it("labels ACCT tokens as account transfers", () => {
    const a = findTokens(tok("to PK36SCBL0000001123456702"))[0]!;
    expect(extractRuleKey(a, "")?.label).toBe("Transfers to account ••6702");
  });

  it("falls back to the normalised merchant name", () => {
    expect(extractRuleKey("POS DARAZ PK", "  Daraz   Online ")).toEqual({ kind: "MERCHANT", matchKey: "daraz online", label: "Daraz Online" });
    expect(normaliseMerchant("  KFC   DHA ")).toBe("kfc dha");
  });

  it("returns null with neither token nor merchant", () => {
    expect(extractRuleKey("x", "  ")).toBeNull();
    expect(hasCounterpartyToken("plain text")).toBe(false);
    expect(hasCounterpartyToken(t)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/categorize/counterparty-token.test.ts`
Expected: FAIL. The module `@/server/services/categorize/counterparty-token` doesn't exist.

- [ ] **Step 3: Implement**

```ts
// server/services/categorize/counterparty-token.ts
// Replaces counterparty phone/account numbers with a stable private token
// ("[PHONE ••4567 #0a1b2c3d4e5f]") before import text is redacted or sent to
// the AI. The hash is keyed with a per-organisation secret, so the same number
// always gives the same token here and a meaningless one anywhere else — which
// lets category rules match a counterparty without storing the number.
import { createHmac } from "node:crypto";

export type RuleKind = "COUNTERPARTY" | "MERCHANT";
export interface RuleKey {
  kind: RuleKind;
  matchKey: string;
  label: string;
}

const TOKEN_RE = /\[(PHONE|ACCT) ••([0-9A-Z]{4}) #([0-9a-f]{12})\]/g;
const IBAN_RE = /\b[A-Z]{2}\d{2} ?(?:[A-Z0-9] ?){11,30}\b/g;
const LABELLED_ACCT_RE = /(a(?:cc(?:ount)?|\/c)\.?\s*(?:no\.?|number|#|:)?\s*:?\s*)(\d[\d -]{2,18}\d)/gi;
const LABELLED_PHONE_RE = /((?:phone|tel(?:ephone)?|mobile|mob)\s*:?\s*)(\+?\d[\d\s()-]{6,18}\d)/gi;
// Pakistani mobiles: 03XX-XXXXXXX, +92 3XX XXXXXXX, 923XXXXXXXXX. Not inside a
// longer number or word (e.g. an existing token's hex hash).
const PK_MOBILE_RE = /(?<![\w+#])(?:\+?92[\s-]?|0)3\d{2}[\s-]?\d{7}(?!\w)/g;
const INTL_PHONE_RE = /\+\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,6}/g;

function normaliseNumber(raw: string): string {
  let n = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^03\d{9}$/.test(n)) n = `92${n.slice(1)}`;
  return n;
}

function makeToken(kind: "PHONE" | "ACCT", raw: string, secret: string): string {
  const n = normaliseNumber(raw);
  const hash = createHmac("sha256", secret).update(n).digest("hex").slice(0, 12);
  return `[${kind} ••${n.slice(-4)} #${hash}]`;
}

export function tokenizeCounterparties(text: string, secret: string): string {
  return text
    .replace(IBAN_RE, (m) => makeToken("ACCT", m, secret))
    .replace(LABELLED_ACCT_RE, (_, label: string, num: string) => label + makeToken("ACCT", num, secret))
    .replace(LABELLED_PHONE_RE, (_, label: string, num: string) => label + makeToken("PHONE", num, secret))
    .replace(PK_MOBILE_RE, (m) => makeToken("PHONE", m, secret))
    .replace(INTL_PHONE_RE, (m) => makeToken("PHONE", m, secret));
}

export function findTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[0]);
}

export function hasCounterpartyToken(text: string): boolean {
  return findTokens(text).length > 0;
}

export function normaliseMerchant(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenKey(token: string): RuleKey | null {
  const m = new RegExp(TOKEN_RE.source).exec(token);
  if (!m) return null;
  const label = m[1] === "PHONE" ? `Transfers to ••${m[2]}` : `Transfers to account ••${m[2]}`;
  return { kind: "COUNTERPARTY", matchKey: m[3]!, label };
}

export function candidateRuleKeys(description: string, merchantName: string, hint?: string | null): RuleKey[] {
  const keys: RuleKey[] = [];
  const token = findTokens(description)[0] ?? (hint ? findTokens(hint)[0] : undefined);
  const cp = token ? tokenKey(token) : null;
  if (cp) keys.push(cp);
  const m = normaliseMerchant(merchantName);
  if (m) keys.push({ kind: "MERCHANT", matchKey: m, label: merchantName.trim().replace(/\s+/g, " ") });
  return keys;
}

export function extractRuleKey(description: string, merchantName: string, hint?: string | null): RuleKey | null {
  return candidateRuleKeys(description, merchantName, hint)[0] ?? null;
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run tests/unit/categorize/counterparty-token.test.ts`
Expected: PASS.

If the idempotency test or the `redactPiiText` survival test fails, a regex is matching inside an existing token. Tighten that regex; do not change the token format.

- [ ] **Step 5: Commit**

```bash
git add server/services/categorize/counterparty-token.ts tests/unit/categorize/counterparty-token.test.ts
git commit -m "feat(categorize): stable private tokens for counterparty numbers"
```

---

### Task 2: Data model, categoriser fallback flag, and `categorizeWithRules`

**Files:**
- Modify: `prisma/schema.prisma` (Organisation, StatementTransaction, SmsImportItem, new enum and model)
- Create: `prisma/migrations/20261101120000_category_rules/migration.sql`
- Modify: `server/services/statement-categorization.service.ts`
- Create: `server/services/categorize/category-rules.service.ts`
- Test: `tests/unit/categorize/category-rules.test.ts`

**Interfaces:**
- Consumes from Task 1: `candidateRuleKeys`, `extractRuleKey`, `hasCounterpartyToken`, `tokenizeCounterparties`, `RuleKey`.
- Produces:
  - `CategorizationResult` gains `fallback: boolean`.
  - `interface RuleCategorization { merchantName: string; category: string; mccCode: string; mccLabel: string; needsCategory: boolean; ruleKey: RuleKey | null; ruleApplied: boolean }`
  - `interface CategorizeInput { description: string; merchantName?: string; counterpartyHint?: string | null }`
  - `interface ImportCategorizer { tokenize(text: string): string; categorize(rows: CategorizeInput[]): Promise<RuleCategorization[]> }`
  - `getCounterpartySecret(db, organisationId): Promise<string>`
  - `categorizeWithRules(db, organisationId, rows: CategorizeInput[]): Promise<RuleCategorization[]>`
  - `createImportCategorizer(db, organisationId): Promise<ImportCategorizer>`
  - Prisma:
    - new model `CategoryRule`
    - `StatementTransaction.needsCategory`, `ruleKind`, `ruleMatchKey`, `ruleLabel`
    - `SmsImportItem.notificationClosedAt`
    - `Organisation.counterpartySecret`

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`:

In `model Organisation`, add these next to the other relation lists:
```prisma
  counterpartySecret   String?
  categoryRules        CategoryRule[]
```

In `model StatementTransaction`, after `isSampleData`:
```prisma
  /// Imported with an ambiguous category (transfer/other/no AI); the user is asked.
  needsCategory  Boolean                  @default(false)
  /// What "Always use…" applies to (see CategoryRule). Null for manual/old rows.
  ruleKind       CategoryRuleKind?
  ruleMatchKey   String?
  ruleLabel      String?
```
and add this next to the existing `@@index` lines:
```prisma
  @@index([organisationId, needsCategory])
```

In `model SmsImportItem`, after `errorMessage`:
```prisma
  /// Set when the user closes this SMS's in-app notification (its × button).
  notificationClosedAt DateTime?
```

After the SMS Import models:
```prisma
// ─── Category rules ───────────────────────────────────────────────────────────

enum CategoryRuleKind {
  COUNTERPARTY
  MERCHANT
}

/// "Always use <category>" for a counterparty token hash or a normalised merchant name.
model CategoryRule {
  id             String           @id @default(cuid())
  organisationId String
  organisation   Organisation     @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  kind           CategoryRuleKind
  matchKey       String
  label          String
  category       String
  timesApplied   Int              @default(0)
  lastAppliedAt  DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@unique([organisationId, kind, matchKey])
  @@index([organisationId])
}
```

- [ ] **Step 2: Generate and apply the migration**

```bash
export DATABASE_URL="postgresql://autoaccounts:autoaccounts@localhost:5432/autoaccounts"
npx prisma migrate deploy
mkdir -p prisma/migrations/20261101120000_category_rules
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261101120000_category_rules/migration.sql
printf '\n-- Existing SMS should not all pop up as new notifications.\nUPDATE "SmsImportItem" SET "notificationClosedAt" = NOW() WHERE "notificationClosedAt" IS NULL;\n' >> prisma/migrations/20261101120000_category_rules/migration.sql
npx prisma migrate deploy
npx prisma generate
```
Open `migration.sql` and check three things:
- It only creates `CategoryRuleKind` and `CategoryRule`, adds the listed columns and the index, and ends with the `UPDATE`.
- It drops nothing.
- If it drops anything, stop and report BLOCKED.

- [ ] **Step 3: Add the `fallback` flag to `categorizeBatch`**

In `server/services/statement-categorization.service.ts`:
- Add `fallback: boolean;` to `interface CategorizationResult`.
- In `const fallback = (description: string): CategorizationResult => ({ … })`, add `fallback: true,`.
- In the success mapping (`return { description: desc, merchantName, mccCode: "0000", mccLabel: category, category };`), add `fallback: false`.

Then run `npx vitest run`. Wherever an existing test uses `toEqual` on a `CategorizationResult`, add the new field to the expectation. Change nothing else.

- [ ] **Step 4: Write the failing tests**

```ts
// tests/unit/categorize/category-rules.test.ts
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cat = vi.hoisted(() => ({ categorizeBatch: vi.fn() }));
vi.mock("@/server/services/statement-categorization.service", () => cat);

import { categorizeWithRules, createImportCategorizer, getCounterpartySecret } from "@/server/services/categorize/category-rules.service";
import { findTokens, tokenizeCounterparties } from "@/server/services/categorize/counterparty-token";
import { makeDb, type MockDb } from "../outreach/helpers";

const SECRET = "c".repeat(64);
const token = findTokens(tokenizeCounterparties("to 03001234567", SECRET))[0]!;
const hash = token.match(/#([0-9a-f]{12})/)![1]!;
let db: MockDb;
const asDb = () => db as unknown as PrismaClient;
const ai = (category: string, merchantName = "Shop", fallback = false) => ({ description: "d", merchantName, mccCode: "0000", mccLabel: category, category, fallback });

beforeEach(() => {
  db = makeDb();
  cat.categorizeBatch.mockReset();
  db.categoryRule.findMany.mockResolvedValue([]);
  db.categoryRule.update.mockResolvedValue({});
});

describe("categorizeWithRules", () => {
  it("applies a counterparty rule without calling the AI", async () => {
    db.categoryRule.findMany.mockResolvedValueOnce([{ id: "r1", kind: "COUNTERPARTY", matchKey: hash, label: "Transfers to ••4567", category: "Rent" }]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: `Raast ${token}` }]);
    expect(r).toMatchObject({ category: "Rent", needsCategory: false, ruleApplied: true, ruleKey: { kind: "COUNTERPARTY", matchKey: hash } });
    expect(cat.categorizeBatch).not.toHaveBeenCalled();
    expect(db.categoryRule.findMany.mock.calls[0]![0].where.organisationId).toBe("org-1");
    expect(db.categoryRule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { timesApplied: { increment: 1 }, lastAppliedAt: expect.any(Date) },
    });
  });

  it("uses the counterparty hint when the parsed description lost the token", async () => {
    db.categoryRule.findMany.mockResolvedValueOnce([{ id: "r1", kind: "COUNTERPARTY", matchKey: hash, label: "x", category: "Rent" }]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: "Raast transfer", counterpartyHint: token }]);
    expect(r).toMatchObject({ category: "Rent", ruleApplied: true });
  });

  it("applies a merchant rule using the AI's cleaned merchant name", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Shopping", "Daraz")]);
    db.categoryRule.findMany
      .mockResolvedValueOnce([]) // before the AI: no keys match
      .mockResolvedValueOnce([{ id: "r2", kind: "MERCHANT", matchKey: "daraz", label: "Daraz", category: "Household" }]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: "POS DARAZ PK 123" }]);
    expect(r).toMatchObject({ category: "Household", needsCategory: false, ruleApplied: true, merchantName: "Daraz" });
  });

  it.each([
    ["Transfers", "Raast", false],
    ["Other", "ATM", false],
    ["Groceries", "Imtiaz", true],
  ])("flags %s (fallback=%s) as needing a category", async (category, merchant, fb) => {
    cat.categorizeBatch.mockResolvedValue([ai(category, merchant, fb)]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: merchant }]);
    expect(r).toMatchObject({ needsCategory: true, ruleApplied: false, category });
  });

  it("flags a row with a counterparty token even when the AI is confident", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Bills & Utilities", "Raast")]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: `Raast ${token}` }]);
    expect(r).toMatchObject({ needsCategory: true, ruleKey: { kind: "COUNTERPARTY", matchKey: hash } });
  });

  it("does not flag a confident merchant row", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Groceries", "Imtiaz")]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: "POS IMTIAZ" }]);
    expect(r).toMatchObject({ needsCategory: false, ruleKey: { kind: "MERCHANT", matchKey: "imtiaz" } });
  });

  it("returns [] for no rows", async () => {
    expect(await categorizeWithRules(asDb(), "org-1", [])).toEqual([]);
  });
});

describe("getCounterpartySecret / createImportCategorizer", () => {
  it("reuses an existing secret", async () => {
    db.organisation.findUnique.mockResolvedValue({ counterpartySecret: SECRET });
    expect(await getCounterpartySecret(asDb(), "org-1")).toBe(SECRET);
    expect(db.organisation.updateMany).not.toHaveBeenCalled();
  });

  it("creates one only when empty, and re-reads to agree with a racing writer", async () => {
    db.organisation.findUnique.mockResolvedValueOnce({ counterpartySecret: null }).mockResolvedValueOnce({ counterpartySecret: "winner" });
    db.organisation.updateMany.mockResolvedValue({ count: 0 });
    expect(await getCounterpartySecret(asDb(), "org-1")).toBe("winner");
    expect(db.organisation.updateMany.mock.calls[0]![0].where).toEqual({ id: "org-1", counterpartySecret: null });
  });

  it("binds tokenize to the org secret", async () => {
    db.organisation.findUnique.mockResolvedValue({ counterpartySecret: SECRET });
    const c = await createImportCategorizer(asDb(), "org-1");
    expect(c.tokenize("to 03001234567")).toBe(`to ${token}`);
  });
});
```

- [ ] **Step 5: Run the tests to check they fail**

Run: `npx vitest run tests/unit/categorize/category-rules.test.ts`
Expected: FAIL because the module doesn't exist.

- [ ] **Step 6: Implement**

```ts
// server/services/categorize/category-rules.service.ts
// Categorises imported transactions: the user's remembered rules first (no AI
// call), then the Gemini categoriser for the rest, flagging rows whose category
// is a guess so the user is asked "where did this money go?".
import { randomBytes } from "node:crypto";
import type { CategoryRule, PrismaClient } from "@prisma/client";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import {
  candidateRuleKeys,
  extractRuleKey,
  hasCounterpartyToken,
  tokenizeCounterparties,
  type RuleKey,
} from "./counterparty-token";

type Db = Pick<PrismaClient, "organisation" | "categoryRule">;

export interface CategorizeInput {
  description: string;
  merchantName?: string;
  /** A counterparty token from the surrounding SMS, for when the parsed description lost it. */
  counterpartyHint?: string | null;
}

export interface RuleCategorization {
  merchantName: string;
  category: string;
  mccCode: string;
  mccLabel: string;
  needsCategory: boolean;
  ruleKey: RuleKey | null;
  ruleApplied: boolean;
}

export interface ImportCategorizer {
  tokenize(text: string): string;
  categorize(rows: CategorizeInput[]): Promise<RuleCategorization[]>;
}

const AMBIGUOUS_CATEGORIES = new Set(["Transfers", "Other"]);
const keyOf = (k: { kind: string; matchKey: string }) => `${k.kind}:${k.matchKey}`;

export async function getCounterpartySecret(db: Db, organisationId: string): Promise<string> {
  const org = await db.organisation.findUnique({ where: { id: organisationId }, select: { counterpartySecret: true } });
  if (org?.counterpartySecret) return org.counterpartySecret;
  const secret = randomBytes(32).toString("hex");
  // Only fill an empty secret, then re-read: two first imports racing agree on one.
  await db.organisation.updateMany({ where: { id: organisationId, counterpartySecret: null }, data: { counterpartySecret: secret } });
  const again = await db.organisation.findUnique({ where: { id: organisationId }, select: { counterpartySecret: true } });
  return again?.counterpartySecret ?? secret;
}

async function loadRules(db: Db, organisationId: string, keys: RuleKey[]): Promise<Map<string, CategoryRule>> {
  if (keys.length === 0) return new Map();
  const rules = await db.categoryRule.findMany({
    where: { organisationId, OR: keys.map((k) => ({ kind: k.kind, matchKey: k.matchKey })) },
  });
  return new Map(rules.map((r) => [keyOf(r), r]));
}

function fromRule(rule: CategoryRule, merchantName: string, ruleKey: RuleKey | null): RuleCategorization {
  return { merchantName, category: rule.category, mccCode: "0000", mccLabel: rule.category, needsCategory: false, ruleKey, ruleApplied: true };
}

export async function categorizeWithRules(db: Db, organisationId: string, rows: CategorizeInput[]): Promise<RuleCategorization[]> {
  if (rows.length === 0) return [];
  const out: (RuleCategorization | undefined)[] = new Array(rows.length);
  const used = new Map<string, number>(); // rule id → times applied

  // 1. Rules on what we know before the AI (token, hint, a merchant name if given).
  const before = rows.map((r) => candidateRuleKeys(r.description, r.merchantName ?? "", r.counterpartyHint));
  const rulesBefore = await loadRules(db, organisationId, before.flat());
  rows.forEach((r, i) => {
    const hit = before[i]!.map((k) => rulesBefore.get(keyOf(k))).find(Boolean);
    if (!hit) return;
    used.set(hit.id, (used.get(hit.id) ?? 0) + 1);
    out[i] = fromRule(hit, r.merchantName || r.description, before[i]![0] ?? null);
  });

  // 2. The AI for the rest, then merchant rules on its cleaned merchant names.
  const rest = rows.map((_, i) => i).filter((i) => !out[i]);
  if (rest.length > 0) {
    const ai = await categorizeBatch(rest.map((i) => rows[i]!.description));
    const merchantOf = (j: number) => ai[j]?.merchantName || rows[rest[j]!]!.merchantName || rows[rest[j]!]!.description;
    const after = rest.map((i, j) => extractRuleKey(rows[i]!.description, merchantOf(j), rows[i]!.counterpartyHint));
    const merchantKeys = after.filter((k): k is RuleKey => k?.kind === "MERCHANT");
    const rulesAfter = await loadRules(db, organisationId, merchantKeys);
    rest.forEach((i, j) => {
      const key = after[j] ?? null;
      const hit = key?.kind === "MERCHANT" ? rulesAfter.get(keyOf(key)) : undefined;
      if (hit) {
        used.set(hit.id, (used.get(hit.id) ?? 0) + 1);
        out[i] = fromRule(hit, merchantOf(j), key);
        return;
      }
      const r = ai[j];
      const category = r?.category ?? "Other";
      const tokenised = hasCounterpartyToken(rows[i]!.description) || hasCounterpartyToken(rows[i]!.counterpartyHint ?? "");
      out[i] = {
        merchantName: merchantOf(j),
        category,
        mccCode: r?.mccCode ?? "0000",
        mccLabel: r?.mccLabel ?? "Uncategorized",
        needsCategory: !r || r.fallback || AMBIGUOUS_CATEGORIES.has(category) || tokenised,
        ruleKey: key,
        ruleApplied: false,
      };
    });
  }

  const now = new Date();
  for (const [id, n] of used) {
    await db.categoryRule.update({ where: { id }, data: { timesApplied: { increment: n }, lastAppliedAt: now } });
  }
  return out as RuleCategorization[];
}

export async function createImportCategorizer(db: Db, organisationId: string): Promise<ImportCategorizer> {
  const secret = await getCounterpartySecret(db, organisationId);
  return {
    tokenize: (text) => tokenizeCounterparties(text, secret),
    categorize: (rows) => categorizeWithRules(db, organisationId, rows),
  };
}
```

- [ ] **Step 7: Run these tests, then the full suite**

Run: `npx vitest run tests/unit/categorize`
Expected: PASS.

Then run `npm run test`. Expected: everything passes, including any expectations updated in Step 3.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck 2>&1 | grep -E "categorize|statement-categorization"; echo "only pre-existing errors expected"
git add prisma/schema.prisma prisma/migrations/20261101120000_category_rules server/services/statement-categorization.service.ts server/services/categorize/category-rules.service.ts tests/unit/categorize/category-rules.test.ts
git add -u tests
git commit -m "feat(categorize): category rules model and rule-first categorisation"
```

---

### Task 3: SMS pipeline uses rules (processSms, poller, retry, updateItem)

**Files:**
- Modify: `server/services/sms/sms-import.service.ts`
- Modify: `server/services/sms/sms-poller.service.ts`
- Modify: `instrumentation-node.ts`
- Modify: `server/routers/smsImport.ts` (`parsedTxn`, `updateItem`, `retry`)
- Test: `tests/unit/sms-import/sms-import.service.test.ts`, `sms-poller.test.ts`, `router.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `ImportCategorizer`, `createImportCategorizer`, `RuleCategorization`.
  - From Task 1: `findTokens`, `RuleKey`.
- Produces:
  - `ParsedSmsTransaction` gains optional `needsCategory?: boolean; ruleKey?: RuleKey | null; ruleApplied?: boolean; rememberRule?: boolean; userCategorized?: boolean`.
  - `processSms(text, receivedAt, existing, categorizer: ImportCategorizer): Promise<ProcessSmsResult>`.
  - `PollerDeps.createCategorizer: (organisationId: string) => Promise<ImportCategorizer>`.
  - `parsedTxn` zod schema (exported), used again in Task 4.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/sms-import/sms-import.service.test.ts`:
- Every existing `processSms(text, RECEIVED, existing)` call gains a fourth argument, `fakeCategorizer()`.
- Replace the `categorizeBatch` mock assertions with assertions on the categorizer's `categorize` mock. Keep each test's intent.
- Drop the file's `categorizeBatch` mock if nothing uses it any more.
- Add:

```ts
import type { ImportCategorizer, RuleCategorization } from "@/server/services/categorize/category-rules.service";

const catRow = (over: Partial<RuleCategorization> = {}): RuleCategorization => ({
  merchantName: "KFC", category: "Food & Dining", mccCode: "5814", mccLabel: "Fast Food",
  needsCategory: false, ruleKey: { kind: "MERCHANT", matchKey: "kfc", label: "KFC" }, ruleApplied: false, ...over,
});
function fakeCategorizer(rows: RuleCategorization[] = [catRow()]) {
  return {
    tokenize: vi.fn((t: string) => t.replace("03001234567", "[PHONE ••4567 #0123456789ab]")),
    categorize: vi.fn(async () => rows),
  } satisfies ImportCategorizer;
}

it("tokenizes before redacting and stores the categorizer's flags", async () => {
  parse.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" }]);
  const c = fakeCategorizer([catRow({ category: "Transfers", needsCategory: true, ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" } })]);
  const r = await processSms("Raast PKR 5,000 to 03001234567", RECEIVED, [], c);
  expect(r.redactedText).toContain("[PHONE ••4567 #0123456789ab]");
  expect(r.redactedText).not.toContain("03001234567");
  expect(r.parsed[0]).toMatchObject({ needsCategory: true, ruleApplied: false, rememberRule: true, userCategorized: false,
    ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab" } });
});

it("passes the SMS's single token as a hint when the parser dropped it", async () => {
  parse.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast transfer", amount: 5000, type: "DEBIT" }]);
  const c = fakeCategorizer();
  await processSms("Raast PKR 5,000 to 03001234567", RECEIVED, [], c);
  expect(c.categorize).toHaveBeenCalledWith([{ description: "Raast transfer", counterpartyHint: "[PHONE ••4567 #0123456789ab]" }]);
});

it("tokenizes existing descriptions before duplicate detection", async () => {
  parse.parseTransactionsFromText.mockResolvedValue([{ date: "2026-10-30", description: "Raast [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" }]);
  const r = await processSms("Raast PKR 5,000 to 03001234567", RECEIVED,
    [{ id: "e1", date: new Date("2026-10-30"), description: "Raast 03001234567", amount: 5000 }], fakeCategorizer());
  expect(r.parsed[0]!.possibleDuplicate).toBe(true);
});
```

`parse` stands for whatever name the file already gives its `parseTransactionsFromText` mock; rename it to match.

In `tests/unit/sms-import/sms-poller.test.ts`:
- Declare `const categorizer = { tokenize: (t: string) => t, categorize: vi.fn() }`.
- Add `createCategorizer: vi.fn(async () => categorizer)` to the deps.
- Change each `toHaveBeenCalledWith("PKR 12 at X", NOW, [])` to `toHaveBeenCalledWith("PKR 12 at X", NOW, [], categorizer)`.
- In the existing test with one matching message, also assert:

```ts
  expect(deps.createCategorizer).toHaveBeenCalledTimes(1);
  expect(deps.createCategorizer).toHaveBeenCalledWith("org-1");
```
- In the existing test where no message matches the sender list, assert `expect(deps.createCategorizer).not.toHaveBeenCalled();`.

In `tests/unit/sms-import/router.test.ts`:
- Add the mock `vi.mock("@/server/services/categorize/category-rules.service", () => ({ createImportCategorizer: vi.fn(async () => ({ tokenize: (t: string) => t, categorize: vi.fn() })) }))`.
- The `retry` tests assert that `processSms` received a 4th argument (`expect.objectContaining({ tokenize: expect.any(Function) })`).
- Make the existing `updateItem` tests' `findFirst` resolve to a stored item `{ parsedJson: [txn] }`. A `null` result should give `NOT_FOUND`.
- Add:

```ts
it("updateItem keeps server-owned fields (ruleKey, ruleApplied) from the stored rows", async () => {
  const stored = { ...txn, ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" }, ruleApplied: false, needsCategory: true };
  db.smsImportItem.findFirst.mockResolvedValue({ parsedJson: [stored] });
  db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
  await caller().updateItem({ id: "i1", parsed: [{ ...txn, category: "Rent", ruleKey: { kind: "MERCHANT", matchKey: "evil", label: "x" }, ruleApplied: true, needsCategory: false, userCategorized: true, rememberRule: true }] });
  const saved = db.smsImportItem.updateMany.mock.calls[0]![0];
  expect(saved.where).toEqual({ id: "i1", organisationId: "org-1", status: "PENDING_REVIEW" });
  expect(saved.data.parsedJson[0]).toMatchObject({ category: "Rent", ruleKey: stored.ruleKey, ruleApplied: false, needsCategory: false, userCategorized: true });
});

it("updateItem rejects a different number of rows", async () => {
  db.smsImportItem.findFirst.mockResolvedValue({ parsedJson: [txn, txn] });
  await expect(caller().updateItem({ id: "i1", parsed: [txn] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/sms-import`
Expected: FAIL on the new assertions. `processSms` has no categorizer argument, the poller has no `createCategorizer` dep, and `updateItem` doesn't merge.

- [ ] **Step 3: Implement `processSms`**

In `server/services/sms/sms-import.service.ts`:
- Remove the `categorizeBatch` import.
- Add the imports:
```ts
import type { ImportCategorizer } from "@/server/services/categorize/category-rules.service";
import { findTokens, type RuleKey } from "@/server/services/categorize/counterparty-token";
```
- Extend the interface:
```ts
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
  /** The category is a guess; the review asks "where did this money go?". */
  needsCategory?: boolean;
  /** What "Always use…" applies to. Set by the server only. */
  ruleKey?: RuleKey | null;
  /** A remembered rule set this row's category. Set by the server only. */
  ruleApplied?: boolean;
  /** "Always use…" checkbox; defaults to true. */
  rememberRule?: boolean;
  /** The user picked this row's category in review. */
  userCategorized?: boolean;
}
```
- Replace `processSms`:
```ts
export async function processSms(
  text: string,
  receivedAt: Date,
  existing: ExistingTransaction[],
  categorizer: ImportCategorizer,
): Promise<ProcessSmsResult> {
  const redactedText = redactPiiText(categorizer.tokenize(text));
  try {
    const raw = deduplicateIncoming(await parseTransactionsFromText(redactedText))
      .filter((t) => Number.isFinite(t.amount) && Math.abs(t.amount) < MAX_AMOUNT)
      .map((t) => ({ ...t, amount: Math.abs(t.amount) }));
    if (raw.length === 0) return { status: "NO_TRANSACTION", redactedText, parsed: [] };

    const dated = raw.map((t) => ({ ...t, date: resolveDate(t.date, receivedAt) }));
    // Existing rows imported before tokens hold raw numbers; tokenize them the same way so they still match.
    const comparable = existing.map((e) => ({ ...e, description: categorizer.tokenize(e.description) }));
    const dupes = new Set(detectDuplicates(dated, comparable).duplicates.map((d) => d.incoming));
    // One SMS is (almost always) one transaction: if it names exactly one counterparty,
    // that's who the money went to even if the parser's description dropped the token.
    const tokens = [...new Set(findTokens(redactedText))];
    const hint = tokens.length === 1 ? tokens[0]! : null;
    const cats = await categorizer.categorize(
      dated.map((t) => (hint && !t.description.includes(hint) ? { description: t.description, counterpartyHint: hint } : { description: t.description })),
    );

    const parsed = dated.map((t, i): ParsedSmsTransaction => ({
      date: t.date,
      description: t.description,
      merchantName: cats[i]?.merchantName || t.description,
      amount: t.amount,
      type: t.type,
      category: cats[i]?.category ?? "Other",
      mccCode: cats[i]?.mccCode ?? "0000",
      mccLabel: cats[i]?.mccLabel ?? "Uncategorized",
      possibleDuplicate: dupes.has(t),
      needsCategory: cats[i]?.needsCategory ?? true,
      ruleKey: cats[i]?.ruleKey ?? null,
      ruleApplied: cats[i]?.ruleApplied ?? false,
      rememberRule: true,
      userCategorized: false,
    }));
    return { status: "PENDING_REVIEW", redactedText, parsed };
  } catch (err) {
    return { status: "FAILED", redactedText, parsed: [], error: err instanceof Error ? err.message : String(err) };
  }
}
```
Keep the existing body's exact shape wherever it differs in details this plan doesn't change, such as the `deduplicateIncoming`/filter order or the error message format. The only changes are the four marked ones: tokenize first, `comparable`, `hint`, and the categorizer with its new fields.

- [ ] **Step 4: Implement the poller and the boot wiring**

In `server/services/sms/sms-poller.service.ts`:
- Add `import type { ImportCategorizer } from "@/server/services/categorize/category-rules.service";`.
- Add `createCategorizer: (organisationId: string) => Promise<ImportCategorizer>;` to `PollerDeps`.
- `importOne` gains a `categorizer: ImportCategorizer` parameter after `existing`, and calls `deps.processSms(msg.text.replace(/\u0000/g, ""), msg.receivedAt, existing, categorizer)`.
- In the per-source sync, declare `let categorizer: ImportCategorizer | undefined;` next to `existing`. After `existing ??= await loadExistingForDedup(deps.db, source.organisationId, deps.now());`, add `categorizer ??= await deps.createCategorizer(source.organisationId);` and pass `categorizer` to `importOne`. This keeps it lazy: the categorizer is only created when a message matches.

In the darwin block of `instrumentation-node.ts`:
```ts
const { createImportCategorizer } = await import("@/server/services/categorize/category-rules.service");
startSmsPoller({ db, readMessages: messagesDb.readMessages, processSms, createCategorizer: (orgId) => createImportCategorizer(db, orgId), now: () => new Date() });
```
Keep the module/variable names the file already uses for `db`, `readMessages` and `processSms`.

- [ ] **Step 5: Implement the router changes**

In `server/routers/smsImport.ts`:
- Add `import { createImportCategorizer } from "@/server/services/categorize/category-rules.service";`.
- Export and extend `parsedTxn`:
```ts
const ruleKeySchema = z.object({
  kind: z.enum(["COUNTERPARTY", "MERCHANT"]),
  matchKey: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});
export const parsedTxn = z.object({
  date: z.string().refine(isRealIsoDate, "Invalid date"),
  description: z.string().min(1).max(500),
  merchantName: z.string().min(1).max(200),
  amount: z.number().finite().nonnegative().lt(MAX_AMOUNT),
  type: z.enum(["DEBIT", "CREDIT"]),
  category: z.string().min(1).max(100),
  mccCode: z.string().max(10),
  mccLabel: z.string().max(200),
  possibleDuplicate: z.boolean(),
  needsCategory: z.boolean().optional(),
  ruleKey: ruleKeySchema.nullable().optional(),
  ruleApplied: z.boolean().optional(),
  rememberRule: z.boolean().optional(),
  userCategorized: z.boolean().optional(),
});
```
- Replace `updateItem`:
```ts
  // The client edits what the user sees; which rule a row belongs to (and whether a
  // rule set it) stays whatever the server computed.
  updateItem: orgProcedure
    .input(z.object({ id: z.string().min(1), parsed: z.array(parsedTxn).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const where = { id: input.id, organisationId: ctx.organisationId, status: "PENDING_REVIEW" as const };
      const item = await ctx.db.smsImportItem.findFirst({ where, select: { parsedJson: true } });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const stored = item.parsedJson as unknown as ParsedSmsTransaction[];
      if (stored.length !== input.parsed.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This SMS changed. Refresh and try again." });
      }
      const merged = input.parsed.map((row, i) => ({
        ...row,
        ruleKey: stored[i]?.ruleKey ?? null,
        ruleApplied: stored[i]?.ruleApplied ?? false,
      }));
      const res = await ctx.db.smsImportItem.updateMany({ where, data: { parsedJson: merged as unknown as Prisma.InputJsonValue } });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
```
- In `retry`, replace `const result = await processSms(item.text, item.receivedAt, existing);` with:
```ts
      const categorizer = await createImportCategorizer(ctx.db, ctx.organisationId);
      const result = await processSms(item.text, item.receivedAt, existing, categorizer);
```

- [ ] **Step 6: Run the tests to check they pass**

Run: `npx vitest run tests/unit/sms-import tests/unit/categorize`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck 2>&1 | grep -E "sms|instrumentation|categorize"; echo "only pre-existing errors expected"
git add server/services/sms instrumentation-node.ts server/routers/smsImport.ts tests/unit/sms-import
git commit -m "feat(sms): categorise SMS with remembered rules and flag guesses"
```

---

### Task 4: Approve saves rules and applies them to other pending SMS

**Files:**
- Modify: `server/routers/smsImport.ts` (`approve`)
- Test: `tests/unit/sms-import/router.test.ts`

**Interfaces:**
- Consumes:
  - From Task 3: the new `ParsedSmsTransaction` fields and `parsedTxn`.
  - From Task 2: Prisma `categoryRule` and the `StatementTransaction` rule columns.
- Produces: `approve` returns `{ approved: number; transactions: number; rulesSaved: number; alsoAppliedTo: number }`. The early return is `{ approved: 0, transactions: 0, rulesSaved: 0, alsoAppliedTo: 0 }`.

- [ ] **Step 1: Write the failing tests**

Update the existing approve test's expected return to `{ approved: 2, transactions: 2, rulesSaved: 0, alsoAppliedTo: 0 }`. Its rows have no `ruleKey`, so no second `findMany` happens. Then add:

```ts
describe("smsImport.approve rules", () => {
  const cp = { kind: "COUNTERPARTY" as const, matchKey: "0123456789ab", label: "Transfers to ••4567" };
  const setup = (parsedJson: unknown[], others: unknown[] = []) => {
    db.smsImportItem.count.mockResolvedValue(1);
    db.statementImportBatch.create.mockResolvedValue({ id: "b1" });
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    db.smsImportItem.findMany.mockResolvedValueOnce([{ parsedJson }]).mockResolvedValueOnce(others);
    db.organisation.findUnique.mockResolvedValue({ hasSampleData: false });
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
    expect(await caller().approve({ ids: ["i1"] })).toMatchObject({ rulesSaved: 0, alsoAppliedTo: 0 });
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
    expect(db.smsImportItem.update).toHaveBeenCalledTimes(1);
    expect(db.smsImportItem.update.mock.calls[0]![0]).toMatchObject({
      where: { id: "p2" },
      data: { parsedJson: [expect.objectContaining({ category: "Rent", needsCategory: false, ruleApplied: true })] },
    });
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/sms-import/router.test.ts`
Expected: FAIL. The new return fields are missing and `categoryRule.upsert` isn't called.

- [ ] **Step 3: Implement**

In `approve`:
- Change the early return to `return { approved: 0, transactions: 0, rulesSaved: 0, alsoAppliedTo: 0 };`.
- Add these fields to each `createMany` row:
```ts
            needsCategory: r.needsCategory ?? false,
            ruleKind: r.ruleKey?.kind ?? null,
            ruleMatchKey: r.ruleKey?.matchKey ?? null,
            ruleLabel: r.ruleKey?.label ?? null,
```
- After `statementImportBatch.update(...)`, replace the final return with:
```ts
        // "Always use…" answers become rules (the last answer for a key wins) and
        // fill in other waiting SMS that still need a category for the same key.
        const answers = new Map<string, { key: NonNullable<ParsedSmsTransaction["ruleKey"]>; category: string }>();
        for (const r of rows) {
          if (r.ruleKey && r.userCategorized && r.rememberRule !== false) {
            answers.set(`${r.ruleKey.kind}:${r.ruleKey.matchKey}`, { key: r.ruleKey, category: r.category });
          }
        }
        for (const { key, category } of answers.values()) {
          await tx.categoryRule.upsert({
            where: { organisationId_kind_matchKey: { organisationId, kind: key.kind, matchKey: key.matchKey } },
            create: { organisationId, kind: key.kind, matchKey: key.matchKey, label: key.label, category },
            update: { category, label: key.label },
          });
        }
        let alsoAppliedTo = 0;
        if (answers.size > 0) {
          const others = await tx.smsImportItem.findMany({
            where: { organisationId, status: "PENDING_REVIEW" },
            select: { id: true, parsedJson: true },
          });
          for (const other of others) {
            let changed = false;
            const parsed = (other.parsedJson as unknown as ParsedSmsTransaction[]).map((p) => {
              const hit = p.ruleKey && p.needsCategory ? answers.get(`${p.ruleKey.kind}:${p.ruleKey.matchKey}`) : undefined;
              if (!hit) return p;
              changed = true;
              return { ...p, category: hit.category, mccLabel: hit.category, needsCategory: false, ruleApplied: true };
            });
            if (changed) {
              await tx.smsImportItem.update({ where: { id: other.id }, data: { parsedJson: parsed as unknown as Prisma.InputJsonValue } });
              alsoAppliedTo++;
            }
          }
        }
        return { approved: claimed.count, transactions: rows.length, rulesSaved: answers.size, alsoAppliedTo };
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run tests/unit/sms-import`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/smsImport.ts tests/unit/sms-import/router.test.ts
git commit -m "feat(sms): approving an answered SMS remembers the category"
```

---

### Task 5: Statement imports use rules and store the flags

**Files:**
- Create: `server/services/categorize/statement-rows.ts`
- Modify: `app/api/pf/import/route.ts`
- Modify: `app/api/pf/import/[batchId]/confirm/route.ts`
- Modify: `server/services/pdf-statement.service.ts` (one prompt line)
- Test: `tests/unit/categorize/statement-rows.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `createImportCategorizer`, `ImportCategorizer`, `RuleCategorization`.
  - From `statement-parser.service`: `RawTransaction`, `ExistingTransaction`.
- Produces:
  - `toStatementRow(txn: RawTransaction, cat: RuleCategorization | undefined)` returns `{ date, description, merchantName, amount, type, category, mccCode, mccLabel, needsCategory, ruleKind, ruleMatchKey, ruleLabel }`.
  - `tokenizeExisting<T extends { description: string }>(rows: T[], tokenize: (t: string) => string): T[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/categorize/statement-rows.test.ts
import { describe, expect, it } from "vitest";
import { toStatementRow, tokenizeExisting } from "@/server/services/categorize/statement-rows";
import { detectDuplicates } from "@/server/services/statement-parser.service";
import { tokenizeCounterparties } from "@/server/services/categorize/counterparty-token";

const raw = { date: "2026-10-30", description: "IBFT [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" as const };

describe("toStatementRow", () => {
  it("copies the categorisation, flag and rule key", () => {
    expect(toStatementRow(raw, {
      merchantName: "IBFT", category: "Transfers", mccCode: "0000", mccLabel: "Transfers", needsCategory: true,
      ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" }, ruleApplied: false,
    })).toEqual({
      date: new Date("2026-10-30"), description: raw.description, merchantName: "IBFT", amount: 5000, type: "DEBIT",
      category: "Transfers", mccCode: "0000", mccLabel: "Transfers", needsCategory: true,
      ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", ruleLabel: "Transfers to ••4567",
    });
  });

  it("flags a row the categoriser returned nothing for", () => {
    expect(toStatementRow(raw, undefined)).toMatchObject({ category: "Other", merchantName: raw.description, needsCategory: true, ruleKind: null });
  });
});

describe("tokenizeExisting", () => {
  it("lets a re-imported row match one saved before tokens existed", () => {
    const tokenize = (t: string) => tokenizeCounterparties(t, "d".repeat(64));
    const incoming = [{ ...raw, description: tokenize("IBFT to 03001234567 ref 99812") }];
    const existing = [{ id: "old", date: new Date("2026-10-30"), description: "IBFT to 03001234567 ref 99812", amount: 5000 }];
    expect(detectDuplicates(incoming, tokenizeExisting(existing, tokenize)).duplicates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/categorize/statement-rows.test.ts`
Expected: FAIL because the module doesn't exist.

- [ ] **Step 3: Implement the helpers**

```ts
// server/services/categorize/statement-rows.ts
import type { ExistingTransaction, RawTransaction } from "@/server/services/statement-parser.service";
import type { RuleCategorization } from "./category-rules.service";

export function toStatementRow(txn: RawTransaction, cat: RuleCategorization | undefined) {
  return {
    date: new Date(txn.date),
    description: txn.description,
    merchantName: cat?.merchantName || txn.description,
    amount: txn.amount,
    type: txn.type,
    category: cat?.category ?? "Other",
    mccCode: cat?.mccCode ?? "0000",
    mccLabel: cat?.mccLabel ?? "Uncategorized",
    needsCategory: cat?.needsCategory ?? true,
    ruleKind: cat?.ruleKey?.kind ?? null,
    ruleMatchKey: cat?.ruleKey?.matchKey ?? null,
    ruleLabel: cat?.ruleKey?.label ?? null,
  };
}

// Rows saved before counterparty tokens hold raw numbers; tokenize them the same
// way so an overlapping re-import is still recognised as a duplicate.
export function tokenizeExisting<T extends Pick<ExistingTransaction, "description">>(rows: T[], tokenize: (t: string) => string): T[] {
  return rows.map((r) => ({ ...r, description: tokenize(r.description) }));
}
```

If `RawTransaction` or `ExistingTransaction` isn't exported from `statement-parser.service`, export it there. That is a one-word change.

- [ ] **Step 4: Switch the import routes**

In `app/api/pf/import/route.ts`:
- Replace the `categorizeBatch` import with:
```ts
import { createImportCategorizer, type ImportCategorizer } from "@/server/services/categorize/category-rules.service";
import { toStatementRow, tokenizeExisting } from "@/server/services/categorize/statement-rows";
```
- **CSV** (`handleCsvImport`):
  1. Create `const categorizer = await createImportCategorizer(db, organisationId);`.
  2. Tokenize descriptions as they're parsed: `deduplicateIncoming(parseCsvBuffer(buffer, columnMap)).map((t) => ({ ...t, description: categorizer.tokenize(t.description) }))`.
  3. Replace the `categorizeBatch(...)` call with `const categorized = await categorizer.categorize(rawTransactions.map((t) => ({ description: t.description })));`.
  4. Pass `tokenizeExisting(existing, categorizer.tokenize)` to `detectDuplicates`.
  5. Replace the body of `categorizedByIdx` with `toStatementRow(txn, categorized[i])`.
- **Streaming** (`runStreamingImport`):
  1. Add a `categorizer: ImportCategorizer` parameter after `batchId`.
  2. Tokenize after dedup: `const rawTransactions = deduplicateIncoming(rawTxnsBeforeDedup).map((t) => ({ ...t, description: categorizer.tokenize(t.description) }));`. For images, the AI saw the picture, so this is where numbers in their descriptions get tokenized.
  3. Replace the `categorizeBatch` call with `categorizer.categorize(rawTransactions.map((t) => ({ description: t.description })))`, keeping the keepalive `.finally`.
  4. Compare against `tokenizeExisting(existing, categorizer.tokenize)`.
  5. Build both `pendingDuplicatesData` and the `createMany` rows from `toStatementRow(txn, categorized[idx])`. The `createMany` rows also need `organisationId` and `importBatchId`.
- **PDF** (`handlePdfImport`):
  1. Create the categorizer right after the batch.
  2. Call `parsePageTransactions(categorizer.tokenize(pages[i]))` so numbers are tokenized before redaction and the AI.
  3. Pass `categorizer` to `runStreamingImport`.
- **Image** (`handleImageImport`): create the categorizer and pass it to `runStreamingImport`.

In `app/api/pf/import/[batchId]/confirm/route.ts`:
- Extend the stored-row type with `needsCategory?: boolean; ruleKind?: "COUNTERPARTY" | "MERCHANT" | null; ruleMatchKey?: string | null; ruleLabel?: string | null;`.
- Add to each `createMany` row:
```ts
          needsCategory: d.needsCategory ?? false,
          ruleKind: d.ruleKind ?? null,
          ruleMatchKey: d.ruleMatchKey ?? null,
          ruleLabel: d.ruleLabel ?? null,
```

In `server/services/pdf-statement.service.ts`, replace this `PARSE_PROMPT` line:
`- description: payee, merchant, sender, or transaction reference`
with:
`- description: payee, merchant, sender, or transaction reference. Copy any [PHONE …] or [ACCT …] token from the text into the description exactly as written`

- [ ] **Step 5: Run the tests, lint and build**

Run: `npx vitest run && npm run lint && npm run build`
Expected:
- All tests pass.
- Lint is clean.
- The build passes, and the postbuild check reports that there is no Messages database in the build output.

- [ ] **Step 6: Commit**

```bash
git add server/services/categorize/statement-rows.ts server/services/statement-parser.service.ts tests/unit/categorize/statement-rows.test.ts "app/api/pf/import/route.ts" "app/api/pf/import/[batchId]/confirm/route.ts" server/services/pdf-statement.service.ts
git commit -m "feat(import): statement imports use remembered rules and flag guesses"
```

---

### Task 6: Transactions router — needs-category filter, count, and "always use"

**Files:**
- Modify: `server/routers/statementTransactions.ts`
- Test: `tests/unit/categorize/statement-transactions-router.test.ts`

**Interfaces:**
- Consumes from Task 2: Prisma `categoryRule` and the `StatementTransaction` rule columns.
- Produces:
  - `statementTransactions.list` input gains `needsCategory?: boolean`.
  - `statementTransactions.needsCategoryCount()` returns a `number`.
  - `statementTransactions.updateCategory` input gains `remember?: boolean`, and it returns the updated transaction plus `alsoUpdated: number`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/categorize/statement-transactions-router.test.ts
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ statementTransactions: statementTransactionsRouter }));
let db: MockDb;
const caller = () => createCaller({ session: { user: { id: "user-1" }, expires: "2099-01-01" }, db: db as unknown as PrismaClient, ip: "test" } as Parameters<typeof createCaller>[0]).statementTransactions;
const flagged = { id: "t1", organisationId: "org-1", merchantName: "IBFT", needsCategory: true, ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", ruleLabel: "Transfers to ••4567" };

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({ id: "user-1", organisationId: "org-1", organisation: { id: "org-1" } });
  db.statementTransaction.findFirst.mockResolvedValue(flagged);
  db.statementTransaction.update.mockResolvedValue({ ...flagged, category: "Rent", needsCategory: false });
  db.statementTransaction.updateMany.mockResolvedValue({ count: 3 });
});

describe("updateCategory", () => {
  it("clears the flag without touching rules when remember is off", async () => {
    const r = await caller().updateCategory({ id: "t1", category: "Rent" });
    expect(db.statementTransaction.update.mock.calls[0]![0].data).toMatchObject({ category: "Rent", needsCategory: false });
    expect(db.categoryRule.upsert).not.toHaveBeenCalled();
    expect(r.alsoUpdated).toBe(0);
  });

  it("remembers the rule and fills in only other flagged rows with the same key in the org", async () => {
    const r = await caller().updateCategory({ id: "t1", category: "Rent", remember: true });
    expect(db.categoryRule.upsert.mock.calls[0]![0]).toEqual({
      where: { organisationId_kind_matchKey: { organisationId: "org-1", kind: "COUNTERPARTY", matchKey: "0123456789ab" } },
      create: { organisationId: "org-1", kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567", category: "Rent" },
      update: { category: "Rent", label: "Transfers to ••4567" },
    });
    expect(db.statementTransaction.updateMany.mock.calls[0]![0]).toEqual({
      where: { organisationId: "org-1", ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", needsCategory: true, id: { not: "t1" } },
      data: { category: "Rent", mccLabel: "Rent", needsCategory: false },
    });
    expect(r.alsoUpdated).toBe(3);
  });

  it("ignores remember for a row with no rule key", async () => {
    db.statementTransaction.findFirst.mockResolvedValue({ ...flagged, ruleKind: null, ruleMatchKey: null });
    await caller().updateCategory({ id: "t1", category: "Rent", remember: true });
    expect(db.categoryRule.upsert).not.toHaveBeenCalled();
  });

  it("is org-scoped", async () => {
    db.statementTransaction.findFirst.mockResolvedValue(null);
    await expect(caller().updateCategory({ id: "x", category: "Rent", remember: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.statementTransaction.findFirst.mock.calls[0]![0].where).toEqual({ id: "x", organisationId: "org-1" });
  });
});

describe("needs-category", () => {
  it("counts this org's flagged, non-excluded rows", async () => {
    db.statementTransaction.count.mockResolvedValue(12);
    expect(await caller().needsCategoryCount()).toBe(12);
    expect(db.statementTransaction.count.mock.calls[0]![0].where).toEqual({ organisationId: "org-1", needsCategory: true, isExcluded: false });
  });

  it("filters the list", async () => {
    db.statementTransaction.findMany.mockResolvedValue([]);
    await caller().list({ needsCategory: true });
    expect(db.statementTransaction.findMany.mock.calls[0]![0].where).toMatchObject({ organisationId: "org-1", needsCategory: true });
  });
});
```

If the session mock shape differs from `tests/unit/sms-import/router.test.ts`, copy that file's caller setup exactly. It is the known-good pattern for `orgProcedure`.

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/categorize/statement-transactions-router.test.ts`
Expected: FAIL because there is no `needsCategoryCount` procedure and `alsoUpdated` is undefined.

- [ ] **Step 3: Implement**

In `list`:
- Add `needsCategory: z.boolean().optional(),` to the input.
- After the `category` filter line, add `if (input.needsCategory !== undefined) where.needsCategory = input.needsCategory;`.

Add next to `list`:
```ts
  needsCategoryCount: orgProcedure.query(({ ctx }) =>
    ctx.db.statementTransaction.count({ where: { organisationId: ctx.organisationId, needsCategory: true, isExcluded: false } }),
  ),
```

Replace `updateCategory`:
```ts
  updateCategory: orgProcedure
    .input(
      z.object({
        id: z.string(),
        category: z.string().min(1).max(100),
        mccCode: z.string().optional(),
        mccLabel: z.string().optional(),
        /** "Always use this category" for this row's counterparty/merchant. */
        remember: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organisationId = ctx.organisationId;
      const txn = await ctx.db.statementTransaction.findFirst({ where: { id: input.id, organisationId } });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.statementTransaction.update({
          where: { id: input.id },
          data: {
            category: input.category,
            needsCategory: false,
            ...(input.mccCode !== undefined ? { mccCode: input.mccCode } : {}),
            ...(input.mccLabel !== undefined ? { mccLabel: input.mccLabel } : {}),
          },
        });
        let alsoUpdated = 0;
        if (input.remember && txn.ruleKind && txn.ruleMatchKey) {
          const label = txn.ruleLabel ?? txn.merchantName;
          await tx.categoryRule.upsert({
            where: { organisationId_kind_matchKey: { organisationId, kind: txn.ruleKind, matchKey: txn.ruleMatchKey } },
            create: { organisationId, kind: txn.ruleKind, matchKey: txn.ruleMatchKey, label, category: input.category },
            update: { category: input.category, label },
          });
          // Only rows still waiting for an answer; anything already categorised stays as it is.
          const res = await tx.statementTransaction.updateMany({
            where: { organisationId, ruleKind: txn.ruleKind, ruleMatchKey: txn.ruleMatchKey, needsCategory: true, id: { not: txn.id } },
            data: { category: input.category, mccLabel: input.category, needsCategory: false },
          });
          alsoUpdated = res.count;
        }
        return { ...updated, alsoUpdated };
      });
    }),
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run tests/unit/categorize`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/statementTransactions.ts tests/unit/categorize/statement-transactions-router.test.ts
git commit -m "feat(transactions): needs-category filter and remember-this-category"
```

---

### Task 7: Transactions page — banner, flag pill, "Always use…" dialog

**Files:**
- Create: `app/(app)/pf/transactions/_components/needs-category-banner.tsx`
- Create: `app/(app)/pf/transactions/_components/remember-rule-dialog.tsx`
- Modify: `app/(app)/pf/transactions/page.tsx`

**Interfaces:**
- Consumes from Task 6: `needsCategoryCount`, `list({ needsCategory })`, `updateCategory({ remember })`. List items include `needsCategory`, `ruleKind`, `ruleMatchKey` and `ruleLabel`, because `findMany` returns every scalar.
- Produces: UI only.

The page already has `const [cursor, setCursor] = useState<string | undefined>(undefined);`, `data.items` / `data.nextCursor`, `toast` imported from `sonner`, and `utils`.

- [ ] **Step 1: Create the banner**

```tsx
// app/(app)/pf/transactions/_components/needs-category-banner.tsx
"use client";

import { trpc } from "@/lib/trpc/client";

export function NeedsCategoryBanner({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { data: count = 0 } = trpc.statementTransactions.needsCategoryCount.useQuery();
  if (count === 0 && !active) return null;
  return (
    <button type="button" onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100">
      <span>{count} transaction{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a category</span>
      <span className="font-semibold">{active ? "Show all" : "Show them"}</span>
    </button>
  );
}
```

- [ ] **Step 2: Create the dialog**

Check that `components/ui/dialog.tsx` exports `Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle`. If one is missing, drop it from the import and use a plain `div` with the same class.

```tsx
// app/(app)/pf/transactions/_components/remember-rule-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface PendingCategoryChange {
  id: string;
  category: string;
  label: string;
}

export function RememberRuleDialog({ change, onConfirm, onCancel, busy }: {
  change: PendingCategoryChange | null;
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [remember, setRemember] = useState(true);
  useEffect(() => { if (change) setRemember(true); }, [change]);
  return (
    <Dialog open={change !== null} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change to {change?.category}</DialogTitle>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Always use <strong>{change?.category}</strong> for {change?.label}</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(remember)} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire them into the page**

In `app/(app)/pf/transactions/page.tsx`:
- Import `NeedsCategoryBanner`, `RememberRuleDialog` and `type PendingCategoryChange` from `./_components/…`.
- Add state:
```tsx
  const [needsCategoryOnly, setNeedsCategoryOnly] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingCategoryChange | null>(null);
```
- In the `list` query input (next to `cursor,`), add `needsCategory: needsCategoryOnly ? true : undefined,`.
- Replace the `updateCategory` mutation's `onSuccess` with:
```tsx
    onSuccess: (r) => {
      utils.statementTransactions.list.invalidate();
      utils.statementTransactions.summary.invalidate();
      utils.statementTransactions.needsCategoryCount.invalidate();
      if (r.alsoUpdated > 0) toast.success(`Also updated ${r.alsoUpdated} other transaction${r.alsoUpdated === 1 ? "" : "s"}`);
      setPendingChange(null);
    },
```
Keep any other invalidations the existing `onSuccess` already does.
- Add one handler and use it for both the desktop `CategoryPicker` and the mobile `TransactionCard`:
```tsx
  const changeCategory = (id: string, newCat: string) => {
    const txn = data?.items.find((t) => t.id === id);
    if (txn?.ruleMatchKey) setPendingChange({ id, category: newCat, label: txn.ruleLabel ?? txn.merchantName });
    else updateCategory.mutate({ id, category: newCat });
  };
```
  - Desktop: `onChange={(newCat) => changeCategory(txn.id, newCat)}`.
  - Mobile: `onCategoryChange={changeCategory}`.
- Right after `<SmsReviewBanner />`, render:
```tsx
        <NeedsCategoryBanner active={needsCategoryOnly}
          onToggle={() => { setNeedsCategoryOnly((v) => !v); setCursor(undefined); }} />
```
- Render the dialog once, at the end of the page's top-level fragment or container:
```tsx
      <RememberRuleDialog
        change={pendingChange}
        busy={updateCategory.isPending}
        onCancel={() => setPendingChange(null)}
        onConfirm={(remember) => pendingChange && updateCategory.mutate({ id: pendingChange.id, category: pendingChange.category, remember })}
      />
```
- In the desktop table's category cell, after the `CategoryPicker`, add:
```tsx
                      {txn.needsCategory && (
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Needs category</span>
                      )}
```

- [ ] **Step 4: Typecheck, lint and build**

Run: `npm run typecheck 2>&1 | grep "pf/transactions"; npm run lint && npm run build`
Expected: no errors in these files, and lint and build pass.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/pf/transactions"
git commit -m "feat(transactions): ask for missing categories and offer to remember them"
```

---

### Task 8: SMS review sheet — flag label, remember checkbox, open from a link

**Files:**
- Modify: `app/(app)/pf/transactions/_components/sms-review-sheet.tsx`

**Interfaces:**
- Consumes:
  - From Task 3: the new `ParsedSmsTransaction` fields and the `updateItem` merge.
  - From Task 4: `approve` returns `alsoAppliedTo`.
- Produces: `SmsReviewBanner` opens itself when the URL has `?smsReview=1`. Task 9 links there.

- [ ] **Step 1: Render from drafts**

The remember checkbox has to update as soon as it's clicked, so rows render from the draft.
- Change the React import to `import { useEffect, useReducer, useRef, useState } from "react";`.
- In `SmsReviewSheet`, add `const [, rerender] = useReducer((n: number) => n + 1, 0);`.
- In `editRow`, call `rerender();` right after `drafts.current.set(id, rows);`.
- In `pending.data?.map((item) => (`, change the rows loop from `{item.parsed.map((row, i) => (` to `{(drafts.current.get(item.id) ?? item.parsed).map((row, i) => (`.
- Change the type-toggle `onClick` to `editRow(item, i, { type: row.type === "DEBIT" ? "CREDIT" : "DEBIT" })`. `row` now comes from the draft, so the extra lookup is no longer needed.

- [ ] **Step 2: Add the flag, the "remembered" note and the checkbox**

Replace the category block, `<div className="col-span-3 flex items-center gap-2">…</div>`, with:
```tsx
                  <div className="col-span-3 flex flex-wrap items-center gap-2">
                    <CategoryPicker value={row.category}
                      onChange={(c) => editRow(item, i, { category: c, mccLabel: c, needsCategory: false, userCategorized: true, rememberRule: row.rememberRule ?? true })}
                      triggerClassName="h-6 px-2 text-xs rounded-full bg-muted" />
                    {row.needsCategory && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Where did this money go?</span>
                    )}
                    {row.ruleApplied && !row.userCategorized && (
                      <span className="text-[11px] text-muted-foreground">remembered</span>
                    )}
                    {row.possibleDuplicate && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Possible duplicate</span>
                    )}
                    {row.ruleKey && row.userCategorized && (
                      <label className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input type="checkbox" checked={row.rememberRule !== false}
                          onChange={(e) => editRow(item, i, { rememberRule: e.target.checked })} />
                        Always use {row.category} for {row.ruleKey.label}
                      </label>
                    )}
                  </div>
```

- [ ] **Step 3: Add the "also applied" toast**

In `approve`'s `onSuccess`, after the existing toasts, add:
```tsx
      if (r.alsoAppliedTo > 0) toast.info(`Also applied to ${r.alsoAppliedTo} other SMS`);
```

- [ ] **Step 4: Open from `?smsReview=1`**

In `SmsReviewBanner`, after `useState`, add the effect below. It reads `window.location` so the page doesn't need a Suspense boundary for `useSearchParams`.
```tsx
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("smsReview") === "1") setOpen(true);
  }, []);
```

- [ ] **Step 5: Typecheck, lint, build and commit**

```bash
npm run typecheck 2>&1 | grep "sms-review-sheet"; npm run lint && npm run build
git add "app/(app)/pf/transactions/_components/sms-review-sheet.tsx"
git commit -m "feat(sms): ask where money went and offer to remember it in review"
```

---

### Task 9: Persistent SMS notifications

**Files:**
- Modify: `server/routers/smsImport.ts` (`notifications`, `closeNotification`)
- Create: `components/sms-notifications.tsx`
- Modify: `app/(app)/_components/app-shell.tsx`
- Modify: `app/(app)/pf/transactions/_components/sms-review-sheet.tsx` (one line in `refresh`)
- Test: `tests/unit/sms-import/notifications.test.ts`

**Interfaces:**
- Consumes:
  - From Task 3: `ParsedSmsTransaction`.
  - From Task 2: Prisma `SmsImportItem.notificationClosedAt`.
- Produces:
  - `smsImport.notifications()` returns `{ id: string; receivedAt: Date; amount: number; type: "DEBIT" | "CREDIT"; merchantName: string; category: string; counterpartyLabel: string | null; flagged: boolean; ruleApplied: boolean; extraRows: number }[]`.
  - `smsImport.closeNotification({ id })` returns `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/sms-import/notifications.test.ts
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { smsImportRouter } from "@/server/routers/smsImport";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ smsImport: smsImportRouter }));
let db: MockDb;
const caller = () => createCaller({ session: { user: { id: "user-1" }, expires: "2099-01-01" }, db: db as unknown as PrismaClient, ip: "test" } as Parameters<typeof createCaller>[0]).smsImport;
const row = { date: "2026-10-30", description: "Raast", merchantName: "Raast", amount: 5000, type: "DEBIT", category: "Transfers",
  mccCode: "0000", mccLabel: "Transfers", possibleDuplicate: false, needsCategory: true,
  ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" }, ruleApplied: false };

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({ id: "user-1", organisationId: "org-1", organisation: { id: "org-1" } });
});

describe("smsImport.notifications", () => {
  it("lists this org's open notifications for SMS that reached review, skipping rowless items", async () => {
    const at = new Date("2026-10-30T10:00:00Z");
    db.smsImportItem.findMany.mockResolvedValue([
      { id: "a", receivedAt: at, parsedJson: [row, { ...row, merchantName: "Other" }] },
      { id: "b", receivedAt: at, parsedJson: [] }, // hidden from Skipped: no rows
    ]);
    expect(await caller().notifications()).toEqual([{
      id: "a", receivedAt: at, amount: 5000, type: "DEBIT", merchantName: "Raast", category: "Transfers",
      counterpartyLabel: "Transfers to ••4567", flagged: true, ruleApplied: false, extraRows: 1,
    }]);
    expect(db.smsImportItem.findMany.mock.calls[0]![0]).toMatchObject({
      where: { organisationId: "org-1", notificationClosedAt: null, status: { in: ["PENDING_REVIEW", "APPROVED", "DISMISSED"] } },
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
    await expect(caller().closeNotification({ id: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dismiss leaves notifications open", () => {
  it("never writes notificationClosedAt", async () => {
    db.smsImportItem.updateMany.mockResolvedValue({ count: 1 });
    await caller().dismiss({ ids: ["a"] });
    expect(db.smsImportItem.updateMany.mock.calls[0]![0].data).not.toHaveProperty("notificationClosedAt");
  });
});
```

If `tests/unit/sms-import/router.test.ts` builds its caller differently, copy its setup exactly.

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/sms-import/notifications.test.ts`
Expected: FAIL because the procedures don't exist.

- [ ] **Step 3: Implement the procedures**

Add to `smsImportRouter`:
```ts
  // One notification per SMS that reached review, until the user closes it.
  notifications: orgProcedure.query(async ({ ctx }) => {
    const items = await ctx.db.smsImportItem.findMany({
      where: {
        organisationId: ctx.organisationId,
        notificationClosedAt: null,
        status: { in: ["PENDING_REVIEW", "APPROVED", "DISMISSED"] },
      },
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: { id: true, receivedAt: true, parsedJson: true },
    });
    return items.flatMap(({ id, receivedAt, parsedJson }) => {
      const rows = parsedJson as unknown as ParsedSmsTransaction[];
      const first = rows[0];
      if (!first) return [];
      return [{
        id,
        receivedAt,
        amount: first.amount,
        type: first.type,
        merchantName: first.merchantName,
        category: first.category,
        counterpartyLabel: first.ruleKey?.kind === "COUNTERPARTY" ? first.ruleKey.label : null,
        flagged: !!first.needsCategory,
        ruleApplied: !!first.ruleApplied,
        extraRows: rows.length - 1,
      }];
    });
  }),

  closeNotification: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.smsImportItem.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { notificationClosedAt: new Date() },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run tests/unit/sms-import`
Expected: PASS.

- [ ] **Step 5: Build the notification stack**

```tsx
// components/sms-notifications.tsx
"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/utils";

const POLL_MS = 60_000;

// Bottom-right stack of SMS transaction notifications. The × (top-left) is the
// only way one goes away — approving, dismissing or restarting leaves it.
export function SmsNotifications() {
  const utils = trpc.useUtils();
  const { data: source } = trpc.smsImport.getSource.useQuery(undefined, { staleTime: 5 * 60_000 });
  const supported = source?.platformSupported ?? false;
  const { data: org } = trpc.org.get.useQuery(undefined, { staleTime: 60_000, enabled: supported });
  const { data: items = [] } = trpc.smsImport.notifications.useQuery(undefined, { enabled: supported, refetchInterval: POLL_MS });
  const close = trpc.smsImport.closeNotification.useMutation({
    onMutate: ({ id }) => utils.smsImport.notifications.setData(undefined, (old) => old?.filter((n) => n.id !== id)),
    onSettled: () => void utils.smsImport.notifications.invalidate(),
  });
  if (!supported || items.length === 0) return null;
  const fmt = (n: number) => formatCurrency(n, org?.currency ?? "USD");

  return (
    <div className="fixed bottom-24 right-6 z-40 flex max-h-[min(28rem,70vh)] w-80 flex-col gap-2 overflow-y-auto" aria-live="polite">
      {items.map((n) => {
        const body = n.flagged
          ? `${fmt(n.amount)} · ${n.counterpartyLabel ?? n.merchantName} — where did this go?`
          : n.ruleApplied
            ? `${fmt(n.amount)} · ${n.category} (remembered)`
            : `${fmt(n.amount)} · ${n.merchantName} · ${n.type === "DEBIT" ? "Debit" : "Credit"}`;
        return (
          <div key={n.id} className="relative shrink-0 rounded-xl border bg-card p-3 pl-9 text-sm shadow-lg">
            <button type="button" aria-label="Close notification" onClick={() => close.mutate({ id: n.id })}
              className="absolute left-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="font-medium">📱 New SMS transaction</p>
            <p className="text-muted-foreground">{body}</p>
            {n.extraRows > 0 && <p className="text-xs text-muted-foreground">and {n.extraRows} more</p>}
            <Link href="/pf/transactions?smsReview=1" className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">
              Review →
            </Link>
          </div>
        );
      })}
    </div>
  );
}
```

Check that `formatCurrency(amount, currency)` in `lib/utils.ts` takes its arguments in that order, and adjust the call if it doesn't.

The stack sits at `bottom-24`, which keeps it clear of the chat button at `fixed right-6 bottom-6`. About four cards fit before it scrolls.

In `app/(app)/_components/app-shell.tsx`, import `SmsNotifications` from `@/components/sms-notifications` and render `<SmsNotifications />` right after `<ChatPanel />`.

In `sms-review-sheet.tsx`, add `utils.smsImport.notifications.invalidate(),` to the `Promise.all` in `refresh`. That way an approval made in the sheet refreshes the "(remembered)" text on other cards.

- [ ] **Step 6: Typecheck, lint, build and commit**

```bash
npm run typecheck 2>&1 | grep -E "sms-notifications|app-shell|smsImport|sms-review-sheet"; npm run lint && npm run build
git add server/routers/smsImport.ts components/sms-notifications.tsx "app/(app)/_components/app-shell.tsx" "app/(app)/pf/transactions/_components/sms-review-sheet.tsx" tests/unit/sms-import/notifications.test.ts
git commit -m "feat(sms): persistent in-app notification for each SMS transaction"
```

---

### Task 10: Category rules router and Settings card

**Files:**
- Create: `server/routers/categoryRules.ts`
- Modify: `server/root.ts`
- Create: `app/(app)/settings/_components/category-rules-card.tsx`
- Modify: `app/(app)/settings/page.tsx`
- Test: `tests/unit/categorize/category-rules-router.test.ts`

**Interfaces:**
- Consumes:
  - Prisma `categoryRule`.
  - `CategoryPicker` from `app/(app)/pf/transactions/_components/category-picker.tsx`, with props `{ value, onChange, triggerClassName }`.
- Produces:
  - `categoryRules.list()` returns `{ id, kind, label, category, timesApplied, lastAppliedAt }[]`.
  - `categoryRules.update({ id, category })`.
  - `categoryRules.delete({ id })`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/categorize/category-rules-router.test.ts
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { categoryRulesRouter } from "@/server/routers/categoryRules";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ categoryRules: categoryRulesRouter }));
let db: MockDb;
const caller = () => createCaller({ session: { user: { id: "user-1" }, expires: "2099-01-01" }, db: db as unknown as PrismaClient, ip: "test" } as Parameters<typeof createCaller>[0]).categoryRules;

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({ id: "user-1", organisationId: "org-1", organisation: { id: "org-1" } });
});

describe("categoryRules", () => {
  it("lists only this org's rules, newest first", async () => {
    db.categoryRule.findMany.mockResolvedValue([]);
    await caller().list();
    expect(db.categoryRule.findMany.mock.calls[0]![0]).toMatchObject({ where: { organisationId: "org-1" }, orderBy: { updatedAt: "desc" } });
  });

  it("updates the category within the org", async () => {
    db.categoryRule.updateMany.mockResolvedValue({ count: 1 });
    await caller().update({ id: "r1", category: "Rent" });
    expect(db.categoryRule.updateMany.mock.calls[0]![0]).toEqual({ where: { id: "r1", organisationId: "org-1" }, data: { category: "Rent" } });
  });

  it("deletes within the org and is NOT_FOUND otherwise", async () => {
    db.categoryRule.deleteMany.mockResolvedValue({ count: 0 });
    await expect(caller().delete({ id: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.categoryRule.deleteMany.mock.calls[0]![0]).toEqual({ where: { id: "x", organisationId: "org-1" } });
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/categorize/category-rules-router.test.ts`
Expected: FAIL because the module doesn't exist.

- [ ] **Step 3: Implement the router and register it**

```ts
// server/routers/categoryRules.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

// Rules come from "Always use…" answers; here they can be re-pointed or removed.
// Changes only affect future imports.
export const categoryRulesRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) =>
    ctx.db.categoryRule.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, kind: true, label: true, category: true, timesApplied: true, lastAppliedAt: true },
    }),
  ),

  update: orgProcedure
    .input(z.object({ id: z.string().min(1), category: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.categoryRule.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { category: input.category },
      });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.categoryRule.deleteMany({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
```

In `server/root.ts`, add `import { categoryRulesRouter } from "@/server/routers/categoryRules";`. Add `categoryRules: categoryRulesRouter,` to the app router next to `smsImport`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run tests/unit/categorize`
Expected: PASS.

- [ ] **Step 5: Build the Settings card**

Open `app/(app)/settings/_components/sms-import-card.tsx` and copy its outer card markup: component names, imports and classes. The structure below uses the shadcn `Card` primitives; if that file uses something else, swap them in.

```tsx
// app/(app)/settings/_components/category-rules-card.tsx
"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryPicker } from "../../pf/transactions/_components/category-picker";

export function CategoryRulesCard() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.categoryRules.list.useQuery();
  const update = trpc.categoryRules.update.useMutation({
    onSuccess: () => void utils.categoryRules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.categoryRules.delete.useMutation({
    onSuccess: () => void utils.categoryRules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category rules</CardTitle>
        <CardDescription>
          Categories Trivio remembers for a transfer recipient or merchant. Changes apply to future imports only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && rules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. When you pick a category for an imported transaction and keep “Always use…” ticked, it appears here.
          </p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">
                {r.kind === "COUNTERPARTY" ? "Transfer" : "Merchant"} · used {r.timesApplied} time{r.timesApplied === 1 ? "" : "s"}
                {r.lastAppliedAt ? ` · last ${new Date(r.lastAppliedAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CategoryPicker value={r.category} onChange={(c) => update.mutate({ id: r.id, category: c })}
                triggerClassName="h-7 px-2 text-xs rounded-full bg-muted" />
              <button type="button" aria-label={`Delete rule for ${r.label}`} disabled={remove.isPending}
                onClick={() => remove.mutate({ id: r.id })} className="text-muted-foreground hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

In `app/(app)/settings/page.tsx`, import `CategoryRulesCard` and render `<CategoryRulesCard />` right after `<SmsImportCard />`. Render it on every platform, because rules apply to statements too.

- [ ] **Step 6: Typecheck, lint, build and commit**

```bash
npm run typecheck 2>&1 | grep -E "categoryRules|category-rules-card|settings/page|root.ts"; npm run lint && npm run build
git add server/routers/categoryRules.ts server/root.ts "app/(app)/settings" tests/unit/categorize/category-rules-router.test.ts
git commit -m "feat(settings): manage remembered category rules"
```

---

### Task 11: Final verification

**Files:** none new.

- [ ] **Step 1: Run the full checks**

Run: `npm run typecheck; npm run typecheck:desktop && npm run lint && npm run test && npm run build`
Expected:
- `typecheck` shows only the 57 pre-existing errors.
- Everything else passes.
- The build reports that there is no Messages database in the build output.

- [ ] **Step 2: Packaged end-to-end check (needs the user)**

Run `npm run build:desktop`. Then ask the user to:
- Quit Trivio.
- Make sure `release/mac-arm64/Trivio.app` is the only Trivio entry under Full Disk Access, re-adding it if needed.
- Open the app.

Expected:
1. Within about 60 s of a Raast/IBFT bank SMS arriving, a notification shows "… — where did this go?".
2. In review, the row shows "Where did this money go?". Picking a category reveals "Always use … for Transfers to ••NNNN", ticked.
3. Approving saves the rule, and it appears under Settings → Category rules.
4. The next SMS to the same number arrives already categorised, and its notification says "(remembered)".
5. A notification disappears only via its ×, and it survives an app restart.
6. A statement import with a transfer row makes the "need a category" banner appear on Transactions, and changing that row offers the same checkbox.

- [ ] **Step 3: Report**

Summarise the test counts and the packaged-app result. Leave branch `feat/sms-import` for review; do not merge or tag.
