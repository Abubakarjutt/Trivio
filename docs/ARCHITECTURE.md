# AutoAccounts — Architecture Document

**Version:** 0.3.0  
**Status:** Active  
**Last Updated:** 2026-05-17

---

## 1. Recommended Tech Stack

### Rationale

The stack is chosen to maximise developer velocity, type-safety end-to-end, easy local development, and a clear path to AWS deployment without architectural rework.

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Next.js 15 (App Router) | Full-stack React, SSR for fast first load, file-based routing, easy Vercel/ECS deploy |
| **API Layer** | tRPC | End-to-end type safety between frontend and backend, no code-gen step, natural fit with Next.js |
| **Database** | PostgreSQL 16 | ACID transactions essential for double-entry integrity; rich JSON support; battle-tested |
| **ORM** | Prisma | Type-safe queries, schema-as-code, migration tooling, excellent Postgres support |
| **Auth** | NextAuth.js v5 (Auth.js) | OAuth + credentials, session management, easy to self-host on AWS |
| **UI Components** | Tailwind CSS + shadcn/ui | Unstyled accessible components, rapid customisation, no runtime CSS-in-JS overhead |
| **Charts** | Recharts | React-native, composable, well-maintained for financial charts |
| **LLM (AI Extraction)** | Anthropic Claude API (claude-sonnet-4-6) | Best-in-class document understanding, structured JSON output, vision capability for images |
| **File Storage** | AWS S3 (MinIO locally) | Durable object storage; same API locally and in production |
| **Background Jobs** | BullMQ + Redis | Reliable async queue for AI extraction jobs, email sending, report generation |
| **Email** | Resend + React Email | Modern email API, React template authoring, excellent deliverability |
| **Payments** | Stripe | Subscription billing, webhook-driven state, battle-tested |
| **PDF Generation** | Puppeteer (server-side) | Render invoice/report HTML to PDF; consistent with UI styles |
| **Local Dev** | Docker Compose | Single command spins up Postgres, Redis, MinIO |
| **Testing** | Vitest + Playwright | Unit/integration (Vitest), E2E (Playwright) |
| **Deployment** | AWS ECS Fargate + RDS + ElastiCache | Containerised, serverless compute; managed Postgres and Redis |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Browser (Next.js)                            │
│                  React components + tRPC client + Zustand               │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ HTTPS
┌─────────────────────────────▼───────────────────────────────────────────┐
│                     Next.js Server (App Router)                         │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  tRPC Router │  │  Auth.js     │  │  Stripe      │  │  Webhook   │ │
│  │  (API)       │  │  (Sessions)  │  │  Webhooks    │  │  Handlers  │ │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│         │                                                               │
│  ┌──────▼───────────────────────────────────────────────────────────┐  │
│  │                      Service Layer                                │  │
│  │  AccountService │ TransactionService │ InvoiceService │ ...       │  │
│  └──────┬──────────────────────┬────────────────────────────────────┘  │
│         │                      │                                        │
│  ┌──────▼──────┐     ┌─────────▼──────┐                               │
│  │   Prisma    │     │   BullMQ       │                               │
│  │   ORM       │     │   Job Queue    │                               │
│  └──────┬──────┘     └─────────┬──────┘                               │
└─────────┼─────────────────────┼────────────────────────────────────────┘
          │                     │
┌─────────▼──────┐   ┌──────────▼──────────────────────────────────────┐
│  PostgreSQL    │   │              Workers (BullMQ)                    │
│  (RDS locally) │   │  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │
└────────────────┘   │  │ AI Extractor│  │ PDF Gen  │  │ Email     │  │
                     │  │ (Claude API)│  │(Puppeteer│  │ (Resend)  │  │
┌────────────────┐   │  └─────────────┘  └──────────┘  └───────────┘  │
│  Redis         │◄──┤                                                  │
│  (ElastiCache) │   └──────────────────────────────────────────────────┘
└────────────────┘
                     ┌──────────────────┐
                     │  AWS S3 / MinIO  │
                     │  (File Storage)  │
                     └──────────────────┘
```

---

## 3. Domain Model

### 3.1 Core Entities

```
Organisation
  ├── id
  ├── name
  ├── businessType        (sole_trader | partnership | company | other)
  ├── currency            (ISO 4217 code, e.g. "USD", "GBP")
  ├── taxRegime           (FK → TaxRegime)
  ├── fiscalYearStartMonth (1–12)
  └── subscriptionTier    (free | pro | business)

User
  ├── id
  ├── email
  ├── name
  ├── organisationId      (FK → Organisation)
  └── role                (owner | editor | viewer)

Account  (Chart of Accounts entry)
  ├── id
  ├── organisationId
  ├── code                (e.g. "1000")
  ├── name                (e.g. "Cash at Bank")
  ├── type                (asset | liability | equity | income | expense)
  ├── normalBalance       (debit | credit)
  ├── parentId            (FK → Account, for hierarchy)
  └── isArchived

JournalEntry
  ├── id
  ├── organisationId
  ├── date
  ├── reference
  ├── description
  ├── source              (manual | invoice | bill | bank_import | ai_extraction)
  ├── sourceId            (polymorphic FK)
  └── lines[]             (JournalLine[])

JournalLine
  ├── id
  ├── journalEntryId
  ├── accountId
  ├── debit               (Decimal, nullable)
  ├── credit              (Decimal, nullable)
  └── description

Contact  (Customer or Supplier)
  ├── id
  ├── organisationId
  ├── type                (customer | supplier | both)
  ├── name
  ├── email
  ├── address
  └── taxNumber

Invoice  (AR)
  ├── id
  ├── organisationId
  ├── contactId           (customer)
  ├── number
  ├── date
  ├── dueDate
  ├── status              (draft | sent | partial | paid | overdue | void)
  ├── lines[]             (InvoiceLine[])
  ├── taxAmount
  ├── totalAmount
  └── journalEntryId      (created on post)

Bill  (AP — mirrors Invoice)
  └── (same structure as Invoice, contactId = supplier)

BankAccount
  ├── id
  ├── organisationId
  ├── name
  ├── accountId           (FK → Account in CoA)
  └── currentBalance

BankStatementLine
  ├── id
  ├── bankAccountId
  ├── date
  ├── description
  ├── amount
  ├── status              (unmatched | matched | excluded | created)
  └── journalLineId       (FK → JournalLine, when matched)

TaxRegime
  ├── id
  ├── code                (e.g. "UK_VAT", "US_SALES_TAX", "AU_GST")
  ├── name
  ├── country
  └── rates[]             (TaxRate[])

TaxRate
  ├── id
  ├── taxRegimeId
  ├── code                (e.g. "STANDARD", "ZERO", "EXEMPT")
  ├── name
  └── rate                (Decimal, e.g. 0.20 for 20%)

Attachment
  ├── id
  ├── organisationId
  ├── s3Key
  ├── originalFilename
  ├── mimeType
  └── extractionStatus    (pending | processing | done | failed)

AuditLog
  ├── id
  ├── organisationId
  ├── userId
  ├── action              (create | update | void | delete)
  ├── entityType
  ├── entityId
  ├── before              (JSON)
  ├── after               (JSON)
  └── timestamp

ChatConversation
  ├── id
  ├── organisationId
  ├── userId
  ├── title               (auto-set from first message, max 60 chars)
  ├── createdAt
  └── updatedAt

ChatMessage
  ├── id
  ├── conversationId
  ├── role                ("user" | "assistant")
  ├── content             (text; TOOL_CALL lines stripped before storing)
  ├── toolCalls           (JSON — raw tool calls for audit)
  ├── toolResults         (JSON — execution results for audit)
  ├── attachmentId        (optional FK → Attachment)
  └── createdAt

Budget                    (EasyFinance module)
  ├── id
  ├── organisationId
  ├── name
  ├── category            (partial match against expense account names)
  ├── limitAmount         (NUMERIC 19,4)
  ├── period              (WEEKLY | MONTHLY | QUARTERLY | YEARLY)
  ├── isArchived
  ├── createdAt
  └── updatedAt

Goal                      (EasyFinance module)
  ├── id
  ├── organisationId
  ├── name
  ├── description
  ├── targetAmount        (NUMERIC 19,4)
  ├── currentAmount       (NUMERIC 19,4)
  ├── targetDate
  ├── status              (ACTIVE | COMPLETED | CANCELLED)
  ├── createdAt
  └── updatedAt

RecurringItem             (EasyFinance module)
  ├── id
  ├── organisationId
  ├── name
  ├── description
  ├── amount              (NUMERIC 19,4)
  ├── type                (INCOME | EXPENSE)
  ├── frequency           (DAILY | WEEKLY | FORTNIGHTLY | MONTHLY | QUARTERLY | YEARLY)
  ├── category
  ├── nextDueDate
  ├── lastPaidAt
  ├── isActive
  ├── createdAt
  └── updatedAt

Watchlist                 (EasyFinance module)
  ├── id
  ├── organisationId
  ├── name
  ├── category            (partial match against expense account names)
  ├── threshold           (NUMERIC 19,4)
  ├── period              (WEEKLY | MONTHLY | QUARTERLY | YEARLY)
  ├── isActive
  ├── createdAt
  └── updatedAt
```

---

## 4. Application Layers

### 4.1 Presentation Layer (Next.js App Router)

- **`/app/(marketing)`** — Public marketing pages, pricing, login, signup.
- **`/app/(app)`** — Authenticated app shell with sidebar navigation.
  - `/dashboard` — KPI overview
  - `/transactions` — Transaction list + entry form
  - `/invoices` — AR invoice list + create/edit
  - `/bills` — AP bill list + create/edit
  - `/contacts` — Customers & suppliers
  - `/accounts` — Chart of accounts
  - `/bank` — Bank accounts + reconciliation
  - `/reports` — Financial reports
  - `/settings` — Organisation, users, subscription, tax
  - **Personal Finance (EasyFinance module)**
    - `/budgets` — Spending limits by category with utilization bars
    - `/goals` — Savings targets with progress tracking and contributions
    - `/recurring` — Regular income/expense tracker with due-date advancement
    - `/watchlists` — Threshold alerts on category spend with breach detection

### 4.2 API Layer (tRPC Routers)

Each domain has its own tRPC router, composed under the root `appRouter`:

```
appRouter
  ├── auth           login, logout, session
  ├── org            create, update, getSetup
  ├── accounts       list, create, update, archive
  ├── transactions   list, create, update, void, importCSV
  ├── contacts       list, create, update
  ├── invoices       list, create, update, send, recordPayment, void
  ├── bills          list, create, update, recordPayment, void
  ├── bank           listAccounts, createAccount, importStatement, reconcile
  ├── reports        pnl, balanceSheet, cashFlow, taxSummary, trialBalance, arAging, apAging
  ├── attachments    uploadUrl, confirmUpload, getExtractionResult
  ├── chat           getConversation, listConversations, deleteConversation
  ├── subscription   currentPlan, createCheckoutSession, portal
  ├── budgets        list, create, update, archive, delete        ← EasyFinance
  ├── goals          list, create, update, contribute, delete     ← EasyFinance
  ├── recurringItems list, create, update, markPaid, summary, delete  ← EasyFinance
  └── watchlists     list, create, update, delete                 ← EasyFinance
```

**Note:** Chat message sending uses a dedicated SSE route (`POST /api/chat`) rather than a tRPC mutation. This avoids the 30-second timeout on serverless functions and enables real-time token streaming to the UI.

### 4.3 Service Layer

Services contain business logic and are called by tRPC routers:

- **`AccountingService`** — double-entry journal creation, balance calculation, trial balance.
- **`InvoiceService`** — invoice lifecycle, journal posting, PDF generation.
- **`BillService`** — mirrors InvoiceService for AP.
- **`ReconciliationService`** — matching algorithm, locking logic.
- **`ReportService`** — aggregation queries for each financial report.
- **`ExtractionService`** — Claude API calls, result parsing, confidence scoring.
- **`ChatService`** (`server/services/chat.service.ts`) — system prompt construction (org context + tool definitions + UI guide), tool call parsing, tool dispatch to 25 tool functions; called by the `/api/chat` SSE route.
- **`SubscriptionService`** — Stripe integration, tier enforcement (usage gates).
- **`TaxService`** — pluggable tax regime resolver, rate lookup, tax line calculation.
- **`EasyFinanceService`** (`server/services/easyfinance.service.ts`) — pure business logic helpers for the Personal Finance module: `periodFrom`, `getSpentForCategory`, `calcBudgetUtilization`, `calcGoalProgress`, `isGoalComplete`, `nextDueDateAfter`, `normalisedMonthly`, `calcRecurringSummary`, `calcDueStatus`, `calcWatchlistStatus`. All functions are side-effect-free and fully unit-tested.

### 4.4 Data Layer (Prisma + PostgreSQL)

- All monetary values stored as `Decimal` (PostgreSQL `NUMERIC(19,4)`).
- Row-level security (RLS) via `organisationId` on every table.
- All timestamps in UTC.
- Soft-delete via `isArchived` / `status = void`; hard deletes only for draft records.

### 4.5 Background Workers (BullMQ)

| Queue | Jobs |
|---|---|
| `ai-extraction` | `extractDocument` — calls Claude API with uploaded file |
| `pdf` | `generateInvoicePdf`, `generateReportPdf` |
| `email` | `sendInvoiceEmail`, `sendBillReminder`, `sendWelcomeEmail` |
| `reconciliation` | `autoMatchStatementLines` |

---

## 5. AI Extraction Architecture

```
User uploads file
       │
       ▼
S3 / MinIO (raw storage)
       │
       ▼
BullMQ: ai-extraction queue
       │
       ▼
Worker: ExtractionService.extract()
  1. Fetch file from S3
  2. If PDF → convert first page to image (sharp / pdf2pic)
  3. Send to Claude API:
     - System prompt: structured extraction instructions + JSON schema
     - User message: base64 image + "Extract all invoice fields"
  4. Parse JSON response → validate against Zod schema
  5. Store ExtractionResult in DB (with confidence flags)
  6. Notify frontend via polling endpoint or SSE
       │
       ▼
User reviews pre-filled form → confirms → saved as Transaction/Bill/Invoice
```

**Claude prompt strategy:** Use structured output with a strict JSON schema defining all fields. Include a `confidence` enum per field (`high | medium | low`) to drive UI indicators. Fall back gracefully if a field is not found.

---

## 6. Tax Regime System

Tax regimes are implemented as a pluggable strategy pattern:

```typescript
interface TaxRegimeStrategy {
  code: string;
  name: string;
  country: string;
  rates: TaxRate[];
  calculateTax(lineTotal: Decimal, rateCode: string): Decimal;
  formatTaxLine(invoice: Invoice): TaxLine;
  generateTaxSummary(period: DateRange, orgId: string): TaxSummary;
}
```

Built-in regimes (v1): `UK_VAT`, `US_SALES_TAX`, `AU_GST`, `EU_VAT`, `IN_GST`, `NONE`.

New regimes can be added by implementing the interface and registering in the regime registry — no core changes required.

---

## 7. Security Architecture

- **Authentication**: JWT sessions via NextAuth.js; refresh token rotation.
- **Authorisation**: Organisation-scoped middleware on every tRPC procedure validates `organisationId` matches session.
- **Data isolation**: `organisationId` in every WHERE clause; Prisma middleware enforces this automatically.
- **File uploads**: Pre-signed S3 URLs (client uploads directly to S3, never through app server).
- **Secrets**: Environment variables; AWS Secrets Manager in production.
- **Rate limiting**: Redis-backed rate limiter on auth endpoints and AI extraction endpoints.
- **Input validation**: Zod schemas on all tRPC inputs.
- **Audit log**: Every mutation writes to `AuditLog` table — immutable append-only record.

---

## 8. Local Development Setup

```
docker-compose.yml
  services:
    postgres:   postgres:16-alpine   → port 5432
    redis:      redis:7-alpine       → port 6379
    minio:      minio/minio          → port 9000 (S3-compatible)
    mailhog:    mailhog/mailhog      → port 8025 (email UI)
```

`.env.local` supplies:
- `DATABASE_URL`
- `REDIS_URL`
- `AWS_S3_ENDPOINT` (MinIO)
- `ANTHROPIC_API_KEY`
- `NEXTAUTH_SECRET`
- `STRIPE_SECRET_KEY` (Stripe test keys)

---

## 9. AWS Deployment Architecture

```
Route 53 → CloudFront → ALB
                          │
                    ECS Fargate (Next.js containers, auto-scaled)
                          │
                ┌─────────┴──────────┐
             RDS PostgreSQL      ElastiCache Redis
             (Multi-AZ)          (cluster mode)
                          │
                       S3 Buckets
                       (attachments, exports)
                          │
                   SES (email) / Resend
```

- **CI/CD**: GitHub Actions → ECR → ECS rolling deploy.
- **Secrets**: AWS Secrets Manager, injected as env vars at runtime.
- **Monitoring**: CloudWatch + Sentry for error tracking.

---

## 10. Scalability Considerations

- Stateless Next.js containers scale horizontally behind ALB.
- BullMQ workers run as separate ECS tasks, independently scalable.
- Report queries use materialised views or pre-aggregated summary tables for large datasets.
- Database connection pooling via PgBouncer (added at scale).
- CDN (CloudFront) caches static assets and marketing pages.
