# Statement Import & MCC Categorization — Design Spec

**Date:** 2026-05-27  
**Module:** Personal Finance (Phase 13)  
**Status:** Approved  

---

## 1. Overview

Users can upload bank or credit card statements (PDF or CSV), have transactions extracted automatically using Ollama/gemma4:e4b, and have each transaction auto-categorized using a simplified 15-category system backed by Merchant Category Codes (MCC). Users can re-categorize any transaction after import from a dedicated Transactions page inside the Personal Finance module.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module coupling | Standalone / additive | PF module launching as a standalone service first; no dependency on accounting `JournalLine` |
| Category system | Simplified 15 categories (user-facing) + raw MCC stored underneath | Best UX; MCC preserved for future export/reporting |
| Import workflow | Upload → AI auto-saves → edit after | Fastest path to saved data; categories always editable |
| Duplicate detection | Smart dedup with user review prompt | Same date+amount + fuzzy description match; user decides to skip or keep |
| Pipeline | Hybrid: CSV synchronous, PDF async via SSE | CSV is instant; PDF streams real-time progress; no BullMQ/Redis dependency |
| AI | Ollama / gemma4:e4b | Consistent with existing `extraction.service.ts` pattern; local, offline-capable |

---

## 2. Data Model

### 2.1 New Enums

```prisma
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

enum TransactionType {
  DEBIT
  CREDIT
}
```

### 2.2 New Models

```prisma
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
  id             String               @id @default(cuid())
  organisationId String
  organisation   Organisation         @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  importBatchId  String
  importBatch    StatementImportBatch @relation(fields: [importBatchId], references: [id], onDelete: Cascade)

  date           DateTime             @db.Date
  description    String               // raw merchant text from statement
  merchantName   String               // cleaned/normalized merchant name
  amount         Decimal              @db.Decimal(19, 4)
  type           TransactionType

  // MCC categorization
  category       String               // simplified user-facing label e.g. "Food & Dining"
  mccCode        String               // inferred ISO 18245 MCC e.g. "5812"
  mccLabel       String               // human-readable MCC label e.g. "Eating Places & Restaurants"

  isExcluded     Boolean              @default(false)
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  @@index([organisationId])
  @@index([importBatchId])
  @@index([organisationId, date])
  @@index([organisationId, category])
}
```

### 2.3 Simplified Category Definitions

| Category | Icon | Representative MCC Ranges |
|---|---|---|
| Food & Dining | ☕ | 5411, 5812, 5814, 5441 |
| Transport | 🚗 | 4111, 4121, 4131, 5541, 7513 |
| Shopping | 🛍 | 5300–5399, 5600–5699, 5940–5999 |
| Entertainment | 🎬 | 5735, 7832, 7922, 7941, 7991 |
| Health & Fitness | 💊 | 5912, 7011, 8011, 8021, 8049 |
| Utilities | 💡 | 4900, 4911, 4941, 4952 |
| Travel | ✈️ | 3000–3999, 4411, 4722, 7011 |
| Housing | 🏠 | 6513, 1520, 5251 |
| Education | 📚 | 8211, 8220, 8299 |
| Personal Care | 💅 | 7230, 7298, 5977 |
| Business Services | 💼 | 7372, 7374, 8742 |
| Financial | 🏦 | 6010, 6011, 6012, 6051 |
| Income | 💰 | ACH/PAYROLL (pattern-matched) |
| Transfer | 🔄 | 6012, inter-account patterns |
| Other | 📋 | Fallback for unrecognized MCC |

---

## 3. Service Layer

### 3.1 `StatementParserService`
**File:** `server/services/statement-parser.service.ts`  
**Purpose:** Pure parsing — no Ollama, fully unit-testable.

**Exports:**
- `autoDetectColumns(headers: string[]): ColumnMap` — scans CSV headers for date/amount/description columns using pattern matching (`date`, `txn date`, `amount`, `debit`, `credit`, `description`, `memo`, `narration`, etc.)
- `parseCsvBuffer(buffer: Buffer, columnMap: ColumnMap): RawTransaction[]` — parse all rows, normalize amounts (strip `$`, handle `(123.00)` negatives for debits)
- `detectDuplicates(incoming: RawTransaction[], existing: ExistingTransaction[]): DedupeResult` — flags likely duplicates where `date === date && amount === amount && levenshteinSimilarity(description, existing.description) > 0.8`. Returns `{ safe: RawTransaction[], duplicates: DuplicateMatch[] }`
- `normalizeAmount(raw: string): { amount: Decimal, type: TransactionType }` — handles all common bank statement amount formats

**Types:**
```ts
interface ColumnMap { date: number; description: number; amount: number; debit?: number; credit?: number; }
interface RawTransaction { date: string; description: string; amount: number; type: TransactionType; }
interface DedupeResult { safe: RawTransaction[]; duplicates: DuplicateMatch[]; }
interface DuplicateMatch { incoming: RawTransaction; existing: ExistingTransaction; similarity: number; }
```

---

### 3.2 `StatementCategorizationService`
**File:** `server/services/statement-categorization.service.ts`  
**Purpose:** All MCC + category logic, including Ollama batched inference.

**Exports:**
- `MCC_CATEGORY_MAP: Record<string, string>` — static lookup: MCC code → simplified category name
- `CATEGORY_DEFINITIONS: CategoryDefinition[]` — the 15 categories with display name, icon, and MCC ranges
- `categorizeBatch(descriptions: string[]): Promise<CategorizationResult[]>` — single Ollama call with all merchant descriptions in one prompt. Returns `{ description, mccCode, mccLabel, category, merchantName }[]`. Falls back to `{ category: "Other", mccCode: "0000", mccLabel: "Uncategorized", merchantName: description }` per item if Ollama is unreachable (mirrors `extraction.service.ts` fallback pattern)
- `buildCategorizationPrompt(descriptions: string[]): string` — constructs the structured JSON prompt
- `mapMccToCategory(mccCode: string): string` — pure lookup helper

**Ollama prompt strategy:** Single batch call — all merchant descriptions sent in one request as a JSON array. Model returns a JSON array of `{ description, merchantName, mccCode, mccLabel }` objects. Keeps Ollama calls to exactly one per import regardless of transaction count.

---

### 3.3 `PdfStatementService`
**File:** `server/services/pdf-statement.service.ts`  
**Purpose:** PDF-specific extraction.

**Exports:**
- `extractTextFromPdf(buffer: Buffer): Promise<string>` — uses `pdfjs-dist` to extract raw text from all pages, concatenated with page breaks
- `parseTransactionsFromText(text: string): Promise<RawTransaction[]>` — sends extracted text to Ollama with a structured prompt requesting a JSON array of transaction rows. Uses same JSON fence-stripping + fallback pattern as `extraction.service.ts`

---

## 4. API Layer

### 4.1 tRPC Router: `statementTransactionsRouter`
**File:** `server/routers/statementTransactions.ts`  
**Registered in:** `server/root.ts` as `statementTransactions`

**Procedures:**
| Procedure | Type | Description |
|---|---|---|
| `list` | query | List transactions for org; filterable by `dateFrom`, `dateTo`, `category`, `type`, `search` (merchant name); excludes `isExcluded` by default |
| `updateCategory` | mutation | Update `category`, `mccCode`, `mccLabel` for a single transaction |
| `toggleExclude` | mutation | Toggle `isExcluded` on a transaction |
| `deleteByBatch` | mutation | Hard-delete all transactions belonging to a `batchId` |
| `listBatches` | query | List all `StatementImportBatch` records for org, ordered by `createdAt DESC` |
| `summary` | query | Returns `{ totalCount, totalDebits, totalCredits, latestBatch }` for the summary strip |

---

### 4.2 API Route: `/api/pf/import/route.ts`
**File:** `app/api/pf/import/route.ts`  
**Method:** `POST` — accepts `multipart/form-data` with `file` field.

#### CSV Path (synchronous):
1. Parse CSV with `StatementParserService.parseCsvBuffer`
2. Call `StatementCategorizationService.categorizeBatch` with all descriptions
3. Run `StatementParserService.detectDuplicates` against existing org transactions
4. Create `StatementImportBatch` with `status: PENDING`; persist **all** `StatementTransaction` rows immediately (including flagged duplicates, identified by ID in the response)
5. If duplicates found: return `{ status: "duplicates", duplicates: [{ id, date, amount, description }], batchId }` — client shows duplicate review dialog
6. If no duplicates: set batch `status: DONE`, return `{ status: "done", batchId, count, skipped: 0 }`

#### PDF Path (SSE stream):
1. Open SSE response with `Content-Type: text/event-stream`
2. Emit `progress { step: "extracting", pct: 10 }`
3. Extract text via `PdfStatementService.extractTextFromPdf`
4. Emit `progress { step: "parsing", pct: 30 }`
5. Parse transactions via `PdfStatementService.parseTransactionsFromText`
6. Emit `progress { step: "categorizing", pct: 50, count: N }`
7. Batch-categorize via `StatementCategorizationService.categorizeBatch`
8. Emit `progress { step: "deduplicating", pct: 75 }`
9. Run duplicate detection; create `StatementImportBatch` with `status: PENDING`; persist **all** `StatementTransaction` rows (including flagged dupes)
10. Emit `progress { step: "saving", pct: 90 }`
11. If duplicates found: emit `duplicates { count, items: [{ id, date, amount, description }], batchId }` — client posts to confirm endpoint
12. If no duplicates: set batch `status: DONE`; emit `done { batchId, count, skipped: 0 }`

**Confirm endpoint:** `POST /api/pf/import/[batchId]/confirm`  
Query param: `skip=true` (skip duplicates) or `skip=false` (import all).  
- `skip=true`: hard-delete the `StatementTransaction` rows whose IDs were flagged as duplicates; update batch `transactionCount`; set batch `status: DONE`  
- `skip=false`: set batch `status: DONE` only (all rows already persisted)  
No in-memory state required — all data lives in the DB under the PENDING batch.

---

## 5. Frontend

### 5.1 Page: `/transactions`
**File:** `app/(app)/transactions/page.tsx`  
**Note:** This is the Personal Finance Transactions page — distinct from the existing Accounting transactions page at `/app/(app)/transactions/`.  
**Actual route:** `app/(app)/pf/transactions/page.tsx`

**Layout:**
1. **Page header** — title "Transactions", subtitle, "Import Statement" button (top-right)
2. **Summary strip** — 4 cards: Total Transactions, Total Debits (red), Total Credits (green), Latest Import
3. **Filter row** — date range picker, Category dropdown (All + 15 categories), Type dropdown (All / Debit / Credit), merchant search input
4. **Transaction table** — columns: Date, Merchant (name + raw description sub-text), Category (inline dropdown badge), Amount (red debit / green credit), actions menu (`···`)
5. **Actions menu per row** — "Change category", "Exclude transaction", "Delete"
6. **Load more** — pagination via cursor

**Category badge:** Clicking the badge opens a `<Select>` with all 15 categories. On change, calls `statementTransactions.updateCategory`. Optimistic update — badge changes immediately.

**Category colour map:** Each of the 15 categories has a distinct accent colour for the badge (indigo, sky, amber, pink, emerald, etc.).

---

### 5.2 Import Dialog
**Component:** `app/(app)/pf/transactions/_components/import-dialog.tsx`

**States:**
1. **Idle** — drag-drop zone + file type hints (PDF / CSV). Import button disabled until file selected.
2. **Processing (CSV)** — instant; shows brief "Importing…" spinner then transitions directly to state 3 or 4.
3. **Processing (PDF)** — 4-step progress list with live SSE updates. Each step shows checkmark when complete, spinner on active step, muted number for pending. Progress bar beneath.
4. **Duplicate review** — list of flagged transactions with amber left border. Two action buttons: "Skip duplicates — import N new" / "Import all N — keep duplicates".
5. **Done** — success state: "X transactions imported" with breakdown by category. "View Transactions" button closes dialog.
6. **Error** — red error message with retry button.

---

## 6. Navigation

Add to the Personal Finance sidebar group in `app/(app)/_components/sidebar.tsx`:

```tsx
{ href: "/pf/transactions", label: "Transactions", icon: CreditCard }
```

Position: first item in the Personal Finance group, above Budgets.

---

## 7. Testing Strategy

### Unit Tests — `tests/unit/statement-parser.service.test.ts`
- `autoDetectColumns` — various header naming conventions (bank-specific formats)
- `parseCsvBuffer` — standard rows, negative amounts, parenthesis format, missing fields
- `normalizeAmount` — `$1,234.56`, `(123.00)`, `-45.00`, `1234`, etc.
- `detectDuplicates` — exact matches, fuzzy matches above/below threshold, empty existing set, all duplicates

### Unit Tests — `tests/unit/statement-categorization.service.test.ts`
- `mapMccToCategory` — known MCC codes, unknown codes → "Other", boundary codes
- `buildCategorizationPrompt` — prompt structure, JSON array inclusion
- `categorizeBatch` — mocked Ollama response parsing, fallback on Ollama unreachable, malformed JSON response handling

### Router Tests — `tests/unit/statementTransactions.routers.test.ts`
- All 6 procedures via `createCallerFactory` + `vi.mock("@/lib/db")`
- `list` with each filter combination
- `updateCategory` updates correct fields
- `toggleExclude` toggles correctly
- `deleteByBatch` scoped to org

### E2E Auth Guard — `tests/e2e/statement-transactions.spec.ts`
- `/pf/transactions` redirects unauthenticated users to `/login`

---

## 8. Out of Scope (v1)

- **Multi-account tagging** — assigning transactions to specific bank accounts
- **Recurring detection** — auto-detecting subscriptions/recurring charges
- **Budget/Watchlist integration** — feeding imported transactions into spend calculations (deferred; existing module uses JournalLine aggregation)
- **Export** — exporting filtered transactions as CSV/PDF
- **Statement history page** — dedicated import batch management UI (batch history accessible via `listBatches` but no dedicated page in v1)
- **Column mapping UI** — auto-detection only; no manual column mapper for non-standard CSVs

---

## 9. File Inventory

| File | Type | Notes |
|---|---|---|
| `prisma/migrations/YYYYMMDD_add_statement_transactions/migration.sql` | Migration | 2 new models, 3 new enums |
| `server/services/statement-parser.service.ts` | New | Pure CSV parsing + dedup logic |
| `server/services/statement-categorization.service.ts` | New | MCC map + Ollama batch categorization |
| `server/services/pdf-statement.service.ts` | New | pdfjs-dist extraction + Ollama parsing |
| `server/routers/statementTransactions.ts` | New | 6 tRPC procedures |
| `server/root.ts` | Modified | Register `statementTransactions` router |
| `app/api/pf/import/route.ts` | New | Multipart upload handler (CSV sync + PDF SSE) |
| `app/api/pf/import/[batchId]/confirm/route.ts` | New | POST to confirm/skip duplicates |
| `app/(app)/pf/transactions/page.tsx` | New | Transactions list page |
| `app/(app)/pf/transactions/_components/import-dialog.tsx` | New | Upload + processing + dupe review dialog |
| `app/(app)/_components/sidebar.tsx` | Modified | Add Transactions nav item |
| `tests/unit/statement-parser.service.test.ts` | New | ~40 unit tests |
| `tests/unit/statement-categorization.service.test.ts` | New | ~30 unit tests |
| `tests/unit/statementTransactions.routers.test.ts` | New | ~25 router tests |
| `tests/e2e/statement-transactions.spec.ts` | New | 2 auth guard E2E tests |
