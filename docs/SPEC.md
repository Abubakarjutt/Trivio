# AutoAccounts — Complete Implementation Spec

**Version:** 1.0.0  
**Last Updated:** 2026-05-15  
**Purpose:** Exhaustive implementation reference. Using this document alone you should be able to recreate the entire application from scratch.

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Local Development Environment](#4-local-development-environment)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema](#6-database-schema)
7. [Default Chart of Accounts](#7-default-chart-of-accounts)
8. [Authentication](#8-authentication)
9. [Middleware & Routing](#9-middleware--routing)
10. [tRPC Layer](#10-trpc-layer)
11. [Service Layer](#11-service-layer)
12. [Background Workers](#12-background-workers)
13. [API Routes](#13-api-routes)
14. [Frontend — App Shell](#14-frontend--app-shell)
15. [Frontend — Pages](#15-frontend--pages)
16. [Chat Assistant](#16-chat-assistant)
17. [File Storage](#17-file-storage)
18. [Email](#18-email)
19. [Subscription & Billing](#19-subscription--billing)
20. [Testing](#20-testing)
21. [Key Invariants & Design Decisions](#21-key-invariants--design-decisions)
22. [Known Gaps / Future Work](#22-known-gaps--future-work)

---

## 1. Product Summary

AutoAccounts is a SaaS double-entry bookkeeping web app for non-accountants (freelancers, solopreneurs, small businesses). It hides accounting complexity behind simple workflows while maintaining proper double-entry integrity under the hood.

**Core capabilities:**
- Invoice (AR) and bill (AP) lifecycle management
- Double-entry journal with balance validation
- Chart of accounts (auto-seeded, user-customisable)
- AI-powered document extraction (upload receipt → pre-fill form)
- Bank statement import and guided reconciliation
- Financial reports: P&L, Balance Sheet, Trial Balance, AR/AP Aging, Tax Summary
- Stripe subscription tiers (Free / Pro)
- Conversational AI chat assistant (25 tools, streaming responses)

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.3.2 |
| Language | TypeScript | ^5 |
| API | tRPC | ^11.1.2 |
| ORM | Prisma | ^6.8.2 |
| Database | PostgreSQL | 16 |
| Auth | NextAuth.js v5 (Auth.js) | ^5.0.0-beta.29 |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) | postcss ^4.3.0 |
| Charts | Recharts | ^2.15.3 |
| Background jobs | BullMQ + ioredis | ^5.46.1 / ^5.10.1 |
| AI (extraction) | Ollama (gemma4:e4b) via local HTTP | — |
| AI (chat) | Ollama (gemma4:e4b) via local HTTP, SSE streaming | — |
| File storage | Local filesystem (production: swap to AWS S3) | — |
| PDF | @react-pdf/renderer | ^4.5.1 |
| Email | nodemailer (dev: Mailhog SMTP) | ^7.0.13 |
| Payments | Stripe | ^22.1.1 |
| Data serialisation | superjson | ^2.2.2 |
| Validation | Zod | ^3.24.4 |
| Icons | lucide-react | ^0.511.0 |
| Toasts | sonner | ^2.0.7 |
| Unit tests | Vitest | ^3.1.4 |
| E2E tests | Playwright | ^1.52.0 |

**Key `package.json` scripts:**
```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E
npm run typecheck    # tsc --noEmit
npm run db:migrate   # prisma migrate dev
npm run db:seed      # tsx prisma/seed.ts
npm run db:studio    # Prisma Studio
npm run worker       # tsx server/workers/extraction.worker.ts
```

---

## 3. Repository Layout

```
/
├── app/
│   ├── (app)/                        # Authenticated app shell (requires session + onboarding)
│   │   ├── layout.tsx                # Server component: auth check, onboarding gate, sidebar + ChatPanel
│   │   ├── _components/
│   │   │   ├── sidebar.tsx           # Left nav with all route links
│   │   │   ├── chat-panel.tsx        # Full chat assistant UI (3000+ lines)
│   │   │   ├── page-header.tsx       # Reusable page header
│   │   │   └── toggle-theme.tsx      # Light/dark toggle
│   │   ├── dashboard/page.tsx
│   │   ├── invoices/
│   │   │   ├── page.tsx              # Invoice list with status filter
│   │   │   ├── new/page.tsx          # Invoice create form
│   │   │   └── [id]/page.tsx         # Invoice detail + send/pay/void actions
│   │   ├── bills/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── contacts/page.tsx         # Customer + supplier CRUD
│   │   ├── accounts/page.tsx         # Chart of accounts
│   │   ├── transactions/
│   │   │   ├── page.tsx              # Journal entry list with search/filter
│   │   │   ├── new/page.tsx          # Simplified income/expense entry form
│   │   │   └── _components/csv-import-dialog.tsx
│   │   ├── reconciliation/
│   │   │   ├── page.tsx              # Bank account list
│   │   │   └── [bankAccountId]/page.tsx  # Reconciliation UI
│   │   ├── extract/page.tsx          # AI document extraction (upload + review)
│   │   ├── reports/
│   │   │   ├── page.tsx              # Reports index
│   │   │   ├── profit-loss/page.tsx
│   │   │   ├── balance-sheet/page.tsx
│   │   │   ├── trial-balance/page.tsx
│   │   │   ├── ar-aging/page.tsx
│   │   │   ├── ap-aging/page.tsx
│   │   │   └── tax-summary/page.tsx
│   │   └── settings/
│   │       ├── page.tsx              # Org settings
│   │       └── billing/page.tsx      # Subscription management
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (marketing)/
│   │   ├── layout.tsx
│   │   └── pricing/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts   # NextAuth handler
│   │   ├── trpc/[trpc]/route.ts          # tRPC HTTP handler
│   │   ├── chat/route.ts                 # SSE streaming chat endpoint
│   │   ├── invoices/[id]/pdf/route.ts    # Invoice PDF download
│   │   ├── attachments/
│   │   │   ├── upload/route.ts           # Multipart file upload
│   │   │   └── [id]/file/route.ts        # Serve attachment file
│   │   ├── export/route.ts               # Data export (ZIP of CSVs)
│   │   └── webhooks/stripe/route.ts      # Stripe webhook handler
│   ├── onboarding/page.tsx               # 2-step onboarding wizard
│   ├── layout.tsx                        # Root layout (Toaster, providers)
│   ├── page.tsx                          # Landing → redirect to /dashboard
│   ├── error.tsx
│   └── not-found.tsx
├── components/ui/                        # shadcn/ui components
├── server/
│   ├── trpc.ts                           # tRPC init, context, procedures
│   ├── root.ts                           # appRouter (composes all routers)
│   ├── routers/
│   │   ├── auth.ts
│   │   ├── org.ts
│   │   ├── accounts.ts
│   │   ├── transactions.ts
│   │   ├── contacts.ts
│   │   ├── invoices.ts
│   │   ├── bills.ts
│   │   ├── attachments.ts
│   │   ├── bankAccounts.ts
│   │   ├── reports.ts
│   │   ├── dashboard.ts
│   │   ├── subscription.ts
│   │   └── chat.ts
│   ├── services/
│   │   ├── accounting.service.ts
│   │   ├── invoice.service.ts
│   │   ├── bill.service.ts               # Mirrors invoice.service.ts for AP
│   │   ├── report.service.ts
│   │   ├── reconciliation.service.ts
│   │   ├── extraction.service.ts
│   │   ├── chart-of-accounts.service.ts
│   │   ├── subscription.service.ts
│   │   ├── email.service.ts
│   │   ├── audit.service.ts
│   │   └── chat.service.ts               # Chat AI: prompt building + 25 tool fns
│   ├── middleware/
│   │   ├── rateLimit.ts                  # In-memory rate limiter
│   │   └── usageGate.ts                  # Free tier extraction limit check
│   └── workers/
│       └── extraction.worker.ts          # BullMQ worker (separate process)
├── lib/
│   ├── auth.ts                           # NextAuth config (JWT, adapters, callbacks)
│   ├── db.ts                             # Prisma singleton
│   ├── queue.ts                          # BullMQ extractionQueue
│   ├── storage.ts                        # Local filesystem read/write/delete
│   ├── s3.ts                             # AWS S3 client (unused locally)
│   ├── env.ts                            # Env var validation
│   ├── utils.ts                          # formatDate, formatCurrency, cn()
│   ├── trpc/
│   │   ├── client.ts                     # tRPC client (React Query)
│   │   └── server.ts                     # tRPC server caller
│   └── hooks/
│       └── use-toast.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                           # Seeds TaxRegimes and TaxRates
├── tests/
│   ├── setup.ts
│   ├── unit/
│   │   ├── accounting.test.ts
│   │   ├── report.service.test.ts
│   │   ├── reconciliation.service.test.ts
│   │   ├── chat.service.test.ts
│   │   ├── chat.tools.test.ts            # 75 tests covering all 25 tools
│   │   ├── subscription.service.test.ts
│   │   ├── rateLimit.test.ts
│   │   └── usageGate.test.ts
│   └── e2e/
│       ├── auth.spec.ts
│       └── navigation.spec.ts
├── types/
│   └── next-auth.d.ts                    # Extends Session with user.id
├── storage/                              # Local file storage (gitignored)
├── docker-compose.yml
├── middleware.ts                         # Next.js edge middleware (auth guard)
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

---

## 4. Local Development Environment

### Docker Compose services

```yaml
postgres:   postgres:16-alpine  → localhost:5432  (user/pass/db: autoaccounts)
redis:      redis:7-alpine      → localhost:6379
minio:      minio/minio         → localhost:9000 (S3 API), :9001 (console)
mailhog:    mailhog/mailhog     → localhost:1025 (SMTP), :8025 (web UI)
```

Start: `docker compose up -d`

### Ollama (AI)

Ollama must be running separately. Model: `gemma4:e4b` (configurable via `OLLAMA_MODEL` env var).

```bash
ollama pull gemma4:e4b
ollama serve   # runs on localhost:11434
```

### First-run steps

```bash
docker compose up -d
cp .env.local.example .env.local   # fill in secrets
npx prisma migrate dev             # creates all tables
npx prisma db seed                 # seeds TaxRegimes + TaxRates
npm run dev                        # start Next.js
npx tsx server/workers/extraction.worker.ts  # start BullMQ worker (separate terminal)
```

---

## 5. Environment Variables

All required in `.env.local`:

```bash
# Database
DATABASE_URL="postgresql://autoaccounts:autoaccounts@localhost:5432/autoaccounts"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<random 32-char secret>"

# Google OAuth (optional)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# File storage — local mode uses ./storage/ directory, no S3 needed
# For production AWS S3:
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
AWS_REGION="us-east-1"
AWS_S3_BUCKET=""
AWS_S3_ENDPOINT=""   # set to MinIO URL for local: http://localhost:9000

# AI
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="gemma4:e4b"

# Email (dev uses Mailhog)
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="noreply@autoaccounts.local"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRO_MONTHLY_PRICE_ID="price_..."
STRIPE_PRO_ANNUAL_PRICE_ID="price_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## 6. Database Schema

PostgreSQL 16, managed by Prisma ORM. All monetary values stored as `NUMERIC(19,4)`. Every row scoped by `organisationId`.

### Enums

```prisma
enum BusinessType      { SOLE_TRADER PARTNERSHIP COMPANY OTHER }
enum SubscriptionTier  { FREE PRO BUSINESS }
enum UserRole          { OWNER EDITOR VIEWER }
enum AccountType       { ASSET LIABILITY EQUITY INCOME EXPENSE }
enum NormalBalance     { DEBIT CREDIT }
enum JournalEntrySource { MANUAL INVOICE BILL BANK_IMPORT AI_EXTRACTION }
enum ContactType       { CUSTOMER SUPPLIER BOTH }
enum InvoiceStatus     { DRAFT SENT PARTIAL PAID OVERDUE VOID }
enum BankStatementLineStatus { UNMATCHED MATCHED EXCLUDED CREATED }
enum ExtractionStatus  { PENDING PROCESSING DONE FAILED }
enum AuditAction       { CREATE UPDATE VOID DELETE }
enum OnboardingStep    { BUSINESS_INFO CURRENCY_TAX COMPLETE }
```

### Models

#### Organisation
```prisma
model Organisation {
  id                   String           @id @default(cuid())
  name                 String
  businessType         BusinessType     @default(SOLE_TRADER)
  currency             String           @default("USD")
  fiscalYearStartMonth Int              @default(1)
  subscriptionTier     SubscriptionTier @default(FREE)
  stripeCustomerId     String?          @unique
  stripeSubscriptionId String?          @unique
  onboardingStep       OnboardingStep   @default(BUSINESS_INFO)
  onboardingComplete   Boolean          @default(false)
  taxRegimeId          String?
  createdAt / updatedAt
  // relations: users, chartAccounts, journalEntries, contacts, invoices, bills,
  //            bankAccounts, attachments, auditLogs, usageRecords, chatConversations
}
```

#### User
```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  image          String?
  hashedPassword String?         // null for OAuth users
  emailVerified  DateTime?
  role           UserRole @default(OWNER)
  organisationId String?
  // relations: accounts (NextAuth), sessions, auditLogs, chatConversations
  @@index([organisationId])
}
```

#### NextAuth tables
Standard `Account`, `Session`, `VerificationToken` models as required by `@auth/prisma-adapter`.

#### TaxRegime / TaxRate
```prisma
model TaxRegime {
  id      String @id @default(cuid())
  code    String @unique   // "UK_VAT", "US_SALES_TAX", "AU_GST", "EU_VAT", "IN_GST", "NONE"
  name    String
  country String
  rates   TaxRate[]
}
model TaxRate {
  id          String    @id @default(cuid())
  taxRegimeId String
  code        String    // "STANDARD", "ZERO", "REDUCED", "EXEMPT"
  name        String
  rate        Decimal   @db.Decimal(5,4)
  @@unique([taxRegimeId, code])
}
```

#### ChartAccount
```prisma
model ChartAccount {
  id             String        @id @default(cuid())
  organisationId String
  code           String        // e.g. "1000", "4100"
  name           String
  type           AccountType
  normalBalance  NormalBalance
  description    String?
  parentId       String?       // self-reference for hierarchy
  isArchived     Boolean       @default(false)
  isSystem       Boolean       @default(false)  // system accounts cannot be deleted
  sortOrder      Int           @default(0)
  @@unique([organisationId, code])
  @@index([organisationId])
}
```

#### JournalEntry / JournalLine
```prisma
model JournalEntry {
  id             String             @id @default(cuid())
  organisationId String
  date           DateTime           @db.Date
  reference      String?
  description    String
  source         JournalEntrySource @default(MANUAL)
  sourceId       String?            // polymorphic FK to Invoice, Bill, etc.
  isVoid         Boolean            @default(false)
  voidedAt       DateTime?
  voidReason     String?
  lines          JournalLine[]
  @@index([organisationId, date])
}
model JournalLine {
  id             String       @id @default(cuid())
  journalEntryId String
  accountId      String
  debit          Decimal?     @db.Decimal(19,4)
  credit         Decimal?     @db.Decimal(19,4)
  description    String?
  bankStatementLines BankStatementLine[]
}
```

#### Contact
```prisma
model Contact {
  id             String      @id @default(cuid())
  organisationId String
  type           ContactType   // CUSTOMER | SUPPLIER | BOTH
  name           String
  email          String?
  phone          String?
  address        String?
  taxNumber      String?
  isArchived     Boolean     @default(false)
  invoices       Invoice[]
  bills          Bill[]
  @@index([organisationId])
}
```

#### Invoice / InvoiceLine
```prisma
model Invoice {
  id             String        @id @default(cuid())
  organisationId String
  contactId      String        // customer
  number         String        // auto-generated: INV-0001, INV-0002, …
  date           DateTime      @db.Date
  dueDate        DateTime      @db.Date
  status         InvoiceStatus @default(DRAFT)
  subtotal       Decimal       @db.Decimal(19,4) @default(0)
  taxAmount      Decimal       @db.Decimal(19,4) @default(0)
  totalAmount    Decimal       @db.Decimal(19,4) @default(0)
  amountPaid     Decimal       @db.Decimal(19,4) @default(0)
  notes          String?
  journalEntryId String?       // set after postInvoiceToLedger()
  lines          InvoiceLine[]
  attachments    Attachment[]
  @@unique([organisationId, number])
  @@index([organisationId, status])
}
model InvoiceLine {
  invoiceId   String
  description String
  quantity    Decimal   @db.Decimal(10,4) @default(1)
  unitPrice   Decimal   @db.Decimal(19,4)
  amount      Decimal   @db.Decimal(19,4)   // = quantity * unitPrice
  taxRegimeId String?
  taxRateCode String?
  taxAmount   Decimal   @db.Decimal(19,4) @default(0)
  sortOrder   Int       @default(0)
}
```

#### Bill / BillLine
Exact same structure as Invoice/InvoiceLine. `contactId` references a supplier. `number` is nullable (supplier assigns it).

#### BankAccount / BankStatementLine
```prisma
model BankAccount {
  id             String      @id @default(cuid())
  organisationId String
  name           String
  accountId      String      // FK → ChartAccount (must be an ASSET account)
  currentBalance Decimal     @db.Decimal(19,4) @default(0)
  statementLines BankStatementLine[]
}
model BankStatementLine {
  id            String                  @id @default(cuid())
  bankAccountId String
  date          DateTime                @db.Date
  description   String
  amount        Decimal                 @db.Decimal(19,4)  // positive = credit, negative = debit
  status        BankStatementLineStatus @default(UNMATCHED)
  journalLineId String?                 // set when matched
  importedAt    DateTime                @default(now())
  @@index([bankAccountId, status])
}
```

#### Attachment
```prisma
model Attachment {
  id               String           @id @default(cuid())
  organisationId   String
  s3Key            String           // relative path: attachments/{orgId}/{id}.{ext}
  originalFilename String
  mimeType         String
  sizeBytes        Int
  extractionStatus ExtractionStatus @default(PENDING)
  extractionResult Json?            // ExtractionResult shape (see extraction.service.ts)
  invoiceId        String?
  billId           String?
  chatMessages     ChatMessage[]
  @@index([organisationId])
}
```

#### AuditLog
```prisma
model AuditLog {
  id             String      @id @default(cuid())
  organisationId String
  userId         String
  action         AuditAction
  entityType     String      // "Invoice", "Bill", "JournalEntry", etc.
  entityId       String
  before         Json?
  after          Json?
  createdAt      DateTime    @default(now())
  @@index([organisationId, entityType, entityId])
}
```

#### ChatConversation / ChatMessage
```prisma
model ChatConversation {
  id             String   @id @default(cuid())
  organisationId String
  userId         String
  title          String?  // auto-set: first 60 chars of first message
  createdAt / updatedAt
  messages       ChatMessage[]
  @@index([organisationId])
  @@index([userId])
}
model ChatMessage {
  id             String           @id @default(cuid())
  conversationId String
  role           String           // "user" | "assistant"
  content        String           // text only; TOOL_CALL: lines stripped before saving
  toolCalls      Json?            // raw tool call objects (audit)
  toolResults    Json?            // execution results (audit)
  attachmentId   String?
  createdAt      DateTime         @default(now())
  @@index([conversationId])
}
```

#### UsageRecord
```prisma
model UsageRecord {
  id                String @id @default(cuid())
  organisationId    String
  month             String   // "2026-05"
  transactionCount  Int      @default(0)
  aiExtractionCount Int      @default(0)
  updatedAt         DateTime @updatedAt
  @@unique([organisationId, month])
}
```

### Database seed (`prisma/seed.ts`)

Seeds the following `TaxRegime` + `TaxRate` records:

| Code | Name | Country | Rates |
|---|---|---|---|
| `UK_VAT` | UK Value Added Tax | GB | STANDARD 20%, REDUCED 5%, ZERO 0%, EXEMPT 0% |
| `US_SALES_TAX` | US Sales Tax | US | STANDARD 8.875%, ZERO 0%, EXEMPT 0% |
| `AU_GST` | Australian GST | AU | STANDARD 10%, ZERO 0%, EXEMPT 0% |
| `EU_VAT` | European Union VAT | EU | STANDARD 21%, REDUCED 10%, ZERO 0%, EXEMPT 0% |
| `IN_GST` | Indian GST | IN | GST_28 28%, GST_18 18%, GST_12 12%, GST_5 5%, ZERO 0%, EXEMPT 0% |
| `NONE` | No Tax | — | NONE 0% |

---

## 7. Default Chart of Accounts

Auto-seeded on organisation creation via `seedDefaultChartOfAccounts()` in `server/services/chart-of-accounts.service.ts`. Only seeded if no accounts exist.

```
ASSETS
  1000  Current Assets          (parent)
  1100    Cash at Bank          ASSET  DEBIT
  1110    Petty Cash            ASSET  DEBIT
  1200    Accounts Receivable   ASSET  DEBIT     ← used by invoice posting (code "1200")
  1300    Prepaid Expenses      ASSET  DEBIT
  1500  Fixed Assets            (parent)
  1510    Equipment             ASSET  DEBIT
  1520    Furniture & Fixtures  ASSET  DEBIT

LIABILITIES
  2000  Current Liabilities     (parent)
  2100    Accounts Payable      LIABILITY  CREDIT  ← used by bill posting (code "2100")
  2200    Tax Payable           LIABILITY  CREDIT  ← used for tax lines (code "2200")
  2300    Accrued Liabilities   LIABILITY  CREDIT
  2500  Long-term Liabilities   (parent)
  2510    Loans Payable         LIABILITY  CREDIT

EQUITY
  3000  Equity                  (parent)
  3100    Owner's Capital       EQUITY  CREDIT
  3200    Retained Earnings     EQUITY  CREDIT
  3300    Owner's Drawings      EQUITY  DEBIT

INCOME
  4000  Income                  (parent)
  4100    Sales Revenue         INCOME  CREDIT    ← used by invoice posting (code "4100")
  4200    Service Revenue       INCOME  CREDIT
  4300    Other Income          INCOME  CREDIT

EXPENSES
  5000  Operating Expenses      (parent)
  5100    Cost of Goods Sold    EXPENSE  DEBIT
  5200    Salaries & Wages      EXPENSE  DEBIT
  5300    Rent & Lease          EXPENSE  DEBIT
  5400    Utilities             EXPENSE  DEBIT
  5500    Marketing & Advertising EXPENSE DEBIT
  5600    Professional Fees     EXPENSE  DEBIT
  5700    Software & Subscriptions EXPENSE DEBIT
  5800    Travel & Entertainment EXPENSE DEBIT
  5900    Depreciation          EXPENSE  DEBIT
  5950    Miscellaneous Expenses EXPENSE DEBIT
```

**Critical:** Invoice posting hardcodes account lookups by code: AR = `1200`, Income = `4100`, Tax = `2200`. Bill posting uses: AP = `2100`, Expense = `5100` (or first expense account found). If the chart is modified and these codes don't exist, posting will throw.

---

## 8. Authentication

**File:** `lib/auth.ts`

- NextAuth.js v5 with `PrismaAdapter`
- Strategy: JWT (not database sessions)
- Providers: **CredentialsProvider** (email + bcrypt) + **GoogleProvider** (optional, only if both env vars set)
- JWT callback: stores `user.id` as `token.id`
- Session callback: exposes `session.user.id` from token

**Registration flow** (`server/routers/auth.ts`):
1. Validate email not already taken
2. `bcryptjs.hash(password, 12)`
3. Create `User` + empty `Organisation` (triggers onboarding)
4. On onboarding completion: `seedDefaultChartOfAccounts()`

**Type augmentation** (`types/next-auth.d.ts`):
```typescript
declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name?: string | null; image?: string | null }
  }
}
```

---

## 9. Middleware & Routing

**File:** `middleware.ts`

Runs on every request (except static files and images). Uses NextAuth's `auth()` as middleware.

```typescript
const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth", "/api/trpc", "/api/chat", "/pricing", "/api/webhooks"];

// If unauthenticated and not public → redirect to /login
// No server-side onboarding redirect here — that's done in app/(app)/layout.tsx
```

**App layout gate** (`app/(app)/layout.tsx`):
- Server component
- Fetches user + organisation
- If `!onboardingComplete` → `redirect("/onboarding")`
- Renders: `<Sidebar>` + `{children}` + `<ChatPanel />`

**Onboarding** (`app/onboarding/page.tsx`):
- 2-step wizard (client component)
- Step 1: business name + type → `trpc.org.setupStep1`
- Step 2: currency + tax regime + fiscal year start → `trpc.org.setupStep2`
- On step 2 success: `seedDefaultChartOfAccounts()` called server-side, `onboardingComplete = true`, redirect to `/dashboard`
- Progress bar shows 33% → 66% → 100%

---

## 10. tRPC Layer

**File:** `server/trpc.ts`

```typescript
// Three procedure types:
publicProcedure    // no auth
protectedProcedure // requires session (JWT)
orgProcedure       // requires session + organisationId → ctx.organisationId, ctx.user, ctx.organisation
```

Context shape:
```typescript
{ session: Session | null; db: PrismaClient }
// orgProcedure extends with:
// + user: User & { organisation: Organisation }
// + organisationId: string
// + organisation: Organisation
```

Uses `superjson` transformer so `Decimal`, `Date`, etc. survive serialisation.

**Root router** (`server/root.ts`): composes 13 routers:
`auth`, `org`, `accounts`, `transactions`, `contacts`, `invoices`, `bills`, `attachments`, `bankAccounts`, `reports`, `subscription`, `dashboard`, `chat`

### Router summaries

#### `auth`
- `register(email, password, name)` → public. Creates user + org. Returns partial user.
- `getSession()` → protected. Returns session user.

#### `org`
- `getCurrencies()` → public. Returns hardcoded list of ISO 4217 currencies.
- `getTaxRegimes()` → public. Returns all TaxRegime records with rates.
- `setupStep1(businessName, businessType)` → protectedProcedure. Updates org name + type.
- `setupStep2(currency, taxRegimeId?, fiscalYearStartMonth)` → protectedProcedure. Updates org financial settings, seeds chart of accounts, sets `onboardingComplete = true`.
- `getSettings()` → orgProcedure. Returns org + tax regime.
- `updateSettings(name, currency, fiscalYearStartMonth)` → orgProcedure.

#### `accounts`
- `list(includeArchived?)` → orgProcedure. Returns all ChartAccounts sorted by code.
- `create(code, name, type, normalBalance, parentId?, description?)` → orgProcedure.
- `update(id, name, description, isArchived?)` → orgProcedure. Cannot update system accounts.
- `archive(id)` → orgProcedure.

#### `transactions`
- `list(page, search?, accountId?, dateFrom?, dateTo?)` → orgProcedure. Returns JournalEntries (page size 50).
- `create(date, description, lines[], reference?, source?)` → orgProcedure. Calls `createJournalEntry()`.
- `void(id, reason)` → orgProcedure. Calls `voidJournalEntry()`.
- `importCSV(rows[])` → orgProcedure. Bulk-creates journal entries (income/expense format).
- `getById(id)` → orgProcedure.

#### `contacts`
- `list(type?, search?, includeArchived?)` → orgProcedure.
- `create(name, type, email?, phone?, address?, taxNumber?)` → orgProcedure.
- `update(id, ...)` → orgProcedure.
- `archive(id)` → orgProcedure.
- `getById(id)` → orgProcedure.

#### `invoices`
- `list(page, status, contactId?, search?)` → orgProcedure. Status "OVERDUE" filters by `dueDate < now AND status IN [SENT, PARTIAL]`.
- `getById(id)` → orgProcedure. Returns invoice + lines + contact + `effectiveStatus` + `amountDue`.
- `create(contactId, date, dueDate, lines[], notes?)` → orgProcedure. Auto-generates number, calculates totals.
- `update(id, ...)` → orgProcedure. Only DRAFT invoices can be updated.
- `send(id, sendEmail)` → orgProcedure. Posts to ledger (`postInvoiceToLedger`) + sets status SENT + optionally emails contact.
- `recordPayment(id, amount, cashAccountId, date, reference?)` → orgProcedure. Validates amount ≤ outstanding. Calls `recordInvoicePayment()`.
- `void(id, reason)` → orgProcedure. Calls `voidInvoice()`.
- `arAging()` → orgProcedure. Buckets: current / 1–30 / 31–60 / 61–90 / 90+ days past due.
- `getPdfData(id)` → orgProcedure. Returns flattened invoice data for PDF generation.

#### `bills`
Identical structure to `invoices` with AP logic:
- `list`, `getById`, `create`, `update`, `approve` (DRAFT → RECEIVED), `recordPayment`, `void`, `apAging`, `getPdfData`
- No `send` (bills come from suppliers; no email needed)
- `approve()` posts bill to ledger: debit expense (5100), credit AP (2100), optionally debit tax (2200)

#### `reports`
All `orgProcedure`, delegates to `ReportService`:
- `pnl(from, to)` → `getProfitAndLoss()`
- `balanceSheet(asOf)` → `getBalanceSheet()`
- `trialBalance(from, to)` → `getTrialBalance()`
- `taxSummary(from, to)` → `getTaxSummary()`

#### `dashboard`
- `summary()` → orgProcedure. Returns: monthIncome, monthExpenses, netProfit, arBalance, apBalance, cashBalance, recentTransactions[5], overdueInvoices[5].

#### `attachments`
- `upload` (POST, multipart) → server action (not tRPC). Saves file to local storage, creates `Attachment` record, enqueues `ai-extraction` BullMQ job.
- `getById(id)` → orgProcedure. Returns attachment + extractionResult.
- `list()` → orgProcedure.

#### `bankAccounts`
- `list()` → orgProcedure.
- `create(name, chartAccountId)` → orgProcedure.
- `importCSV(bankAccountId, rows[])` → orgProcedure. Creates `BankStatementLine` records.
- `getStatementLines(bankAccountId, status?)` → orgProcedure.
- `autoMatch(bankAccountId)` → orgProcedure. Calls `autoMatchBankAccount()`.
- `matchLine(statementLineId, journalLineId)` → orgProcedure. Manual match.
- `unmatchLine(statementLineId)` → orgProcedure.
- `excludeLine(statementLineId)` → orgProcedure.
- `createTransaction(statementLineId, journalEntryData)` → orgProcedure. Creates transaction + marks line as CREATED.

#### `subscription`
- `currentPlan()` → orgProcedure. Returns tier + usage counts.
- `createCheckoutSession(priceId, successUrl, cancelUrl)` → orgProcedure.
- `createPortalSession(returnUrl)` → orgProcedure.

#### `chat`
- `listConversations()` → orgProcedure. Returns conversations newest first.
- `getConversation(conversationId)` → orgProcedure. Returns conversation + messages (includes toolResults for card rendering).
- `deleteConversation(conversationId)` → orgProcedure. Hard deletes conversation + cascade messages.

---

## 11. Service Layer

### `accounting.service.ts`

**`createJournalEntry(db, input)`**
- Validates debits == credits (tolerance 0.0001) — throws `TRPCError BAD_REQUEST` if unbalanced
- Requires ≥ 2 lines
- Creates `JournalEntry` + nested `JournalLine[]` in one Prisma transaction
- All amounts stored as `new Prisma.Decimal(n)`

**`voidJournalEntry(db, journalEntryId, organisationId, userId, reason)`**
- Finds original (must be non-void, same org)
- Marks original `isVoid = true`, sets `voidedAt` + `voidReason`
- Creates reversal entry: each line's debit ↔ credit swapped, description prefixed "Reversal:"
- Description of reversal entry: `VOID: {original.description}`

**`getAccountBalance(db, accountId, organisationId, asOf?)`**
- Aggregates `JournalLine._sum.debit` and `._sum.credit` for non-void entries
- Returns `debits - credits` for DEBIT-normal accounts, `credits - debits` for CREDIT-normal

**`buildIncomeEntry(params)` / `buildExpenseEntry(params)`**
- Helpers to build journal line arrays for simplified income/expense transactions
- Income: debit cash, credit income, (optionally credit tax)
- Expense: debit expense, (optionally debit tax), credit cash

### `invoice.service.ts`

**`getNextInvoiceNumber(db, organisationId)`**
- Finds last invoice by `createdAt desc`, extracts trailing number, increments
- Format: `INV-0001`, `INV-0002`, … (4-digit zero-padded)

**`calcInvoiceTotals(lines)`**
- Returns `{ subtotal, taxAmount, totalAmount }` as numbers

**`createInvoice(db, input)`**
- Auto-generates number, calculates totals, creates `Invoice` + `InvoiceLine[]`
- Status defaults to `DRAFT`

**`postInvoiceToLedger(db, invoiceId, organisationId, userId)`**
- Finds accounts by code: AR=`1200`, Income=`4100`, Tax=`2200`
- Lines: debit AR by total, credit Income by subtotal, credit Tax by taxAmount (if >0 and tax account found)
- Calls `createJournalEntry()`, updates `invoice.journalEntryId`

**`recordInvoicePayment(db, params)`**
- Finds AR account (code `1200`)
- Lines: debit cashAccountId by amount, credit AR by amount
- Updates `invoice.amountPaid` and status: `≥ total → PAID`, `> 0 → PARTIAL`

**`voidInvoice(db, invoiceId, organisationId, userId, reason)`**
- If `journalEntryId` exists, calls `voidJournalEntry()`
- Sets invoice `status = VOID`

**`effectiveStatus(invoice)`**
- If `PAID | VOID | DRAFT` → return as-is
- If past due and not fully paid → `OVERDUE`
- If fully paid → `PAID`
- Otherwise → existing status

### `bill.service.ts`

Mirrors `invoice.service.ts` with AP logic:
- **`postBillToLedger`**: debit Expense (code `5100`), credit AP (code `2100`), optionally debit Tax (code `2200`)
- **`recordBillPayment`**: debit AP (code `2100`), credit cashAccountId
- Number format: `BILL-0001` (or taken from supplier's own number)

### `report.service.ts`

**`getProfitAndLoss(prisma, organisationId, range)`**
- Queries `JournalLine` joined to non-void entries in date range, account type `INCOME | EXPENSE`
- Aggregates per account: income = `credits - debits`, expense = `debits - credits`
- Returns `{ accounts[], totalIncome, totalExpenses, netProfit }`

**`getBalanceSheet(prisma, organisationId, asOf)`**
- Queries lines up to `asOf`, account type `ASSET | LIABILITY | EQUITY`
- Asset = `debits - credits`, Liability/Equity = `credits - debits`
- Returns `{ assets[], liabilities[], equity[], totalAssets, totalLiabilities, totalEquity }`

**`getTrialBalance(prisma, organisationId, range)`**
- All non-archived accounts, aggregates raw debit + credit totals
- Returns `{ accounts[], totalDebits, totalCredits }` — if balanced, `totalDebits == totalCredits`

**`getTaxSummary(prisma, organisationId, range)`**
- Aggregates `Invoice.taxAmount` (output tax) and `Bill.taxAmount` (input tax) for non-void records in range
- Returns `{ outputTax, inputTax, netTaxPayable, invoiceCount, billCount }`

### `reconciliation.service.ts`

**`autoMatchBankAccount(prisma, bankAccountId, organisationId)`**
- For each `UNMATCHED` statement line:
  - Amount exact match: positive line → find journal line with matching `credit`, negative → matching `debit`
  - Date window: ±5 calendar days
  - Journal line must not already be matched (`bankStatementLines: { none: {} }`)
  - If exactly 1 candidate → auto-match (update status + set `journalLineId`)
- Returns count of auto-matched lines

### `extraction.service.ts`

**`extractDocument(filePath, mimeType)`**
- Checks Ollama reachability (3s timeout); if unreachable → returns `MOCK_RESULT`
- For image MIME types: sends base64 image to Ollama `/api/chat` with `images` array (multimodal)
- For PDFs: sends first 5000 chars of base64 as text context (Ollama can't render PDFs)
- Ollama request: `stream: false`, `temperature: 0.1`, `num_predict: 4096`
- Response parsing: strips markdown fences, extracts JSON with regex, validates shape
- Returns `ExtractionResult` with all fields nullable and `confidence: Record<string, number>`

**Mock result** (used when Ollama is offline):
```json
{
  "supplierName": "Acme Supplies Ltd",
  "invoiceNumber": "INV-2026-0042",
  "invoiceDate": "2026-04-15",
  "dueDate": "2026-05-15",
  "lineItems": [
    { "description": "Web hosting (annual)", "quantity": 1, "unitPrice": 299.0, "amount": 299.0 },
    { "description": "Domain registration", "quantity": 2, "unitPrice": 12.5, "amount": 25.0 }
  ],
  "subtotal": 324.0, "taxAmount": 64.8, "totalAmount": 388.8, "currency": "USD"
}
```

### `chart-of-accounts.service.ts`

**`seedDefaultChartOfAccounts(db, organisationId)`**
- Two-pass: creates parent accounts (no `parentCode`) first, then children
- All seeded accounts get `isSystem: true`
- Skips if `chartAccount.count > 0` for the org (idempotent)

### `subscription.service.ts`

- `getOrCreateStripeCustomer()` → upserts Stripe customer, stores `stripeCustomerId`
- `createCheckoutSession()` → Stripe `checkout.sessions.create` with `mode: "subscription"`
- `createBillingPortalSession()` → Stripe billing portal session
- `handleWebhookEvent()` → handles `customer.subscription.created/updated/deleted`, updates `subscriptionTier` on org
- `checkUsageLimits()` → returns extraction count + whether within free tier limit (5/month)
- Tier mapping: `STRIPE_PRO_MONTHLY_PRICE_ID` or `STRIPE_PRO_ANNUAL_PRICE_ID` → `PRO`; anything else → `FREE`

### `email.service.ts`

Uses `nodemailer` with SMTP. Dev: Mailhog (`localhost:1025`). Prod: set `SMTP_HOST/PORT/USER/PASS` to Resend SMTP.

Functions:
- `sendInvoiceEmail({ to, toName, fromName, invoiceNumber, invoiceDate, dueDate, totalAmount, currency })`
- `sendWelcomeEmail({ to, name })`

HTML templates are inline strings (no React Email in current implementation).

### `audit.service.ts`

**`writeAuditLog(db, { organisationId, userId, action, entityType, entityId, before?, after? })`**
- Simple `db.auditLog.create()` wrapper
- Called explicitly in tRPC mutations (not automatic middleware)

### `rateLimit.ts`

In-memory rate limiter using `Map<string, { count, resetAt }>`.

```typescript
createRateLimiter(limit: number, windowMs: number)
// Returns a `check(key: string): void` function that throws TRPCError TOO_MANY_REQUESTS
```

Pre-built limiters:
- `authRateLimiter` — 10 req/min (for login/register)
- `extractionRateLimiter` — 20 req/min (for AI extraction endpoints)

**Note:** In-memory only — resets on server restart, not shared across multiple instances.

### `usageGate.ts`

**`assertCanExtract(prisma, organisationId)`**
- Fetches `subscriptionTier`; if `PRO` or `BUSINESS`, allows (unlimited)
- For `FREE`: checks `UsageRecord` for current month; throws `FORBIDDEN: FREE_TIER_LIMIT_REACHED:ai_extraction` if `aiExtractionCount >= 5`

---

## 12. Background Workers

### `extraction.worker.ts`

Run as a **separate process**: `npx tsx server/workers/extraction.worker.ts`

- Connects to Redis at `localhost:6379`
- Processes BullMQ queue `ai-extraction` with concurrency 3
- Job payload: `{ attachmentId, organisationId, userId }`

**Job steps:**
1. Mark attachment `PROCESSING`
2. Fetch attachment record (gets `s3Key` + `mimeType`)
3. Call `extractDocument(s3Key, mimeType)` — reads from `./storage/{s3Key}`
4. Store `extractionResult` JSON + mark `DONE`
5. Upsert `UsageRecord` for current month, increment `aiExtractionCount`

**Error handling:** On failure, marks attachment `FAILED`. Retries: 3 attempts, exponential backoff starting at 5s.

**Graceful shutdown:** Listens to `SIGINT` / `SIGTERM`, closes worker + Prisma + Redis connection.

### BullMQ queue config (`lib/queue.ts`)

```typescript
const extractionQueue = new Queue<ExtractionJob>("ai-extraction", {
  connection: { host: "localhost", port: 6379 },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
```

---

## 13. API Routes

### `POST /api/chat` — Chat SSE endpoint

The central chat endpoint. Uses Server-Sent Events (SSE) for real-time token streaming. `maxDuration = 120` seconds.

**Request body:**
```typescript
{ message: string; conversationId?: string; attachmentId?: string }
```

**Flow:**
1. Auth check: `session?.user?.id` required; load user with organisation
2. If no `conversationId`: create new `ChatConversation` with `title = message.slice(0, 60)`
3. Persist user `ChatMessage`
4. Call `buildChatMessages(db, { organisationId, conversationId, userMessage, attachmentId })` to get Ollama message array
5. Open SSE stream with `ReadableStream`
6. Send `event: start` with `{ conversationId }`
7. POST to `${OLLAMA_BASE_URL}/api/chat` with `{ model, messages, stream: true, think: false }`
8. Stream response: for each Ollama chunk:
   - If `json.message.content` → `fullContent += token`, send `event: token { content: token }`
   - If `json.message.thinking` (first time only) → send `event: thinking { status: "thinking" }`
9. After stream ends: call `parseToolCalls(fullContent)` → `{ text, toolCalls }`
10. Execute each tool call: `executeToolCall(db, organisationId, userId, call)`
11. Build `summary` from tool results (only for action tools; list/get/report tools return empty string)
12. `finalContent = summary ? "${text}\n\n${summary}".trim() : text`
13. Persist assistant `ChatMessage` with `content`, `toolCalls`, `toolResults`
14. Send `event: done { conversationId, content: finalContent, toolCalls, toolResults }`
15. Close stream

**SSE events emitted:**
| Event | Payload |
|---|---|
| `start` | `{ conversationId }` |
| `thinking` | `{ status: "thinking" }` (at most once) |
| `token` | `{ content: "..." }` (one per Ollama chunk) |
| `done` | `{ conversationId, content, toolCalls, toolResults }` |
| `error` | `{ message: "..." }` |

### `GET /api/invoices/[id]/pdf`

Generates and returns PDF for an invoice using `@react-pdf/renderer`. Fetches invoice data via tRPC server caller, renders React PDF component, streams as `application/pdf`.

### `POST /api/attachments/upload`

Handles multipart file upload:
1. Auth + org check
2. Check `assertCanExtract()` (usage gate)
3. Parse multipart form, validate MIME type (images + PDF)
4. Generate `attachmentId = cuid()`
5. Save to `./storage/attachments/{orgId}/{attachmentId}.{ext}` via `storage.saveFile()`
6. Create `Attachment` record with `s3Key = relative path`
7. Enqueue BullMQ job: `extractionQueue.add(jobId, { attachmentId, organisationId, userId })`
8. Return `{ attachmentId }`

### `GET /api/attachments/[id]/file`

Serves the raw attachment file for the authenticated user's org. Reads from local storage, returns with correct `Content-Type`.

### `GET /api/export`

Exports all org data as a ZIP file (`jszip`) containing:
- `invoices.csv`
- `bills.csv`
- `transactions.csv`
- `contacts.csv`

Returns `Content-Disposition: attachment; filename="autoaccounts-export-{date}.zip"`.

### `POST /api/webhooks/stripe`

Verifies Stripe signature (`stripe.webhooks.constructEvent`). Calls `handleWebhookEvent()`. Returns 200 on success. Handles: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

---

## 14. Frontend — App Shell

### Sidebar (`app/(app)/_components/sidebar.tsx`)

Left navigation. Items:
- Dashboard (`/dashboard`)
- Invoices (`/invoices`)
- Bills (`/bills`)
- Contacts (`/contacts`)
- Accounts (`/accounts`)
- Transactions (`/transactions`)
- Extract (`/extract`)
- Reconciliation (`/reconciliation`)
- Reports (`/reports`) — expands to sub-items
- Settings (`/settings`)
- Chat toggle button — opens/closes `ChatPanel`

### App Layout (`app/(app)/layout.tsx`)

Server component. Auth guard + onboarding gate. Renders:
```jsx
<div className="flex h-screen overflow-hidden bg-canvas">
  <aside className="hidden md:flex md:shrink-0 shadow-[1px_0_0_0_hsl(220_16%_88%)]">
    <Sidebar orgName={user.organisation.name} />
  </aside>
  <main className="flex flex-1 flex-col overflow-hidden">
    <div className="flex-1 overflow-y-auto">{children}</div>
  </main>
  <ChatPanel />
</div>
```

---

## 15. Frontend — Pages

All pages inside `app/(app)/` are client components (use `"use client"`) unless noted.

### Dashboard (`/dashboard`)
- KPI cards: month income/expenses/net profit, AR balance, AP balance, cash balance
- Recent transactions list
- Overdue invoices list
- Income vs expense Recharts bar chart (last 12 months)
- All data from `trpc.dashboard.summary.useQuery()`

### Invoices (`/invoices`)
- List with status filter tabs (All / Draft / Sent / Partial / Paid / Overdue / Void)
- Search by invoice number or customer name
- Pagination (50 per page)
- Click row → `/invoices/[id]`
- "New Invoice" button → `/invoices/new`

### Invoice Detail (`/invoices/[id]`)
- Shows invoice header + line items table
- Status badge with `effectiveStatus`
- Action buttons: Send (if DRAFT), Record Payment (if SENT/PARTIAL), Void, Download PDF
- Payment modal: amount + account selector + date

### Invoice Create (`/invoices/new`)
- Contact selector (with search/create inline)
- Date + due date pickers
- Dynamic line items (add/remove rows)
- Auto-calculates subtotal, tax, total
- Tax rate per line from org tax regime
- Submit → `trpc.invoices.create` → redirect to detail page

### Bills — identical structure to Invoices

### Contacts (`/contacts`)
- Tabs: All / Customers / Suppliers
- Create/edit/archive inline modal
- Fields: name, type, email, phone, address, tax number

### Accounts (`/accounts`)
- Grouped by type (ASSET / LIABILITY / EQUITY / INCOME / EXPENSE)
- Shows code, name, type, normal balance, archived badge
- Create account form
- Cannot edit/delete system accounts

### Transactions (`/transactions`)
- Table of journal entries: date, description, source, reference, debit total, credit total
- Filter by date range + account + search
- CSV import dialog (`_components/csv-import-dialog.tsx`)
- New transaction → `/transactions/new`

### Transaction Create (`/transactions/new`)
- Simplified form: date, description, lines (account + debit/credit amounts)
- Validates balance client-side before submit
- Uses `trpc.transactions.create`

### Extract (`/extract`)
- Drag-drop file upload (images + PDF)
- Calls `POST /api/attachments/upload`
- Polls `trpc.attachments.getById` until `extractionStatus = DONE`
- Shows extracted fields with confidence badges (color-coded: green ≥ 0.9, yellow ≥ 0.7, red < 0.7)
- Editable form for user to correct extracted values
- Buttons: "Create Bill" / "Create Invoice" / "Record Expense" → routes to appropriate create page with pre-filled query params

### Reconciliation (`/reconciliation`)
- Lists bank accounts with current balance
- Per account → `/reconciliation/[bankAccountId]`
- Statement line list (unmatched on left, journal entries on right)
- "Auto Match" button calls `trpc.bankAccounts.autoMatch`
- Manual match: click statement line + click journal entry
- Actions per statement line: match, exclude, create transaction

### Reports (`/reports/[type]`)
All report pages follow same pattern:
- Date range picker (from/to)
- Fetch data via tRPC on submit
- Display table with totals
- Export to CSV button
- No PDF export implemented yet (planned)

### Settings (`/settings`)
- Org name, currency, fiscal year start
- Calls `trpc.org.updateSettings`

### Settings/Billing (`/settings/billing`)
- Shows current tier (Free / Pro)
- Usage stats (AI extractions this month)
- Upgrade button → Stripe Checkout via `trpc.subscription.createCheckoutSession`
- Manage billing → Stripe portal via `trpc.subscription.createPortalSession`

### Pricing (`/pricing`) — public
- Comparison table: Free vs Pro features + pricing
- "Get started" / "Upgrade to Pro" CTA buttons

---

## 16. Chat Assistant

### Architecture overview

```
User types in <ChatPanel> (floating overlay, right side)
     │
     ▼ POST /api/chat  (SSE stream)
     │
     ▼ Route handler (app/api/chat/route.ts)
       ├─ Auth + org check
       ├─ Create/reuse ChatConversation
       ├─ Persist user ChatMessage
       ├─ buildChatMessages() → Ollama messages array
       ├─ Stream to Ollama via /api/chat (stream: true, think: false)
       ├─ Emit SSE tokens → UI typing animation
       ├─ parseToolCalls(fullContent) → { text, toolCalls }
       ├─ executeToolCall() for each tool call
       ├─ Persist assistant ChatMessage
       └─ Emit SSE "done" event
```

### `chat.service.ts` — `buildChatMessages()`

Builds the Ollama message array:
1. **System message** with:
   - Org context: `orgName`, `currency`, active accounts list (code + name), recent contacts (name + type)
   - `APP_UI_GUIDE` — step-by-step procedures for every page/workflow in the app
   - `TOOL_DEFINITIONS` — all 25 tool definitions with JSON schema for each argument
   - Rules section (when to use tools vs when to give UI steps)
2. **Conversation history** — last 20 messages formatted as `user`/`assistant` roles
3. **Current user message** appended last

**`APP_UI_GUIDE`** covers:
- Navigation structure (all page URLs and their purpose)
- Step-by-step guides for: Create invoice, Create bill, Record payment, Void invoice, Create contact, Create account, Upload receipt (AI extraction), Bank reconciliation, Run reports, Subscription upgrade

### `chat.service.ts` — `parseToolCalls()`

```typescript
function parseToolCalls(text: string): { text: string; toolCalls: ToolCall[] }
```

- Splits response on newlines
- Finds lines starting with `TOOL_CALL:` (after trimming)
- Parses the JSON object from each such line
- Strips all `TOOL_CALL:` lines from `text` and trims
- Returns clean text + array of `{ tool: string; args: Record<string, unknown> }`

### `chat.service.ts` — `executeToolCall()`

Dispatches to one of 25 tool functions based on `call.tool`. All tool functions receive `(db, organisationId, userId, args)` and return `ToolResult`:

```typescript
interface ToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
```

### All 25 tools

#### Create / Mutation tools

**`create_journal_entry`**
- Args: `{ date, description, lines: [{ account, debit?, credit? }] }`
- Resolves account names to IDs via `chartAccount.findFirst({ name: { contains: account } })`
- Calls `createJournalEntry()` from accounting.service
- Returns: `{ id, description, date, lines: [{ account, debit, credit }] }`

**`create_invoice`**
- Args: `{ contactName, lines: [{ description, quantity, unitPrice }], dueDate, date?, notes? }`
- Finds or creates contact by name
- Calls `createInvoice()` from invoice.service
- Returns: `{ id, number, customer, date, dueDate, status, total }`

**`create_bill`**
- Args: `{ supplierName, lines: [...], dueDate, date?, notes? }`
- Same pattern as `create_invoice` using bill.service
- Returns: `{ id, number, supplier, date, dueDate, status, total }`

**`record_invoice_payment`**
- Args: `{ invoiceNumber, amount, date?, accountName? }`
- Finds invoice by number, finds cash account (defaults to "Cash at Bank" code `1100`)
- Calls `recordInvoicePayment()` from invoice.service
- Returns: `{ invoiceNumber, amount, newStatus, remainingBalance }`

**`record_bill_payment`**
- Same pattern for bills

**`void_invoice`**
- Args: `{ invoiceNumber, reason? }`
- Calls `voidInvoice()` from invoice.service
- Returns: `{ invoiceNumber, status: "VOID" }`

**`void_bill`** — same pattern

**`void_transaction`**
- Args: `{ description, reason? }` (finds by description match)
- Calls `voidJournalEntry()` from accounting.service

**`send_invoice`**
- Args: `{ invoiceNumber }`
- Posts to ledger + sets status SENT
- Returns: `{ invoiceNumber, status: "SENT" }`

**`approve_bill`**
- Args: `{ billNumber }`
- Posts to ledger + sets status RECEIVED (approved)

**`create_contact`**
- Args: `{ name, type, email?, phone? }`
- Direct `db.contact.create()`
- Returns: `{ id, name, type, email }`

**`update_contact`**
- Args: `{ name, newName?, email?, phone? }`
- Finds by name, updates fields
- Returns updated contact fields

**`create_account`**
- Args: `{ name, type, code?, parentName? }`
- Auto-generates next available code if not provided (finds max code in type group + 10)
- Direct `db.chartAccount.create()`
- Returns: `{ id, code, name, type }`

#### Query tools

**`get_invoice`**
- Args: `{ invoiceNumber }`
- Returns: `{ number, customer, date, dueDate, status, subtotal, tax, total, paid, outstanding, lines[] }`

**`get_bill`** — same structure

**`list_invoices`**
- Args: `{ status?: "ALL"|"DRAFT"|"SENT"|"PARTIAL"|"PAID"|"OVERDUE"|"VOID", limit? }`
- Returns array of invoice summaries with `outstanding` field

**`list_bills`** — same structure

**`list_contacts`**
- Args: `{ type?: "CUSTOMER"|"SUPPLIER"|"BOTH" }`
- Returns contacts with type + email

**`list_accounts`**
- Args: `{ type?: "ASSET"|"LIABILITY"|"EQUITY"|"INCOME"|"EXPENSE" }`
- Returns accounts with code, name, type, balance

**`get_account_balance`**
- Args: `{ accountName }`
- Finds account, calls `getAccountBalance()` from accounting.service
- Returns: `{ accountName, code, type, balance, currency }`

**`search_transactions`**
- Args: `{ query, limit? }`
- `db.journalEntry.findMany({ description: { contains: query } })`
- Returns entries with date, description, total debit

**`get_profit_and_loss`**
- Args: `{ from, to }` (ISO date strings)
- Calls `getProfitAndLoss()` from report.service
- Returns: `{ from, to, income[], expenses[], totalIncome, totalExpenses, netProfit }`

**`get_balance_sheet`**
- Args: `{ asOf }` (ISO date string)
- Calls `getBalanceSheet()` from report.service
- Returns: `{ asOf, assets[], liabilities[], equity[], totalAssets, totalLiabilities, totalEquity }`

**`get_trial_balance`**
- Args: `{ from, to }`
- Calls `getTrialBalance()` from report.service
- Returns: `{ from, to, accounts[], totalDebits, totalCredits }`

**`get_ar_aging`**
- Direct Prisma query on outstanding invoices (status: SENT/PARTIAL/OVERDUE)
- Groups into buckets: current / 1–30 / 31–60 / 61–90 / 90+ days
- Returns: `{ rows[{ customer, current, days30, days60, days90, over90, total }], totals, invoiceCount }`

**`get_ap_aging`** — same structure for bills

### System prompt `TOOL_DEFINITIONS` format

Each tool is defined as a text block:

```
TOOL: create_invoice
DESCRIPTION: Create a new draft invoice for a customer.
ARGS:
  contactName (string, required): The customer's name
  lines (array, required): Line items — each has description, quantity, unitPrice
  dueDate (string, required): Due date in YYYY-MM-DD format
  date (string, optional): Invoice date, defaults to today
  notes (string, optional): Additional notes
TO USE: TOOL_CALL: {"tool": "create_invoice", "args": {...}}
```

### Tool call format (from AI)

The AI embeds tool calls as lines starting with `TOOL_CALL:`:
```
Sure! I'll create that invoice for you.
TOOL_CALL: {"tool": "create_invoice", "args": {"contactName": "Acme Corp", "lines": [{"description": "Consulting", "quantity": 5, "unitPrice": 150}], "dueDate": "2026-06-15"}}
```

### `buildToolSummary()` in route handler

Only generates a text summary for **action tools** (create/payment/void). List, get, and report tools return `""` so only their visual card is shown, no duplicate text summary.

### Chat UI (`app/(app)/_components/chat-panel.tsx`)

**State management:**
- `isOpen: boolean` — panel visibility
- `conversationId: string | null` — active conversation
- `messages: ChatMessage[]` — displayed messages
- `streamingContent: string` — accumulates tokens during streaming
- `isStreaming: boolean` — shows typing indicator

**SSE client logic:**
```typescript
const evtSource = new EventSource("/api/chat", { ... });
// Uses fetch + ReadableStream manually (EventSource doesn't support POST)
// Parses lines, handles events: start, token, done, error
```

On `token` event: append to `streamingContent` state (shows typing animation).
On `done` event: replace streaming content with final message, fetch updated conversation via tRPC.

**`stripToolCalls(text: string): string`**
```typescript
text.split("\n")
  .filter(l => !l.trimStart().startsWith("TOOL_CALL:"))
  .join("\n")
  .trim()
```
Applied in `MessageBubble` for both streaming display and stored assistant messages.

**Conversation sidebar:**
- Lists all conversations from `trpc.chat.listConversations`
- New chat button clears `conversationId`
- Delete button calls `trpc.chat.deleteConversation`
- Click to switch conversation

**`ToolResultCard` — 20+ visual card types:**

All cards use consistent design: white body + colored header, `text-xs`, external link icons.

| Tool | Card color | Key fields shown |
|---|---|---|
| `create_invoice` | Blue | Number, customer, issued, due, status badge, total |
| `create_bill` | Amber | Number, supplier, issued, due, status badge, total |
| `create_journal_entry` | Violet | Description, DR/CR lines in `grid-cols-[1fr_72px]` |
| `record_invoice_payment` / `record_bill_payment` | Green | Invoice/bill number, amount, new status |
| `void_invoice` / `void_bill` / `void_transaction` | Orange | Voided record identifier |
| `send_invoice` / `approve_bill` | Slate | Record number, new status |
| `create_contact` / `update_contact` | Slate | Name, type badge, email |
| `create_account` | Slate | Code (monospace), name, type |
| `get_invoice` / `get_bill` | White border-slate | Header + all detail rows; outstanding only shown if partial |
| `list_invoices` | Blue header | Scrollable rows: number, customer, status, outstanding |
| `list_bills` | Amber header | Same for bills |
| `list_contacts` | Slate | Rows: name, type badge (`CONTACT_TYPE_COLORS`), email |
| `list_accounts` | Slate | `grid-cols-[40px_1fr_auto]`: code, name, balance |
| `get_account_balance` | Slate | Account name, monospace code, large balance figure |
| `search_transactions` | Slate | Date, description, amount per entry |
| `get_profit_and_loss` | Slate | Income section + Expenses section + Net Profit total |
| `get_balance_sheet` | Slate | Assets / Liabilities / Equity sections with totals |
| `get_trial_balance` | Slate | `grid-cols-[1fr_76px_76px]` for account/DR/CR columns |
| `get_ar_aging` | Blue-themed | Bucket columns: Current/30/60/90/90+ per customer |
| `get_ap_aging` | Amber-themed | Same for AP |

**`CONTACT_TYPE_COLORS`:**
```typescript
const CONTACT_TYPE_COLORS: Record<string, string> = {
  CUSTOMER: "bg-blue-100 text-blue-700",
  SUPPLIER: "bg-amber-100 text-amber-700",
  BOTH: "bg-violet-100 text-violet-700",
};
```

**`StatusBadge`** — inline component inside `ToolResultCard`:
```typescript
// Maps InvoiceStatus to color+label:
// DRAFT → slate, SENT → blue, PARTIAL → amber, PAID → green, OVERDUE → red, VOID → gray
```

**`Row`** — inline sub-component for key/value pairs (no colons, consistent spacing):
```tsx
function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
```

**`CARD_TOOLS`** — set of all 25 tool names. If a message's `toolResults` contains any tool in this set, the text bubble is only shown if `stripToolCalls(content)` is non-empty.

---

## 17. File Storage

**Local mode** (`lib/storage.ts`):
- Root: `./storage/` (in project root, gitignored)
- Path format: `./storage/attachments/{organisationId}/{attachmentId}.{ext}`
- `s3Key` field in DB stores the relative path: `attachments/{organisationId}/{attachmentId}.{ext}`
- Functions: `saveFile()`, `readFile()`, `deleteFile()`

**Production mode** (not yet wired — uses same API surface):
- Replace `storage.ts` with S3-backed implementation using `@aws-sdk/client-s3`
- `s3.ts` exists with AWS S3 client setup but is not currently called from upload/read paths

---

## 18. Email

Uses `nodemailer` directly (not Resend SDK despite being listed as a dependency).

Dev: Mailhog at `localhost:1025` (no auth). Emails viewable at `localhost:8025`.
Prod: Set `SMTP_HOST/PORT/USER/PASS` to Resend's SMTP relay (`smtp.resend.com:587`).

Templates are plain HTML strings inside the service functions. No React Email currently.

---

## 19. Subscription & Billing

**Tiers:**
- `FREE`: 5 AI extractions/month; all core features otherwise unlimited in current impl
- `PRO`: unlimited AI extractions; Stripe subscription required
- `BUSINESS`: planned, not implemented

**Free tier enforcement:**
- Only AI extraction is currently gated (via `assertCanExtract()`)
- Transaction count tracking exists in `UsageRecord` but not enforced

**Stripe webhook flow:**
1. `POST /api/webhooks/stripe` receives event
2. Verifies signature with `STRIPE_WEBHOOK_SECRET`
3. On `subscription.created/updated`: resolves tier from price ID, updates org
4. On `subscription.deleted`: resets to `FREE`

**Stripe price ID mapping:**
- `STRIPE_PRO_MONTHLY_PRICE_ID` → PRO
- `STRIPE_PRO_ANNUAL_PRICE_ID` → PRO
- Anything else → FREE

---

## 20. Testing

### Unit tests (Vitest)

**Config** (`vitest.config.ts`): uses `@vitejs/plugin-react`, global setup from `tests/setup.ts`.

**Pattern:** All services are tested by injecting a mock `db` object:
```typescript
const mockDb = {
  chartAccount: { findMany: vi.fn(), findFirst: vi.fn(), ... },
  journalEntry: { create: vi.fn(), findFirst: vi.fn(), ... },
  // ... all tables used by the service
} as unknown as PrismaClient;
```

**Prisma Decimal mock:**
```typescript
function dec(n: number) {
  return { toNumber: () => n, valueOf: () => n, toString: () => String(n) };
}
// Used because Prisma Decimal has .toNumber() API used in services
```

**Test files and coverage:**

| File | Tests | Coverage |
|---|---|---|
| `accounting.test.ts` | 19 | `createJournalEntry`, `voidJournalEntry`, `getAccountBalance`, balance validation, income/expense builders |
| `report.service.test.ts` | 14 | `getProfitAndLoss`, `getBalanceSheet`, `getTrialBalance`, `getTaxSummary` |
| `reconciliation.service.test.ts` | 6 | `autoMatchBankAccount` — exact match, date window, ambiguous (no match), negative amounts |
| `chat.service.test.ts` | 10 | `parseToolCalls` — extracts tools, strips lines, handles malformed JSON, multi-tool, no tools |
| `chat.tools.test.ts` | 75 | All 25 tool functions — success cases + error cases (not found, already voided, etc.) |
| `subscription.service.test.ts` | 6 | `checkUsageLimits` — free/pro tiers, usage count tracking |
| `rateLimit.test.ts` | 5 | Rate limiter — allows under limit, throws over limit, resets after window |
| `usageGate.test.ts` | 5 | `assertCanExtract` — free under limit, free at limit, pro bypasses |

**Total: 140 tests, all passing.**

### E2E tests (Playwright)

`playwright.config.ts`: runs against `localhost:3000`.

- `auth.spec.ts`: register → login → redirect to onboarding
- `navigation.spec.ts`: authenticated navigation between main pages

---

## 21. Key Invariants & Design Decisions

### Double-entry integrity
`assertBalanced()` in `accounting.service.ts` throws if `|totalDebits - totalCredits| > 0.0001`. This is called before every `db.journalEntry.create()`. **Never bypass this.**

### Monetary precision
All monetary values stored as `NUMERIC(19,4)` (Prisma `@db.Decimal(19,4)`). Never use JavaScript `number` for storage. When passing to `createJournalEntry`, wrap in `new Prisma.Decimal(n)`.

### Void, don't delete
Posted transactions are voided (reversal journal entry). The original entry is preserved with `isVoid = true`. Hard deletes only on `DRAFT` records.

### Org scoping
Every query includes `organisationId` in the `where` clause. `orgProcedure` injects `ctx.organisationId` — all procedures using `orgProcedure` are automatically scoped.

### AI confirmation
The current chat implementation executes tools directly without a confirmation step. The spec originally called for confirmation cards before destructive actions — this is a known gap.

### Streaming chat
Chat uses `POST /api/chat` with SSE (`text/event-stream`), not a tRPC mutation. This avoids the 30s serverless timeout for long AI responses. The `EventSource` API doesn't support POST, so the client uses `fetch` with a `ReadableStream` reader.

### Tailwind JIT dynamic classes
All Tailwind class strings must be statically analyzable. Template literals like `border-${color}-200` are not compiled. Every Tailwind class used in `chat-panel.tsx` must appear as a complete string literal.

### `think: false` in Ollama
The Ollama API call includes `think: false` to disable extended thinking mode on models that support it (e.g., gemma4 with thinking). This improves response time.

### Account code lookup in posting
Invoice/bill posting looks up accounts by hardcoded codes:
- AR: `1200` (Accounts Receivable)
- Income: `4100` (Sales Revenue)
- AP: `2100` (Accounts Payable)
- Expense: `5100` (Cost of Goods Sold)
- Tax: `2200` (Tax Payable)

If these codes don't exist (user deleted/archived them), posting throws `INTERNAL_SERVER_ERROR`. All system accounts have `isSystem: true` to prevent deletion via the UI.

### In-memory rate limiter
`createRateLimiter` uses a `Map`. It resets on server restart and is not shared across multiple Next.js instances. For production multi-instance deployments, replace with Redis-backed rate limiting (e.g., `@upstash/ratelimit`).

### File storage
Currently uses local filesystem (`./storage/`). The `s3Key` field in `Attachment` stores a relative path. For production, replace `lib/storage.ts` with S3-backed implementation without changing any calling code.

---

## 22. Known Gaps / Future Work

| Feature | Status | Notes |
|---|---|---|
| AI extraction `extract_document` chat tool | Not implemented | Service exists; chat tool wrapper not wired |
| Chat file attachment in UI | Not implemented | `attachmentId` field exists in API; no upload button in chat panel |
| Chat confirmation step for destructive actions | Not implemented | Tools execute immediately without user confirmation |
| E2E Playwright tests for chat and invoicing | Skeleton only | `auth.spec.ts` + `navigation.spec.ts` minimal |
| AWS S3 for production file storage | Stub only | `lib/s3.ts` exists; `lib/storage.ts` uses local FS |
| Free tier transaction count enforcement | Tracked, not gated | `UsageRecord.transactionCount` is not checked anywhere |
| PDF export for reports | Not implemented | Invoice PDF done; report PDF planned |
| CSV export per report page | Not implemented | Bulk data export via `/api/export` exists |
| Real-time bank feed (Plaid/TrueLayer) | Not planned for v1 | Manual CSV import only |
| Multi-currency support | Not planned for v1 | Single currency per org |
| Team member invitations | Not implemented | Schema supports roles; invite flow not built |
| Recurring invoices | Not planned for v1 | Backlog item BL-10 |
| Cash Flow Statement | Not implemented | `getTrialBalance` exists; Cash Flow not wired |
| Sentry error tracking | Not implemented | Planned for Phase 9 |
| AWS deployment (ECS/RDS) | Not implemented | Docker Compose for local only |
| GDPR data deletion flow | Not implemented | Bulk export exists via `/api/export` |
| WCAG 2.1 AA audit | Not done | Radix primitives provide basic accessibility |
