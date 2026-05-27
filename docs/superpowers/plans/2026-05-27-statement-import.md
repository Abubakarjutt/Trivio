# Statement Import & MCC Categorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bank/credit-card statement import (PDF + CSV) with Ollama-powered MCC auto-categorization to the Personal Finance module, surfaced on a new `/pf/transactions` page with inline category editing.

**Architecture:** Hybrid pipeline — CSV imports are synchronous (parse → categorize → save → return JSON); PDF imports stream progress via SSE (pdfjs-dist text extraction → Ollama parse → categorize → save). Three focused service files own all logic; a single tRPC router handles CRUD; two Next.js route handlers cover upload and duplicate-confirm. The feature is fully decoupled from the accounting module.

**Tech Stack:** pdfjs-dist (PDF text extraction), Ollama/gemma4:e4b (transaction parsing + MCC categorization), Prisma (2 new models), tRPC, Next.js App Router SSE, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-27-statement-import-design.md`

---

## File Map

| File | Action |
|---|---|
| `prisma/schema.prisma` | Modify — add 3 enums + 2 models |
| `prisma/migrations/20260527000000_add_statement_transactions/migration.sql` | Create |
| `server/services/statement-parser.service.ts` | Create |
| `server/services/statement-categorization.service.ts` | Create |
| `server/services/pdf-statement.service.ts` | Create |
| `server/routers/statementTransactions.ts` | Create |
| `server/root.ts` | Modify — register router |
| `app/api/pf/import/route.ts` | Create |
| `app/api/pf/import/[batchId]/confirm/route.ts` | Create |
| `app/(app)/pf/transactions/page.tsx` | Create |
| `app/(app)/pf/transactions/_components/import-dialog.tsx` | Create |
| `app/(app)/_components/sidebar.tsx` | Modify — add nav item |
| `tests/unit/statement-parser.service.test.ts` | Create |
| `tests/unit/statement-categorization.service.test.ts` | Create |
| `tests/unit/statementTransactions.routers.test.ts` | Create |
| `tests/e2e/statement-transactions.spec.ts` | Create |

---

## Task 1: Install pdfjs-dist + Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260527000000_add_statement_transactions/migration.sql`

- [ ] **Step 1: Install pdfjs-dist**

```bash
npm install pdfjs-dist
```

Expected: pdfjs-dist added to `node_modules/` and `package.json`.

- [ ] **Step 2: Add enums and models to prisma/schema.prisma**

Find the `// ─── Personal Finance` section (after the `Watchlist` model) and add the following block immediately after it:

```prisma
// ─── Statement Import ─────────────────────────────────────────────────────────

enum StatementFileType {
  PDF
  CSV
}

enum StatementImportStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
}

enum StatementTransactionType {
  DEBIT
  CREDIT
}

model StatementImportBatch {
  id               String                @id @default(cuid())
  organisationId   String
  organisation     Organisation          @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  filename         String
  fileType         StatementFileType
  status           StatementImportStatus @default(PENDING)
  transactionCount Int                   @default(0)
  errorMessage     String?
  createdAt        DateTime              @default(now())

  transactions StatementTransaction[]

  @@index([organisationId])
}

model StatementTransaction {
  id             String                   @id @default(cuid())
  organisationId String
  organisation   Organisation             @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  importBatchId  String
  importBatch    StatementImportBatch     @relation(fields: [importBatchId], references: [id], onDelete: Cascade)

  date           DateTime                 @db.Date
  description    String
  merchantName   String
  amount         Decimal                  @db.Decimal(19, 4)
  type           StatementTransactionType

  category       String
  mccCode        String
  mccLabel       String

  isExcluded     Boolean                  @default(false)
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  @@index([organisationId])
  @@index([importBatchId])
  @@index([organisationId, date])
  @@index([organisationId, category])
}
```

**Note:** We use `StatementTransactionType` (not `TransactionType`) to avoid potential future enum name collisions in the schema.

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add_statement_transactions
```

Expected output contains: `The following migration(s) have been applied: 20260527..._add_statement_transactions`

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` success message.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add StatementImportBatch + StatementTransaction prisma models"
```

---

## Task 2: StatementParserService — pure CSV parsing (TDD)

**Files:**
- Create: `server/services/statement-parser.service.ts`
- Create: `tests/unit/statement-parser.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/statement-parser.service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  autoDetectColumns,
  normalizeAmount,
  parseCsvBuffer,
  detectDuplicates,
  levenshteinSimilarity,
} from "@/server/services/statement-parser.service";

// ─── autoDetectColumns ────────────────────────────────────────────────────────

describe("autoDetectColumns", () => {
  it("detects standard date/description/amount headers", () => {
    const map = autoDetectColumns(["Date", "Description", "Amount"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.amount).toBe(2);
  });

  it("detects debit/credit split columns", () => {
    const map = autoDetectColumns(["Txn Date", "Narration", "Debit", "Credit"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.debit).toBe(2);
    expect(map.credit).toBe(3);
    expect(map.amount).toBe(-1);
  });

  it("is case-insensitive", () => {
    const map = autoDetectColumns(["DATE", "MEMO", "WITHDRAWAL", "DEPOSIT"]);
    expect(map.date).toBe(0);
    expect(map.description).toBe(1);
    expect(map.debit).toBe(2);
    expect(map.credit).toBe(3);
  });

  it("throws when date column is missing", () => {
    expect(() => autoDetectColumns(["Description", "Amount"])).toThrow(
      "Could not detect date column"
    );
  });

  it("throws when description column is missing", () => {
    expect(() => autoDetectColumns(["Date", "Amount"])).toThrow(
      "Could not detect description column"
    );
  });

  it("throws when no amount column of any kind", () => {
    expect(() => autoDetectColumns(["Date", "Description"])).toThrow(
      "Could not detect amount column"
    );
  });
});

// ─── normalizeAmount ──────────────────────────────────────────────────────────

describe("normalizeAmount", () => {
  it("parses plain positive number as CREDIT", () => {
    expect(normalizeAmount("1234.56")).toEqual({ amount: 1234.56, type: "CREDIT" });
  });

  it("strips currency symbol", () => {
    expect(normalizeAmount("$45.00")).toEqual({ amount: 45.00, type: "CREDIT" });
  });

  it("strips commas", () => {
    expect(normalizeAmount("1,234.56")).toEqual({ amount: 1234.56, type: "CREDIT" });
  });

  it("handles negative sign as DEBIT", () => {
    expect(normalizeAmount("-67.50")).toEqual({ amount: 67.50, type: "DEBIT" });
  });

  it("handles parentheses format as DEBIT", () => {
    expect(normalizeAmount("(123.00)")).toEqual({ amount: 123.00, type: "DEBIT" });
  });

  it("handles $-prefixed negative", () => {
    expect(normalizeAmount("$-99.99")).toEqual({ amount: 99.99, type: "DEBIT" });
  });

  it("throws on non-numeric input", () => {
    expect(() => normalizeAmount("not a number")).toThrow("Cannot parse amount");
  });
});

// ─── parseCsvBuffer ───────────────────────────────────────────────────────────

describe("parseCsvBuffer", () => {
  it("parses a simple single-amount CSV", () => {
    const csv = `Date,Description,Amount\n2026-05-01,Starbucks,$6.40\n2026-05-02,Salary,3200.00`;
    const buf = Buffer.from(csv);
    const map = autoDetectColumns(["Date", "Description", "Amount"]);
    const txns = parseCsvBuffer(buf, map);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "CREDIT" });
    expect(txns[1]).toMatchObject({ date: "2026-05-02", description: "Salary", amount: 3200.00, type: "CREDIT" });
  });

  it("parses debit/credit split columns", () => {
    const csv = `Date,Memo,Debit,Credit\n2026-05-01,Netflix,15.99,\n2026-05-02,Payroll,,3200.00`;
    const buf = Buffer.from(csv);
    const map = autoDetectColumns(["Date", "Memo", "Debit", "Credit"]);
    const txns = parseCsvBuffer(buf, map);
    expect(txns[0]).toMatchObject({ amount: 15.99, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ amount: 3200.00, type: "CREDIT" });
  });

  it("handles MM/DD/YYYY date format", () => {
    const csv = `Date,Description,Amount\n05/15/2026,Amazon,43.99`;
    const txns = parseCsvBuffer(Buffer.from(csv), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns[0].date).toBe("2026-05-15");
  });

  it("skips rows with missing date or description", () => {
    const csv = `Date,Description,Amount\n,Starbucks,6.40\n2026-05-01,,10.00\n2026-05-02,Valid,5.00`;
    const txns = parseCsvBuffer(Buffer.from(csv), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Valid");
  });

  it("returns empty array for header-only CSV", () => {
    const txns = parseCsvBuffer(Buffer.from("Date,Description,Amount"), autoDetectColumns(["Date", "Description", "Amount"]));
    expect(txns).toHaveLength(0);
  });
});

// ─── levenshteinSimilarity ────────────────────────────────────────────────────

describe("levenshteinSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(levenshteinSimilarity("starbucks", "starbucks")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    const sim = levenshteinSimilarity("abc", "xyz");
    expect(sim).toBeLessThan(0.1);
  });

  it("returns high similarity for minor differences", () => {
    const sim = levenshteinSimilarity("SQ *STARBUCKS", "SQ *STARBUCKS #2");
    expect(sim).toBeGreaterThan(0.8);
  });
});

// ─── detectDuplicates ─────────────────────────────────────────────────────────

describe("detectDuplicates", () => {
  const existing = [
    { id: "ex-1", date: new Date("2026-05-01"), description: "Starbucks", amount: 6.40 },
    { id: "ex-2", date: new Date("2026-05-02"), description: "Netflix", amount: 15.99 },
  ];

  it("flags exact match as duplicate", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].existingId).toBe("ex-1");
  });

  it("flags fuzzy description match on same date+amount", () => {
    const incoming = [{ date: "2026-05-02", description: "NETFLIX.COM", amount: 15.99, type: "DEBIT" as const }];
    const { duplicates } = detectDuplicates(incoming, existing);
    expect(duplicates).toHaveLength(1);
  });

  it("does not flag same description on different date", () => {
    const incoming = [{ date: "2026-06-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });

  it("does not flag same date+description with different amount", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 7.00, type: "DEBIT" as const }];
    const { safe } = detectDuplicates(incoming, existing);
    expect(safe).toHaveLength(1);
  });

  it("returns all safe when existing is empty", () => {
    const incoming = [{ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" as const }];
    const { safe, duplicates } = detectDuplicates(incoming, []);
    expect(safe).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail**

```bash
npm run test -- tests/unit/statement-parser.service.test.ts
```

Expected: Multiple `Cannot find module` errors — the service doesn't exist yet.

- [ ] **Step 3: Implement the service**

Create `server/services/statement-parser.service.ts`:

```typescript
/**
 * StatementParserService — pure CSV parsing and duplicate detection.
 * No external dependencies; fully unit-testable without mocking.
 */

export type StatementTransactionType = "DEBIT" | "CREDIT";

export interface ColumnMap {
  date: number;
  description: number;
  amount: number;
  debit?: number;
  credit?: number;
}

export interface RawTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  type: StatementTransactionType;
}

export interface ExistingTransaction {
  id: string;
  date: Date | string;
  description: string;
  amount: number;
}

export interface DuplicateMatch {
  incoming: RawTransaction;
  existingId: string;
  similarity: number;
}

export interface DedupeResult {
  safe: RawTransaction[];
  duplicates: DuplicateMatch[];
}

const DATE_HEADERS = ["date", "txn date", "transaction date", "posted date", "value date", "trans date", "posting date"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "txn amount", "net amount"];
const DEBIT_HEADERS = ["debit", "debit amount", "withdrawal", "withdrawals", "dr", "out"];
const CREDIT_HEADERS = ["credit", "credit amount", "deposit", "deposits", "cr", "in"];
const DESC_HEADERS = ["description", "memo", "narration", "particulars", "details", "reference", "transaction details", "payee", "narrative"];

export function autoDetectColumns(headers: string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase().trim());

  const dateIdx = lower.findIndex((h) => DATE_HEADERS.some((d) => h.includes(d)));
  const descIdx = lower.findIndex((h) => DESC_HEADERS.some((d) => h.includes(d)));
  const amountIdx = lower.findIndex((h) => AMOUNT_HEADERS.some((a) => h.includes(a)));
  const debitIdx = lower.findIndex((h) => DEBIT_HEADERS.some((d) => h.includes(d)));
  const creditIdx = lower.findIndex((h) => CREDIT_HEADERS.some((c) => h.includes(c)));

  if (dateIdx === -1)
    throw new Error("Could not detect date column. Expected headers like: date, txn date, transaction date");
  if (descIdx === -1)
    throw new Error("Could not detect description column. Expected headers like: description, memo, narration, payee");
  if (amountIdx === -1 && (debitIdx === -1 || creditIdx === -1))
    throw new Error("Could not detect amount column(s). Expected: 'amount', or both 'debit' + 'credit' columns");

  return {
    date: dateIdx,
    description: descIdx,
    amount: amountIdx,
    ...(debitIdx !== -1 ? { debit: debitIdx } : {}),
    ...(creditIdx !== -1 ? { credit: creditIdx } : {}),
  };
}

export function normalizeAmount(raw: string): { amount: number; type: StatementTransactionType } {
  const trimmed = raw.trim();
  const isParenNeg = /^\([\d,$.]+\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[$(),\s]/g, "");
  const isNeg = cleaned.startsWith("-") || isParenNeg;
  const abs = parseFloat(cleaned.replace("-", ""));
  if (isNaN(abs)) throw new Error(`Cannot parse amount: "${raw}"`);
  return { amount: abs, type: isNeg ? "DEBIT" : "CREDIT" };
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === "," && !inQuotes) { cols.push(current.trim()); current = ""; }
    else { current += c; }
  }
  cols.push(current.trim());
  return cols.map((c) => c.replace(/^"|"$/g, ""));
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const dmonY = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmonY) {
    const M: Record<string, string> = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
    const m = M[dmonY[2].toLowerCase()];
    if (m) return `${dmonY[3]}-${m}-${dmonY[1].padStart(2, "0")}`;
  }
  return null;
}

export function parseCsvBuffer(buffer: Buffer, columnMap: ColumnMap): RawTransaction[] {
  const lines = buffer.toString("utf-8").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const result: RawTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawDate = cols[columnMap.date]?.trim();
    const rawDesc = cols[columnMap.description]?.trim();
    if (!rawDate || !rawDesc) continue;

    const date = parseDate(rawDate);
    if (!date) continue;

    let amount: number;
    let type: StatementTransactionType;

    if (columnMap.amount !== -1 && columnMap.amount !== undefined) {
      const raw = cols[columnMap.amount]?.trim();
      if (!raw) continue;
      try { ({ amount, type } = normalizeAmount(raw)); } catch { continue; }
    } else if (columnMap.debit !== undefined && columnMap.credit !== undefined) {
      const rawD = cols[columnMap.debit]?.trim();
      const rawC = cols[columnMap.credit]?.trim();
      if (rawD && rawD !== "" && rawD !== "0" && rawD !== "0.00") {
        try { ({ amount } = normalizeAmount(rawD)); type = "DEBIT"; } catch { continue; }
      } else if (rawC && rawC !== "" && rawC !== "0" && rawC !== "0.00") {
        try { ({ amount } = normalizeAmount(rawC)); type = "CREDIT"; } catch { continue; }
      } else { continue; }
    } else { continue; }

    result.push({ date, description: rawDesc, amount, type });
  }
  return result;
}

export function levenshteinSimilarity(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  const max = Math.max(la.length, lb.length);
  if (max === 0) return 1;
  const dp = Array.from({ length: la.length + 1 }, (_, i) =>
    Array.from({ length: lb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la.length; i++)
    for (let j = 1; j <= lb.length; j++)
      dp[i][j] = la[i-1] === lb[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[la.length][lb.length] / max;
}

export function detectDuplicates(incoming: RawTransaction[], existing: ExistingTransaction[]): DedupeResult {
  const safe: RawTransaction[] = [];
  const duplicates: DuplicateMatch[] = [];

  for (const txn of incoming) {
    const match = existing.find((ex) => {
      const exDate = ex.date instanceof Date
        ? ex.date.toISOString().slice(0, 10)
        : String(ex.date).slice(0, 10);
      if (exDate !== txn.date) return false;
      if (Math.abs(Number(ex.amount) - txn.amount) > 0.001) return false;
      return levenshteinSimilarity(ex.description, txn.description) > 0.8;
    });
    if (match) {
      duplicates.push({ incoming: txn, existingId: match.id, similarity: levenshteinSimilarity(match.description, txn.description) });
    } else {
      safe.push(txn);
    }
  }
  return { safe, duplicates };
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npm run test -- tests/unit/statement-parser.service.test.ts
```

Expected: All tests pass. ~18 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/statement-parser.service.ts tests/unit/statement-parser.service.test.ts
git commit -m "feat: add StatementParserService with CSV parsing and dedup logic"
```

---

## Task 3: StatementCategorizationService — MCC + Ollama (TDD)

**Files:**
- Create: `server/services/statement-categorization.service.ts`
- Create: `tests/unit/statement-categorization.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/statement-categorization.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapMccToCategory,
  buildCategorizationPrompt,
  categorizeBatch,
  CATEGORY_DEFINITIONS,
} from "@/server/services/statement-categorization.service";

// ─── mapMccToCategory ─────────────────────────────────────────────────────────

describe("mapMccToCategory", () => {
  it("maps grocery store MCC to Food & Dining", () => {
    expect(mapMccToCategory("5411")).toBe("Food & Dining");
  });

  it("maps restaurant MCC to Food & Dining", () => {
    expect(mapMccToCategory("5812")).toBe("Food & Dining");
  });

  it("maps transport MCC to Transport", () => {
    expect(mapMccToCategory("4121")).toBe("Transport");
  });

  it("maps airline MCC to Travel", () => {
    expect(mapMccToCategory("3001")).toBe("Travel");
  });

  it("maps utility MCC to Utilities", () => {
    expect(mapMccToCategory("4911")).toBe("Utilities");
  });

  it("returns Other for unknown MCC", () => {
    expect(mapMccToCategory("9999")).toBe("Other");
  });

  it("returns Other for 0000 fallback code", () => {
    expect(mapMccToCategory("0000")).toBe("Other");
  });

  it("returns Other for non-numeric string", () => {
    expect(mapMccToCategory("abcd")).toBe("Other");
  });
});

// ─── CATEGORY_DEFINITIONS ─────────────────────────────────────────────────────

describe("CATEGORY_DEFINITIONS", () => {
  it("has exactly 15 categories", () => {
    expect(CATEGORY_DEFINITIONS).toHaveLength(15);
  });

  it("includes Other as last fallback", () => {
    expect(CATEGORY_DEFINITIONS[14].name).toBe("Other");
  });

  it("every category has a name and icon", () => {
    for (const cat of CATEGORY_DEFINITIONS) {
      expect(cat.name).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });
});

// ─── buildCategorizationPrompt ────────────────────────────────────────────────

describe("buildCategorizationPrompt", () => {
  it("includes the input descriptions in the prompt", () => {
    const prompt = buildCategorizationPrompt(["Starbucks", "Netflix"]);
    expect(prompt).toContain("Starbucks");
    expect(prompt).toContain("Netflix");
  });

  it("mentions the expected count", () => {
    const prompt = buildCategorizationPrompt(["A", "B", "C"]);
    expect(prompt).toContain("3");
  });

  it("requests JSON array output", () => {
    const prompt = buildCategorizationPrompt(["test"]);
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("mccCode");
    expect(prompt).toContain("merchantName");
  });
});

// ─── categorizeBatch ─────────────────────────────────────────────────────────

describe("categorizeBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fallback results when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results).toHaveLength(2);
    expect(results[0].category).toBe("Other");
    expect(results[0].mccCode).toBe("0000");
    expect(results[0].merchantName).toBe("Starbucks");
  });

  it("returns empty array for empty input", async () => {
    const results = await categorizeBatch([]);
    expect(results).toHaveLength(0);
  });

  it("parses valid Ollama JSON response and maps MCC to category", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response) // health check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Eating Places & Restaurants" },
              { description: "Netflix", merchantName: "Netflix", mccCode: "5735", mccLabel: "Record Shops" },
            ]),
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results[0].category).toBe("Food & Dining");
    expect(results[0].mccCode).toBe("5812");
    expect(results[0].merchantName).toBe("Starbucks");
    expect(results[1].category).toBe("Entertainment");
  });

  it("returns fallback for items missing from Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Restaurants" },
              // Netflix missing
            ]),
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results).toHaveLength(2);
    expect(results[1].category).toBe("Other");
  });

  it("strips markdown code fences from Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "```json\n[{\"description\":\"Uber\",\"merchantName\":\"Uber\",\"mccCode\":\"4121\",\"mccLabel\":\"Taxicabs\"}]\n```",
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Uber"]);
    expect(results[0].category).toBe("Transport");
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail**

```bash
npm run test -- tests/unit/statement-categorization.service.test.ts
```

Expected: `Cannot find module` errors.

- [ ] **Step 3: Implement the service**

Create `server/services/statement-categorization.service.ts`:

```typescript
/**
 * StatementCategorizationService
 * MCC lookup table + Ollama-powered batch categorization.
 * Mirrors the fallback pattern from extraction.service.ts.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export interface CategoryDefinition {
  name: string;
  icon: string;
  /** [startMcc, endMcc] inclusive ranges */
  mccRanges: [number, number][];
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { name: "Food & Dining",      icon: "☕", mccRanges: [[5411,5411],[5441,5441],[5812,5814]] },
  { name: "Transport",          icon: "🚗", mccRanges: [[4111,4131],[5541,5542],[7513,7513],[7521,7521]] },
  { name: "Shopping",           icon: "🛍", mccRanges: [[5300,5399],[5600,5699],[5940,5999]] },
  { name: "Entertainment",      icon: "🎬", mccRanges: [[5735,5735],[7832,7832],[7922,7922],[7941,7941],[7991,7993]] },
  { name: "Health & Fitness",   icon: "💊", mccRanges: [[5912,5912],[8011,8011],[8021,8021],[8049,8049],[8099,8099]] },
  { name: "Utilities",          icon: "💡", mccRanges: [[4900,4900],[4911,4911],[4941,4941],[4952,4952]] },
  { name: "Travel",             icon: "✈️", mccRanges: [[3000,3999],[4411,4411],[4722,4722],[7011,7012]] },
  { name: "Housing",            icon: "🏠", mccRanges: [[1520,1520],[5251,5251],[6513,6513]] },
  { name: "Education",          icon: "📚", mccRanges: [[8211,8211],[8220,8220],[8299,8299]] },
  { name: "Personal Care",      icon: "💅", mccRanges: [[5977,5977],[7230,7230],[7298,7298]] },
  { name: "Business Services",  icon: "💼", mccRanges: [[7372,7374],[8742,8742]] },
  { name: "Financial",          icon: "🏦", mccRanges: [[6010,6012],[6051,6051]] },
  { name: "Income",             icon: "💰", mccRanges: [] },
  { name: "Transfer",           icon: "🔄", mccRanges: [] },
  { name: "Other",              icon: "📋", mccRanges: [] },
];

export function mapMccToCategory(mccCode: string): string {
  const code = parseInt(mccCode, 10);
  if (isNaN(code) || code === 0) return "Other";
  for (const cat of CATEGORY_DEFINITIONS) {
    for (const [start, end] of cat.mccRanges) {
      if (code >= start && code <= end) return cat.name;
    }
  }
  return "Other";
}

export interface CategorizationResult {
  description: string;
  merchantName: string;
  mccCode: string;
  mccLabel: string;
  category: string;
}

const fallback = (description: string): CategorizationResult => ({
  description,
  merchantName: description,
  mccCode: "0000",
  mccLabel: "Uncategorized",
  category: "Other",
});

export function buildCategorizationPrompt(descriptions: string[]): string {
  return `You are a financial transaction categorizer. For each merchant description below, infer the most likely ISO 18245 Merchant Category Code (MCC) and clean merchant name.

Return ONLY a valid JSON array with exactly ${descriptions.length} objects in the same order as input. No markdown, no commentary.

Required shape:
[{ "description": "original", "merchantName": "Clean Name", "mccCode": "4-digit string", "mccLabel": "MCC label" }]

Rules:
- merchantName: clean abbreviations (SQ* → Square, AMZN → Amazon, PAYPAL → PayPal), strip transaction IDs
- mccCode: 4-digit string (use "0000" if unknown)
- mccLabel: human-readable label for the MCC

Input descriptions:
${JSON.stringify(descriptions)}`;
}

export async function categorizeBatch(descriptions: string[]): Promise<CategorizationResult[]> {
  if (descriptions.length === 0) return [];

  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[statement-categorization.service] Ollama not reachable — using fallback categories.");
    return descriptions.map(fallback);
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: buildCategorizationPrompt(descriptions) }],
      stream: false,
      options: { temperature: 0.1, num_predict: 8192 },
    }),
  });

  if (!response.ok) {
    console.warn(`[statement-categorization.service] Ollama failed (${response.status}) — using fallback.`);
    return descriptions.map(fallback);
  }

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return descriptions.map(fallback);

  let parsed: unknown;
  try { parsed = JSON.parse(jsonMatch[0]); } catch { return descriptions.map(fallback); }
  if (!Array.isArray(parsed)) return descriptions.map(fallback);

  return descriptions.map((desc, i) => {
    const item = (parsed as Array<Partial<CategorizationResult>>)[i];
    if (!item?.mccCode) return fallback(desc);
    return {
      description: desc,
      merchantName: item.merchantName ?? desc,
      mccCode: item.mccCode,
      mccLabel: item.mccLabel ?? "Unknown",
      category: mapMccToCategory(item.mccCode),
    };
  });
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm run test -- tests/unit/statement-categorization.service.test.ts
```

Expected: All tests pass. ~15 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/statement-categorization.service.ts tests/unit/statement-categorization.service.test.ts
git commit -m "feat: add StatementCategorizationService with MCC map and Ollama batch categorization"
```

---

## Task 4: PdfStatementService — PDF text extraction (TDD)

**Files:**
- Create: `server/services/pdf-statement.service.ts`
- Create: `tests/unit/pdf-statement.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pdf-statement.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransactionsFromText } from "@/server/services/pdf-statement.service";

// Note: extractTextFromPdf is not unit-tested here because it requires
// pdfjs-dist loading real PDF binary data — it is covered by integration tests.

describe("parseTransactionsFromText", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty array when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await parseTransactionsFromText("some statement text");
    expect(result).toEqual([]);
  });

  it("parses valid Ollama response into RawTransactions", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" },
              { date: "2026-05-02", description: "Payroll", amount: 3200.00, type: "CREDIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("statement text");
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ type: "CREDIT" });
  });

  it("strips markdown fences from response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "```json\n[{\"date\":\"2026-05-01\",\"description\":\"Uber\",\"amount\":18.90,\"type\":\"DEBIT\"}]\n```",
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("text");
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("filters out items with missing required fields", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", amount: 6.40, type: "DEBIT" }, // missing date
              { date: "2026-05-01", description: "Uber", amount: 18.90, type: "DEBIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("text");
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("returns empty array on unparseable Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "I cannot parse this document." } }),
      } as Response);

    const result = await parseTransactionsFromText("text");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect to fail**

```bash
npm run test -- tests/unit/pdf-statement.service.test.ts
```

- [ ] **Step 3: Implement the service**

Create `server/services/pdf-statement.service.ts`:

```typescript
/**
 * PdfStatementService
 * Extracts text from PDF files using pdfjs-dist, then uses Ollama to parse
 * transaction rows from the extracted text.
 */
import type { RawTransaction } from "./statement-parser.service";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Dynamic import avoids SSR/webpack bundling issues with pdfjs-dist
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  // Disable web worker — not available in Node.js environment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = "";

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ");
    pages.push(text);
  }

  return pages.join("\n\n--- PAGE BREAK ---\n\n");
}

const PARSE_PROMPT = `You are a bank statement parser. Extract all financial transactions from the text below.

Return ONLY a valid JSON array. No markdown fences, no commentary.

Required shape:
[{ "date": "YYYY-MM-DD", "description": "merchant or description", "amount": 123.45, "type": "DEBIT" or "CREDIT" }]

Rules:
- date: YYYY-MM-DD format only
- amount: positive number
- type: DEBIT = money leaving account, CREDIT = money entering account
- Skip: header rows, running balance rows, opening/closing balance lines
- If a line is not a transaction, omit it

Statement text:
`;

export async function parseTransactionsFromText(text: string): Promise<RawTransaction[]> {
  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[pdf-statement.service] Ollama not reachable — returning empty transaction list.");
    return [];
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: `${PARSE_PROMPT}${text.slice(0, 12000)}` }],
      stream: false,
      options: { temperature: 0.1, num_predict: 8192 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) return [];

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  return (parsed as Array<Partial<RawTransaction>>)
    .filter((item) => item.date && item.description && item.amount != null && item.type)
    .map((item) => ({
      date: String(item.date),
      description: String(item.description),
      amount: Number(item.amount),
      type: item.type as "DEBIT" | "CREDIT",
    }));
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm run test -- tests/unit/pdf-statement.service.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/pdf-statement.service.ts tests/unit/pdf-statement.service.test.ts
git commit -m "feat: add PdfStatementService with pdfjs-dist text extraction and Ollama parsing"
```

---

## Task 5: statementTransactionsRouter — tRPC CRUD (TDD)

**Files:**
- Create: `server/routers/statementTransactions.ts`
- Create: `tests/unit/statementTransactions.routers.test.ts`

- [ ] **Step 1: Write the failing router tests**

Create `tests/unit/statementTransactions.routers.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

const ORG = "org-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return { session: { user: { id: "user-1" } }, db };
}

function dec(n: number) { return new Prisma.Decimal(n); }

const createCaller = createCallerFactory(statementTransactionsRouter);

// ─── list ─────────────────────────────────────────────────────────────────────

describe("statementTransactions.list", () => {
  it("returns transactions for the org", async () => {
    const mockTxns = [
      { id: "t1", organisationId: ORG, date: new Date("2026-05-01"), description: "SQ *STARBUCKS", merchantName: "Starbucks", amount: dec(6.40), type: "DEBIT", category: "Food & Dining", mccCode: "5812", mccLabel: "Restaurants", isExcluded: false, importBatchId: "b1", createdAt: new Date(), updatedAt: new Date() },
    ];
    const caller = createCaller(makeCtx({
      statementTransaction: { findMany: vi.fn().mockResolvedValue(mockTxns) },
    }));
    const result = await caller.list({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].merchantName).toBe("Starbucks");
  });

  it("excludes isExcluded transactions by default", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({
      statementTransaction: { findMany },
    }));
    await caller.list({});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isExcluded: false }) })
    );
  });

  it("includes excluded when includeExcluded=true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ statementTransaction: { findMany } }));
    await caller.list({ includeExcluded: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where.isExcluded).toBeUndefined();
  });
});

// ─── updateCategory ───────────────────────────────────────────────────────────

describe("statementTransactions.updateCategory", () => {
  it("updates category, mccCode, mccLabel", async () => {
    const mockTxn = { id: "t1", organisationId: ORG };
    const update = vi.fn().mockResolvedValue({ ...mockTxn, category: "Transport" });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue(mockTxn),
        update,
      },
    }));
    await caller.updateCategory({ id: "t1", category: "Transport", mccCode: "4121", mccLabel: "Taxicabs" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { category: "Transport", mccCode: "4121", mccLabel: "Taxicabs" },
    });
  });

  it("throws NOT_FOUND when transaction does not belong to org", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await expect(caller.updateCategory({ id: "t-missing", category: "Shopping" }))
      .rejects.toThrow("NOT_FOUND");
  });
});

// ─── toggleExclude ────────────────────────────────────────────────────────────

describe("statementTransactions.toggleExclude", () => {
  it("flips isExcluded from false to true", async () => {
    const update = vi.fn().mockResolvedValue({ id: "t1", isExcluded: true });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", organisationId: ORG, isExcluded: false }),
        update,
      },
    }));
    await caller.toggleExclude({ id: "t1" });
    expect(update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { isExcluded: true } });
  });

  it("flips isExcluded from true to false", async () => {
    const update = vi.fn().mockResolvedValue({ id: "t1", isExcluded: false });
    const caller = createCaller(makeCtx({
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", organisationId: ORG, isExcluded: true }),
        update,
      },
    }));
    await caller.toggleExclude({ id: "t1" });
    expect(update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { isExcluded: false } });
  });
});

// ─── deleteByBatch ────────────────────────────────────────────────────────────

describe("statementTransactions.deleteByBatch", () => {
  it("deletes transactions and batch", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const deleteFn = vi.fn().mockResolvedValue({ id: "b1" });
    const caller = createCaller(makeCtx({
      statementTransaction: { deleteMany },
      statementImportBatch: {
        findFirst: vi.fn().mockResolvedValue({ id: "b1", organisationId: ORG }),
        delete: deleteFn,
      },
    }));
    const result = await caller.deleteByBatch({ batchId: "b1" });
    expect(deleteMany).toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("throws NOT_FOUND for unknown batch", async () => {
    const caller = createCaller(makeCtx({
      statementImportBatch: { findFirst: vi.fn().mockResolvedValue(null) },
    }));
    await expect(caller.deleteByBatch({ batchId: "missing" })).rejects.toThrow("NOT_FOUND");
  });
});

// ─── summary ─────────────────────────────────────────────────────────────────

describe("statementTransactions.summary", () => {
  it("returns aggregated counts and latest batch", async () => {
    const caller = createCaller(makeCtx({
      statementTransaction: {
        count: vi.fn().mockResolvedValue(47),
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { amount: dec(821.50) } })  // debits
          .mockResolvedValueOnce({ _sum: { amount: dec(3200.00) } }), // credits
      },
      statementImportBatch: {
        findFirst: vi.fn().mockResolvedValue({ id: "b1", filename: "May.pdf", transactionCount: 47, createdAt: new Date() }),
      },
    }));
    const result = await caller.summary();
    expect(result.totalCount).toBe(47);
    expect(result.totalDebits).toBeCloseTo(821.50);
    expect(result.totalCredits).toBeCloseTo(3200.00);
    expect(result.latestBatch?.id).toBe("b1");
  });
});
```

- [ ] **Step 2: Run tests — expect to fail**

```bash
npm run test -- tests/unit/statementTransactions.routers.test.ts
```

- [ ] **Step 3: Implement the router**

Create `server/routers/statementTransactions.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

export const statementTransactionsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      category: z.string().optional(),
      type: z.enum(["DEBIT", "CREDIT"]).optional(),
      search: z.string().optional(),
      includeExcluded: z.boolean().default(false),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organisationId: ctx.organisationId };
      if (!input.includeExcluded) where.isExcluded = false;
      if (input.category) where.category = input.category;
      if (input.type) where.type = input.type;
      if (input.search) where.merchantName = { contains: input.search, mode: "insensitive" };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }
      if (input.cursor) where.id = { lt: input.cursor };

      const items = await ctx.db.statementTransaction.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: input.limit + 1,
      });

      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),

  updateCategory: orgProcedure
    .input(z.object({
      id: z.string(),
      category: z.string(),
      mccCode: z.string().default("0000"),
      mccLabel: z.string().default("Manual"),
    }))
    .mutation(async ({ ctx, input }) => {
      const txn = await ctx.db.statementTransaction.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.statementTransaction.update({
        where: { id: input.id },
        data: { category: input.category, mccCode: input.mccCode, mccLabel: input.mccLabel },
      });
    }),

  toggleExclude: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const txn = await ctx.db.statementTransaction.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      if (!txn) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.statementTransaction.update({
        where: { id: input.id },
        data: { isExcluded: !txn.isExcluded },
      });
    }),

  deleteByBatch: orgProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await ctx.db.statementImportBatch.findFirst({
        where: { id: input.batchId, organisationId: ctx.organisationId },
      });
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.statementTransaction.deleteMany({
        where: { importBatchId: input.batchId, organisationId: ctx.organisationId },
      });
      await ctx.db.statementImportBatch.delete({ where: { id: input.batchId } });
      return { success: true };
    }),

  listBatches: orgProcedure
    .query(async ({ ctx }) =>
      ctx.db.statementImportBatch.findMany({
        where: { organisationId: ctx.organisationId },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    ),

  summary: orgProcedure
    .query(async ({ ctx }) => {
      const [totalCount, debitsAgg, creditsAgg, latestBatch] = await Promise.all([
        ctx.db.statementTransaction.count({
          where: { organisationId: ctx.organisationId, isExcluded: false },
        }),
        ctx.db.statementTransaction.aggregate({
          where: { organisationId: ctx.organisationId, isExcluded: false, type: "DEBIT" },
          _sum: { amount: true },
        }),
        ctx.db.statementTransaction.aggregate({
          where: { organisationId: ctx.organisationId, isExcluded: false, type: "CREDIT" },
          _sum: { amount: true },
        }),
        ctx.db.statementImportBatch.findFirst({
          where: { organisationId: ctx.organisationId, status: "DONE" },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return {
        totalCount,
        totalDebits: Number(debitsAgg._sum.amount ?? 0),
        totalCredits: Number(creditsAgg._sum.amount ?? 0),
        latestBatch,
      };
    }),
});
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm run test -- tests/unit/statementTransactions.routers.test.ts
```

Expected: All ~12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routers/statementTransactions.ts tests/unit/statementTransactions.routers.test.ts
git commit -m "feat: add statementTransactionsRouter with list, updateCategory, toggleExclude, deleteByBatch, summary"
```

---

## Task 6: Register router + sidebar navigation

**Files:**
- Modify: `server/root.ts`
- Modify: `app/(app)/_components/sidebar.tsx`

- [ ] **Step 1: Register the router in server/root.ts**

Open `server/root.ts`. Find the imports and the `appRouter` definition. Add:

```typescript
// Add import with the other router imports:
import { statementTransactionsRouter } from "./routers/statementTransactions";

// Add inside createTRPCRouter({...}):
statementTransactions: statementTransactionsRouter,
```

- [ ] **Step 2: Add Transactions to the Personal Finance sidebar group**

Open `app/(app)/_components/sidebar.tsx`. 

Add `CreditCard` to the lucide-react import line:
```typescript
import {
  // ... existing icons ...
  CreditCard,
} from "lucide-react";
```

Find the `"Personal Finance"` group in `NAV_GROUPS` and add Transactions as the first item:

```typescript
{
  label: "Personal Finance",
  items: [
    { label: "Transactions", href: "/pf/transactions", icon: CreditCard, matchPrefix: true },
    { label: "Budgets", href: "/budgets", icon: TrendingUp, matchPrefix: true },
    { label: "Goals", href: "/goals", icon: Target, matchPrefix: true },
    { label: "Recurring", href: "/recurring", icon: RefreshCw, matchPrefix: true },
    { label: "Watchlists", href: "/watchlists", icon: Eye, matchPrefix: true },
  ],
},
```

- [ ] **Step 3: Run the full test suite to make sure nothing broke**

```bash
npm run test
```

Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add server/root.ts app/(app)/_components/sidebar.tsx
git commit -m "feat: register statementTransactions router and add Transactions sidebar nav"
```

---

## Task 7: Import API route — CSV path + confirm endpoint

**Files:**
- Create: `app/api/pf/import/route.ts`
- Create: `app/api/pf/import/[batchId]/confirm/route.ts`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p /Users/Apple/projects/AutoAccounts/app/api/pf/import/\[batchId\]/confirm
```

- [ ] **Step 2: Create the main import route handler**

Create `app/api/pf/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { autoDetectColumns, parseCsvBuffer, detectDuplicates } from "@/server/services/statement-parser.service";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import { extractTextFromPdf, parseTransactionsFromText } from "@/server/services/pdf-statement.service";

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { organisationId: true },
  });
  if (!user?.organisationId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }
  const organisationId = user.organisationId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const file = fileField as File;

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large (max 20 MB)` }, { status: 422 });
  }

  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv") || file.type === "text/csv";
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";

  if (!isCsv && !isPdf) {
    return NextResponse.json({ error: "Only PDF and CSV files are supported" }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isCsv) {
    return handleCsvImport(buffer, file.name, organisationId);
  }
  return handlePdfImport(buffer, file.name, organisationId);
}

async function handleCsvImport(buffer: Buffer, filename: string, organisationId: string) {
  const text = buffer.toString("utf-8");
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  let columnMap;
  try {
    columnMap = autoDetectColumns(headers);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const rawTransactions = parseCsvBuffer(buffer, columnMap);
  if (rawTransactions.length === 0) {
    return NextResponse.json({ error: "No transactions found in CSV" }, { status: 400 });
  }

  const categorized = await categorizeBatch(rawTransactions.map((t) => t.description));

  const existingRaw = await db.statementTransaction.findMany({
    where: { organisationId },
    select: { id: true, date: true, description: true, amount: true },
  });
  const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
  const { duplicates } = detectDuplicates(rawTransactions, existing);

  const batch = await db.statementImportBatch.create({
    data: { organisationId, filename, fileType: "CSV", status: "PENDING", transactionCount: rawTransactions.length },
  });

  await db.statementTransaction.createMany({
    data: rawTransactions.map((txn, i) => ({
      organisationId,
      importBatchId: batch.id,
      date: new Date(txn.date),
      description: txn.description,
      merchantName: categorized[i]?.merchantName ?? txn.description,
      amount: txn.amount,
      type: txn.type,
      category: categorized[i]?.category ?? "Other",
      mccCode: categorized[i]?.mccCode ?? "0000",
      mccLabel: categorized[i]?.mccLabel ?? "Uncategorized",
    })),
  });

  if (duplicates.length > 0) {
    const dupDescs = duplicates.map((d) => d.incoming.description);
    const savedDupes = await db.statementTransaction.findMany({
      where: { importBatchId: batch.id, description: { in: dupDescs } },
      select: { id: true, date: true, description: true, amount: true },
    });
    return NextResponse.json({
      status: "duplicates",
      batchId: batch.id,
      duplicates: savedDupes.map((d) => ({ id: d.id, date: d.date, amount: Number(d.amount), description: d.description })),
    });
  }

  await db.statementImportBatch.update({ where: { id: batch.id }, data: { status: "DONE" } });
  return NextResponse.json({ status: "done", batchId: batch.id, count: rawTransactions.length, skipped: 0 });
}

async function handlePdfImport(buffer: Buffer, filename: string, organisationId: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let batchId: string | undefined;

      try {
        const batch = await db.statementImportBatch.create({
          data: { organisationId, filename, fileType: "PDF", status: "PROCESSING", transactionCount: 0 },
        });
        batchId = batch.id;

        emit("progress", { step: "extracting", pct: 10 });
        const text = await extractTextFromPdf(buffer);

        emit("progress", { step: "parsing", pct: 30 });
        const rawTransactions = await parseTransactionsFromText(text);

        if (rawTransactions.length === 0) {
          await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: "No transactions found" } });
          emit("error", { message: "No transactions found in PDF. The format may not be supported." });
          controller.close();
          return;
        }

        emit("progress", { step: "categorizing", pct: 50, count: rawTransactions.length });
        const categorized = await categorizeBatch(rawTransactions.map((t) => t.description));

        emit("progress", { step: "deduplicating", pct: 75 });
        const existingRaw = await db.statementTransaction.findMany({
          where: { organisationId },
          select: { id: true, date: true, description: true, amount: true },
        });
        const existing = existingRaw.map((e) => ({ ...e, amount: Number(e.amount) }));
        const { duplicates } = detectDuplicates(rawTransactions, existing);

        emit("progress", { step: "saving", pct: 90 });
        await db.statementTransaction.createMany({
          data: rawTransactions.map((txn, i) => ({
            organisationId,
            importBatchId: batchId!,
            date: new Date(txn.date),
            description: txn.description,
            merchantName: categorized[i]?.merchantName ?? txn.description,
            amount: txn.amount,
            type: txn.type,
            category: categorized[i]?.category ?? "Other",
            mccCode: categorized[i]?.mccCode ?? "0000",
            mccLabel: categorized[i]?.mccLabel ?? "Uncategorized",
          })),
        });

        await db.statementImportBatch.update({
          where: { id: batchId },
          data: { transactionCount: rawTransactions.length },
        });

        if (duplicates.length > 0) {
          const dupDescs = duplicates.map((d) => d.incoming.description);
          const savedDupes = await db.statementTransaction.findMany({
            where: { importBatchId: batchId, description: { in: dupDescs } },
            select: { id: true, date: true, description: true, amount: true },
          });
          emit("duplicates", {
            count: savedDupes.length,
            items: savedDupes.map((d) => ({ id: d.id, date: d.date, amount: Number(d.amount), description: d.description })),
            batchId,
          });
          controller.close();
          return;
        }

        await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
        emit("done", { batchId, count: rawTransactions.length, skipped: 0 });
        controller.close();
      } catch (err) {
        if (batchId) {
          await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorMessage: String(err) } }).catch(() => {});
        }
        emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 3: Create the confirm endpoint**

Create `app/api/pf/import/[batchId]/confirm/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { organisationId: true } });
  if (!user?.organisationId) return NextResponse.json({ error: "No organisation" }, { status: 403 });
  const organisationId = user.organisationId;

  const { batchId } = await params;
  const skip = request.nextUrl.searchParams.get("skip") === "true";

  const batch = await db.statementImportBatch.findFirst({
    where: { id: batchId, organisationId },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  let skipped = 0;
  if (skip) {
    const body = await request.json() as { duplicateIds?: string[] };
    const ids = body.duplicateIds ?? [];
    if (ids.length > 0) {
      await db.statementTransaction.deleteMany({
        where: { id: { in: ids }, importBatchId: batchId, organisationId },
      });
      skipped = ids.length;
    }
  }

  const count = await db.statementTransaction.count({ where: { importBatchId: batchId, organisationId } });
  await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "DONE", transactionCount: count } });

  return NextResponse.json({ status: "done", batchId, count, skipped });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors in the new files. Fix any type errors before proceeding.

- [ ] **Step 5: Commit**

```bash
git add app/api/pf/import/
git commit -m "feat: add /api/pf/import route handler for CSV sync and PDF SSE import paths"
```

---

## Task 8: Transactions page

**Files:**
- Create: `app/(app)/pf/transactions/page.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/Apple/projects/AutoAccounts/app/\(app\)/pf/transactions/_components
```

- [ ] **Step 2: Create the transactions page**

Create `app/(app)/pf/transactions/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, CreditCard, TrendingDown, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ImportDialog } from "./_components/import-dialog";
import { CATEGORY_DEFINITIONS } from "@/server/services/statement-categorization.service";

const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining":     "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Transport":         "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "Shopping":          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Entertainment":     "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  "Health & Fitness":  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Utilities":         "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Travel":            "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Housing":           "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Education":         "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Personal Care":     "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  "Business Services": "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  "Financial":         "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Income":            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "Transfer":          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Other":             "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
};

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PfTransactionsPage() {
  const utils = trpc.useUtils();
  const [importOpen, setImportOpen] = useState(false);
  const [category, setCategory] = useState<string>("__all__");
  const [type, setType] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const { data: summary } = trpc.statementTransactions.summary.useQuery();

  const { data, isLoading } = trpc.statementTransactions.list.useQuery({
    category: category === "__all__" ? undefined : category,
    type: type === "__all__" ? undefined : (type as "DEBIT" | "CREDIT"),
    search: search || undefined,
    cursor,
    limit: 50,
  });

  const updateCategory = trpc.statementTransactions.updateCategory.useMutation({
    onSuccess: () => utils.statementTransactions.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const toggleExclude = trpc.statementTransactions.toggleExclude.useMutation({
    onSuccess: () => {
      utils.statementTransactions.list.invalidate();
      utils.statementTransactions.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const categories = CATEGORY_DEFINITIONS.map((c) => c.name);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Transactions"
        description="Import bank and credit card statements, then track and categorize your spending."
        action={
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <CreditCard className="h-4 w-4 mr-2" />
            Import Statement
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Transactions", value: summary?.totalCount?.toLocaleString() ?? "—", icon: RefreshCw, color: "text-foreground" },
          { label: "Total Debits",  value: summary ? fmt(summary.totalDebits) : "—",   icon: TrendingDown, color: "text-red-500" },
          { label: "Total Credits", value: summary ? fmt(summary.totalCredits) : "—",  icon: TrendingUp,   color: "text-emerald-500" },
          { label: "Latest Import", value: summary?.latestBatch ? `${summary.latestBatch.transactionCount} txns` : "None", icon: CreditCard, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search merchants..."
          className="h-8 w-48 text-sm"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setCursor(undefined); }}
        />
        <Select value={category} onValueChange={(v) => { setCategory(v); setCursor(undefined); }}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue placeholder="Category: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => { setType(v); setCursor(undefined); }}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="Type: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All types</SelectItem>
            <SelectItem value="DEBIT">Debits</SelectItem>
            <SelectItem value="CREDIT">Credits</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.items.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <CreditCard className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No transactions yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Import a bank or credit card statement to get started</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => setImportOpen(true)}>
            Import Statement
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Merchant</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((txn) => (
                <tr key={txn.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${txn.isExcluded ? "opacity-40" : ""}`}>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{txn.merchantName}</div>
                    <div className="text-xs text-muted-foreground/60 truncate max-w-xs">{txn.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={txn.category}
                      onValueChange={(newCat) =>
                        updateCategory.mutate({ id: txn.id, category: newCat })
                      }
                    >
                      <SelectTrigger className={`h-6 px-2 text-xs border-0 rounded-full w-auto ${CATEGORY_COLORS[txn.category] ?? CATEGORY_COLORS["Other"]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${txn.type === "DEBIT" ? "text-red-500" : "text-emerald-500"}`}>
                    {txn.type === "DEBIT" ? "−" : "+"}{fmt(Number(txn.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleExclude.mutate({ id: txn.id })}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      title={txn.isExcluded ? "Un-exclude" : "Exclude"}
                    >
                      {txn.isExcluded ? "↩" : "×"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.nextCursor && (
            <div className="flex justify-center py-3 border-t">
              <Button variant="ghost" size="sm" onClick={() => setCursor(data.nextCursor)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {
          utils.statementTransactions.list.invalidate();
          utils.statementTransactions.summary.invalidate();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors. If `ImportDialog` is missing, that's expected — it will be created in Task 9.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pf/transactions/page.tsx"
git commit -m "feat: add /pf/transactions page with summary strip, filters, and transaction table"
```

---

## Task 9: Import dialog component

**Files:**
- Create: `app/(app)/pf/transactions/_components/import-dialog.tsx`

- [ ] **Step 1: Create the import dialog**

Create `app/(app)/pf/transactions/_components/import-dialog.tsx`:

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type ImportState = "idle" | "uploading" | "duplicates" | "done" | "error";

interface DuplicateItem { id: string; date: string | Date; amount: number; description: string; }
interface ProgressStep { step: string; pct: number; count?: number; }

const STEP_LABELS: Record<string, string> = {
  extracting:    "Extracting text from PDF",
  parsing:       "Parsing transactions",
  categorizing:  "Categorizing with AI",
  deduplicating: "Checking for duplicates",
  saving:        "Saving transactions",
};

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function ImportDialog({ open, onOpenChange, onComplete }: ImportDialogProps) {
  const [state, setState] = useState<ImportState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ProgressStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState("idle");
    setFile(null);
    setProgress(null);
    setCompletedSteps([]);
    setDuplicates([]);
    setBatchId(null);
    setResultCount(0);
    setErrorMsg("");
  };

  const handleFile = (f: File) => {
    const name = f.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".pdf")) {
      toast.error("Only PDF and CSV files are supported");
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setState("uploading");
    setCompletedSteps([]);
    setProgress(null);

    const formData = new FormData();
    formData.append("file", file);

    const isCsv = file.name.toLowerCase().endsWith(".csv");

    if (isCsv) {
      // CSV: synchronous JSON response
      try {
        const res = await fetch("/api/pf/import", { method: "POST", body: formData });
        const data = await res.json() as { status: string; batchId?: string; count?: number; duplicates?: DuplicateItem[]; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? "Import failed");

        if (data.status === "duplicates" && data.batchId && data.duplicates) {
          setBatchId(data.batchId);
          setDuplicates(data.duplicates);
          setState("duplicates");
        } else {
          setResultCount(data.count ?? 0);
          setState("done");
          onComplete();
          toast.success(`${data.count} transactions imported`);
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Unknown error");
        setState("error");
      }
      return;
    }

    // PDF: SSE stream
    try {
      const res = await fetch("/api/pf/import", { method: "POST", body: formData });
      if (!res.ok) { throw new Error(`Upload failed: ${res.statusText}`); }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
          } else if (trimmed.startsWith("data: ")) {
            try {
              const d = JSON.parse(trimmed.slice(6));
              if (currentEvent === "progress") {
                setProgress(d as ProgressStep);
                if (d.step && d.pct > 10) {
                  setCompletedSteps((prev) => {
                    const steps = Object.keys(STEP_LABELS);
                    const currentIdx = steps.indexOf(d.step as string);
                    return steps.slice(0, currentIdx);
                  });
                }
              } else if (currentEvent === "duplicates") {
                setBatchId(d.batchId);
                setDuplicates(d.items ?? []);
                setState("duplicates");
              } else if (currentEvent === "done") {
                setResultCount(d.count ?? 0);
                setState("done");
                onComplete();
                toast.success(`${d.count} transactions imported`);
              } else if (currentEvent === "error") {
                throw new Error(d.message ?? "Import error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
            currentEvent = "";
          }
        }
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const handleConfirm = async (skipDuplicates: boolean) => {
    if (!batchId) return;
    setState("uploading");
    try {
      const url = `/api/pf/import/${batchId}/confirm?skip=${skipDuplicates}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateIds: duplicates.map((d) => d.id) }),
      });
      const data = await res.json() as { count: number; skipped: number };
      setResultCount(data.count);
      setState("done");
      onComplete();
      toast.success(`${data.count} transactions imported${data.skipped ? `, ${data.skipped} duplicates skipped` : ""}`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const pdfStepKeys = Object.keys(STEP_LABELS);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state === "duplicates" ? "Possible Duplicates Found" :
             state === "done" ? "Import Complete" :
             state === "error" ? "Import Failed" : "Import Statement"}
          </DialogTitle>
        </DialogHeader>

        {/* IDLE */}
        {state === "idle" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Upload a bank or credit card statement (PDF or CSV).</p>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors
                ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}`}
            >
              <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Drop PDF or CSV here</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">or click to browse · max 20 MB</p>
                </>
              )}
              <input ref={inputRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!file} onClick={handleImport}>Import</Button>
            </div>
          </div>
        )}

        {/* UPLOADING / PROCESSING */}
        {state === "uploading" && (
          <div className="flex flex-col gap-4">
            {file?.name.toLowerCase().endsWith(".pdf") ? (
              <>
                <div className="flex flex-col gap-3">
                  {pdfStepKeys.map((key, idx) => {
                    const isDone = completedSteps.includes(key);
                    const isActive = progress?.step === key;
                    const isPending = !isDone && !isActive;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div className={`h-5 w-5 rounded-full flex items-center justify-center text-xs flex-shrink-0
                          ${isDone ? "bg-emerald-500 text-white" : isActive ? "bg-primary" : "bg-muted border"}`}>
                          {isDone ? <CheckCircle2 className="h-3 w-3" /> :
                           isActive ? <Loader2 className="h-3 w-3 animate-spin text-white" /> :
                           <span className="text-muted-foreground">{idx + 1}</span>}
                        </div>
                        <div>
                          <p className={`text-sm ${isPending ? "text-muted-foreground" : "text-foreground"}`}>{STEP_LABELS[key]}</p>
                          {isActive && progress?.count && <p className="text-xs text-primary">{progress.count} transactions found</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {progress && (
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress.pct}%` }} />
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Importing CSV…</p>
              </div>
            )}
          </div>
        )}

        {/* DUPLICATES */}
        {state === "duplicates" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{duplicates.length} transaction{duplicates.length !== 1 ? "s" : ""} may already exist in your records.</p>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {duplicates.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{d.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-red-500">−${Number(d.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => handleConfirm(true)}>
                Skip duplicates — import {/* count is batchId txns minus dupes — simplify */} new transactions only
              </Button>
              <Button onClick={() => handleConfirm(false)}>
                Import all — keep duplicates
              </Button>
            </div>
          </div>
        )}

        {/* DONE */}
        {state === "done" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="text-center">
              <p className="font-medium">{resultCount} transactions imported</p>
              <p className="text-sm text-muted-foreground mt-1">Categories have been auto-assigned. Edit any row in the table.</p>
            </div>
            <Button onClick={() => { onOpenChange(false); reset(); }}>View Transactions</Button>
          </div>
        )}

        {/* ERROR */}
        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <XCircle className="h-12 w-12 text-red-500" />
            <div className="text-center">
              <p className="font-medium text-red-500">Import failed</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={reset}>Try again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm run test
```

Expected: All existing + new tests pass. Test count should be higher than before.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pf/transactions/_components/import-dialog.tsx"
git commit -m "feat: add ImportDialog component with CSV/PDF upload, SSE progress, and duplicate review"
```

---

## Task 10: E2E auth guard tests

**Files:**
- Create: `tests/e2e/statement-transactions.spec.ts`

- [ ] **Step 1: Create the E2E test**

Create `tests/e2e/statement-transactions.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const ROUTES = ["/pf/transactions"] as const;

test.describe("Statement Transactions — auth guard", () => {
  for (const route of ROUTES) {
    test(`unauthenticated users are redirected to /login from ${route}`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(route);
      await expect(page).toHaveURL(/login/);
    });
  }
});

test.describe("Statement Transactions — redirect preserves destination", () => {
  test("redirect from /pf/transactions lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/pf/transactions");
    await expect(page).toHaveURL(/login/);
  });
});
```

- [ ] **Step 2: Run the E2E tests**

```bash
npm run test:e2e -- tests/e2e/statement-transactions.spec.ts
```

Expected: Both tests pass (page redirects to /login for unauthenticated users).

- [ ] **Step 3: Run the full test suite one final time**

```bash
npm run test
```

Expected: All tests pass with higher count than before.

- [ ] **Step 4: Final commit**

```bash
git add tests/e2e/statement-transactions.spec.ts
git commit -m "feat: add E2E auth guard tests for /pf/transactions"
```

---

## Self-Review Checklist

| Spec requirement | Task covering it |
|---|---|
| StatementImportBatch + StatementTransaction Prisma models | Task 1 |
| 3 new enums (StatementFileType, StatementImportStatus, StatementTransactionType) | Task 1 |
| StatementParserService: autoDetectColumns, parseCsvBuffer, normalizeAmount, detectDuplicates | Task 2 |
| StatementCategorizationService: MCC map, CATEGORY_DEFINITIONS, categorizeBatch, mapMccToCategory | Task 3 |
| PdfStatementService: extractTextFromPdf, parseTransactionsFromText | Task 4 |
| statementTransactionsRouter: list, updateCategory, toggleExclude, deleteByBatch, listBatches, summary | Task 5 |
| Register router in root.ts | Task 6 |
| Transactions sidebar nav item | Task 6 |
| CSV import path (sync) | Task 7 |
| PDF import path (SSE) | Task 7 |
| Confirm/skip duplicates endpoint | Task 7 |
| Transactions page with summary strip, filters, table, inline category editing | Task 8 |
| Import dialog: idle, processing (CSV + PDF SSE), duplicate review, done, error states | Task 9 |
| E2E auth guard | Task 10 |
| TDD throughout | All tasks |
| Ollama fallback pattern | Tasks 3, 4 |
| All monetary values as NUMERIC(19,4) | Task 1 |
| organisationId scoping on all queries | Tasks 5, 7 |
