# AutoAccounts — Implementation Plan

**Version:** 0.1.0  
**Status:** Draft  
**Last Updated:** 2026-05-09  
**Methodology:** Agile sprints (~2 weeks each), spec-driven, vertical slices

---

## Guiding Principles

1. **Spec first, code second** — update REQUIREMENTS.md before implementing any new feature.
2. **Vertical slices** — each sprint delivers a usable, tested slice of functionality end-to-end.
3. **Double-entry integrity first** — the accounting engine is the foundation; never compromise it.
4. **AI-augmented, human-verified** — AI extraction always requires user confirmation before saving.
5. **Iterative refinement** — all three docs (requirements, architecture, this plan) are living documents.

---

## Phase 0 — Project Scaffold (Sprint 0)

**Goal:** Working local development environment with authentication and a shell app. Every subsequent sprint builds on this base.

### Tasks

- [ ] **P0-01** Initialise Next.js 15 project with TypeScript, Tailwind CSS, ESLint, Prettier.
- [ ] **P0-02** Install and configure shadcn/ui component library.
- [ ] **P0-03** Set up Docker Compose (Postgres, Redis, MinIO, Mailhog).
- [ ] **P0-04** Install Prisma, create initial schema (User, Organisation, Account), run first migration.
- [ ] **P0-05** Install and configure tRPC with Next.js App Router.
- [ ] **P0-06** Implement NextAuth.js v5 with email/password and Google OAuth.
- [ ] **P0-07** Build onboarding wizard (business setup, currency, tax regime, fiscal year).
- [ ] **P0-08** Auto-generate default chart of accounts on organisation creation.
- [ ] **P0-09** App shell layout: sidebar navigation, header, responsive breakpoints.
- [ ] **P0-10** Environment configuration: `.env.local` template, validation with Zod at startup.
- [ ] **P0-11** Set up Vitest for unit tests; Playwright for E2E skeleton.

**Definition of Done:** User can register, complete onboarding, and land on a (empty) dashboard.

---

## Phase 1 — Core Accounting Engine (Sprint 1)

**Goal:** Double-entry journal, chart of accounts management, manual transaction entry.

**Requirements covered:** FR-05 to FR-13

### Tasks

- [ ] **P1-01** Prisma schema: `Account`, `JournalEntry`, `JournalLine`, `AuditLog`.
- [ ] **P1-02** `AccountingService` — create journal entry with automatic balance validation (debits = credits or throw).
- [ ] **P1-03** Chart of Accounts UI: list, create, edit, archive accounts.
- [ ] **P1-04** Simplified income transaction form (hides double-entry; posts to income + AR/cash accounts).
- [ ] **P1-05** Simplified expense transaction form (hides double-entry; posts to expense + AP/cash accounts).
- [ ] **P1-06** Transaction list page with filters (date range, category, search).
- [ ] **P1-07** Void transaction (reversal journal entry, original preserved).
- [ ] **P1-08** CSV import for transactions (map columns, preview, confirm).
- [ ] **P1-09** `AuditLog` middleware in Prisma — automatic before/after capture on all mutations.
- [ ] **P1-10** Unit tests: `AccountingService` balance validation, void logic.

**Definition of Done:** User can enter income/expense transactions; chart of accounts is editable; double-entry integrity is enforced and tested.

---

## Phase 2 — Accounts Receivable (Sprint 2) ✅ Complete

**Goal:** Full invoice lifecycle — create, send, receive payment, view AR aging.

**Requirements covered:** FR-14 to FR-18

### Tasks

- [x] **P2-01** Prisma schema: `Contact`, `Invoice`, `InvoiceLine`.
- [x] **P2-02** Customer management UI (CRUD). (`app/(app)/contacts/page.tsx`)
- [x] **P2-03** Invoice create form with line items, tax calculation, totals. (`app/(app)/invoices/new/page.tsx`)
- [x] **P2-04** Invoice PDF generation via @react-pdf/renderer. (`app/api/invoices/[id]/pdf/route.ts`)
- [x] **P2-05** Email invoice to customer via nodemailer (Mailhog dev, Resend prod). (`server/services/email.service.ts`)
- [x] **P2-06** Invoice status state machine (draft → sent → partial/paid → overdue → void). (`server/services/invoice.service.ts`)
- [x] **P2-07** Record payment against invoice (full and partial). (`server/routers/invoices.ts:recordPayment`)
- [x] **P2-08** Invoice posting to journal (debit AR, credit income + tax liability). (`server/services/invoice.service.ts:postInvoiceToLedger`)
- [x] **P2-09** Payment posting to journal (debit cash/bank, credit AR). (`server/services/invoice.service.ts:recordInvoicePayment`)
- [x] **P2-10** AR Aging report (30/60/90/90+ day buckets). (`app/(app)/reports/ar-aging/page.tsx`)
- [x] **P2-11** Invoice list page with status filters. (`app/(app)/invoices/page.tsx`)

**Definition of Done:** ✅ User can raise, send, and mark invoices paid; AR aging shows correct balances.

---

## Phase 3 — Accounts Payable (Sprint 3) ✅ Complete

**Goal:** Bill entry, payment recording, AP aging — mirrors AR.

**Requirements covered:** FR-19 to FR-23

### Tasks

- [x] **P3-01** Prisma schema: `Bill`, `BillLine`.
- [x] **P3-02** Supplier management UI (CRUD, reuse Contact with type=supplier).
- [x] **P3-03** Bill create/edit form (same line-item UX as invoices).
- [x] **P3-04** Bill status state machine.
- [x] **P3-05** Record payment against bill.
- [x] **P3-06** Bill posting to journal (debit expense + tax input, credit AP).
- [x] **P3-07** Payment posting to journal (debit AP, credit cash/bank).
- [x] **P3-08** AP Aging report.
- [x] **P3-09** Bill list page with status filters.

**Definition of Done:** User can record supplier bills and payments; AP aging accurate.

---

## Phase 4 — AI Document Extraction (Sprint 4)

**Goal:** Upload invoice/receipt → AI extracts → pre-fills form → user confirms.

**Requirements covered:** FR-24 to FR-28

### Tasks

- [ ] **P4-01** Prisma schema: `Attachment`, `ExtractionResult`.
- [ ] **P4-02** S3 pre-signed upload URL tRPC endpoint (MinIO locally).
- [ ] **P4-03** File upload UI component (drag-drop, progress, preview).
- [ ] **P4-04** BullMQ `ai-extraction` queue and worker setup.
- [ ] **P4-05** `ExtractionService` — Claude API call with vision + structured JSON prompt.
- [ ] **P4-06** Zod schema for extraction output (all invoice fields + per-field confidence).
- [ ] **P4-07** PDF-to-image conversion for uploaded PDFs (pdf2pic).
- [ ] **P4-08** Store extraction result in DB; SSE or polling endpoint for frontend.
- [ ] **P4-09** Pre-fill invoice/bill/transaction form from extraction result; confidence badge per field.
- [ ] **P4-10** User edits and confirms; record saved normally through existing service layer.
- [ ] **P4-11** Usage tracking for free tier limit (5 extractions/month).
- [ ] **P4-12** Integration test: upload sample PDF → verify extracted fields.

**Definition of Done:** User can upload a receipt/invoice, AI fills the form, user confirms and saves — end to end.

---

## Phase 5 — Bank Reconciliation (Sprint 5)

**Goal:** Manual bank statement import and guided reconciliation workflow.

**Requirements covered:** FR-29 to FR-33

### Tasks

- [ ] **P5-01** Prisma schema: `BankAccount`, `BankStatementLine`, `Reconciliation`.
- [ ] **P5-02** Bank account management UI.
- [ ] **P5-03** CSV bank statement import (map columns: date, description, amount).
- [ ] **P5-04** `ReconciliationService` — auto-match algorithm (amount exact match + date within 5 days + description fuzzy).
- [ ] **P5-05** Reconciliation UI: side-by-side statement lines vs. recorded transactions.
- [ ] **P5-06** User actions: confirm match, unmatch, create new transaction for unmatched line, exclude line.
- [ ] **P5-07** Lock reconciliation for a completed period (immutable once confirmed).
- [ ] **P5-08** Reconciliation summary report.
- [ ] **P5-09** Update bank account running balance on each confirmed match.

**Definition of Done:** User can import a bank statement CSV and work through the reconciliation to zero unmatched lines.

---

## Phase 6 — Financial Reports (Sprint 6)

**Goal:** All core financial reports with export.

**Requirements covered:** FR-35 to FR-43

### Tasks

- [ ] **P6-01** `ReportService` — P&L query (income minus expenses for period, grouped by account).
- [ ] **P6-02** P&L report UI with date range picker, grouped by category.
- [ ] **P6-03** Balance Sheet query (assets, liabilities, equity at date).
- [ ] **P6-04** Balance Sheet report UI.
- [ ] **P6-05** Trial Balance query and UI.
- [ ] **P6-06** Cash Flow Statement (indirect method).
- [ ] **P6-07** Tax Summary report (output tax collected, input tax paid, net payable).
- [ ] **P6-08** AR Aging (already done in P2, surface in reports section).
- [ ] **P6-09** AP Aging (already done in P3, surface in reports section).
- [ ] **P6-10** PDF export for all reports (Puppeteer).
- [ ] **P6-11** CSV export for all reports.
- [ ] **P6-12** Fiscal year and date range awareness in all reports.

**Definition of Done:** All 7 report types render correctly and export to PDF/CSV.

---

## Phase 7 — Dashboard (Sprint 7)

**Goal:** At-a-glance KPI dashboard with charts.

**Requirements covered:** FR-44 to FR-45

### Tasks

- [ ] **P7-01** Dashboard KPI cards: income, expenses, net profit (month + YTD), outstanding AR, outstanding AP, cash position.
- [ ] **P7-02** Income vs. expense trend chart (Recharts, last 12 months bar chart).
- [ ] **P7-03** Expense breakdown by category (pie / donut chart).
- [ ] **P7-04** Recent transactions widget.
- [ ] **P7-05** Outstanding invoices widget (top 5 overdue).
- [ ] **P7-06** Optimise report queries with indexes / summary aggregation for dashboard speed.

**Definition of Done:** Dashboard loads within 2 seconds with realistic dataset; all KPIs accurate.

---

## Phase 8 — Subscription & Billing (Sprint 8)

**Goal:** Stripe subscription tiers, upgrade/downgrade, usage enforcement.

**Requirements covered:** FR-46 to FR-50

### Tasks

- [ ] **P8-01** Stripe product and price setup (free, pro monthly, pro annual).
- [ ] **P8-02** `SubscriptionService` — Stripe checkout session, portal session, webhook handler.
- [ ] **P8-03** Webhook: handle `customer.subscription.updated`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- [ ] **P8-04** Store subscription tier on Organisation; refresh on webhook.
- [ ] **P8-05** Usage gate middleware: enforce transaction limit and AI extraction limit for free tier.
- [ ] **P8-06** Upgrade prompt UI shown when limits are reached.
- [ ] **P8-07** Pricing page (public marketing page).
- [ ] **P8-08** Subscription management UI in settings (current plan, upgrade, cancel, billing portal link).
- [ ] **P8-09** Team member invitations (pro tier): invite by email, role assignment, accept flow.

**Definition of Done:** Free users hit limits and are prompted to upgrade; Stripe checkout works end-to-end in test mode.

---

## Phase 9 — Hardening & Launch Readiness (Sprint 9)

**Goal:** Security audit, performance optimisation, accessibility, documentation.

### Tasks

- [ ] **P9-01** Security review: Zod validation on all inputs, rate limiting on auth + AI endpoints, pre-signed URL expiry.
- [ ] **P9-02** WCAG 2.1 AA audit on all major pages.
- [ ] **P9-03** Database query performance: EXPLAIN ANALYZE on all report queries; add missing indexes.
- [ ] **P9-04** Error boundaries and fallback UI on all pages.
- [ ] **P9-05** Sentry integration for error tracking.
- [ ] **P9-06** Data export endpoint (all user data as ZIP of CSVs/JSONs).
- [ ] **P9-07** GDPR: account deletion flow (scrub PII, retain anonymised accounting records).
- [ ] **P9-08** Email templates: welcome, invoice, bill reminder, payment received, subscription confirmation.
- [ ] **P9-09** End-to-end Playwright tests for critical paths (register → onboard → create invoice → record payment → view P&L).
- [ ] **P9-10** AWS deployment: ECS Fargate + RDS + ElastiCache + S3 setup; CI/CD via GitHub Actions.

---

## Phase 10 — Chat Assistant (Sprint 10)

**Goal:** Conversational AI assistant that can create entries, generate reports, and process uploaded documents via natural language.

**Design Document:** [CHAT_FEATURE.md](./CHAT_FEATURE.md)

### Tasks

- [ ] **P10-01** Prisma schema: `ChatConversation`, `ChatMessage` models + migration.
- [ ] **P10-02** `ChatService` — core service: prompt building, Ollama integration, tool parsing, tool execution.
- [ ] **P10-03** Tool implementations: `create_journal_entry`, `create_invoice`, `create_bill`.
- [ ] **P10-04** Tool implementations: `get_profit_and_loss`, `get_balance_sheet`, `get_trial_balance`.
- [ ] **P10-05** Tool implementations: `list_accounts`, `list_contacts`, `search_transactions`, `get_account_balance`.
- [ ] **P10-06** Tool implementations: `get_ar_aging`, `get_ap_aging`.
- [ ] **P10-07** Tool implementation: `extract_document` — integrate with existing extraction service.
- [ ] **P10-08** tRPC router: `chat.sendMessage`, `chat.getConversation`, `chat.listConversations`, `chat.deleteConversation`.
- [ ] **P10-09** Chat UI: floating panel component with message list, input, file upload button.
- [ ] **P10-10** Chat UI: tool result rendering (tables for reports, confirmation cards for created documents).
- [ ] **P10-11** Chat UI: file attachment preview and upload progress.
- [ ] **P10-12** Unit tests: ChatService tool parsing, prompt building, tool execution.
- [ ] **P10-13** Integration tests: end-to-end chat flows (create invoice via chat, get report via chat).
- [ ] **P10-14** Chat conversation management: conversation list sidebar, create new, delete.

**Definition of Done:** User can open chat panel, create invoices/bills/entries, view reports, and upload receipts — all via natural language conversation.

---

## Backlog (Post-v1)

| ID | Feature | Notes |
|---|---|---|
| BL-01 | Real-time bank feed (Plaid / TrueLayer) | FR-34 |
| BL-02 | Multi-currency support | Deferred by constraint |
| BL-03 | Payroll | Separate module, complex |
| BL-04 | Fixed asset depreciation schedules | Accounting module add-on |
| BL-05 | Inventory management | Separate vertical |
| BL-06 | Mobile native apps | Post-web-launch |
| BL-07 | Public API + webhooks | Business tier feature |
| BL-08 | Multi-company / consolidated accounts | Enterprise tier |
| BL-09 | AI-powered bookkeeping suggestions | "Did you mean to categorise this as X?" |
| BL-10 | Recurring invoice / bill automation | High demand from freelancers |

---

## Sprint Velocity Tracking

| Sprint | Phase | Target | Status |
|---|---|---|---|
| Sprint 0 | Scaffold + Auth | P0-01 to P0-11 | ✅ Complete |
| Sprint 1 | Accounting Engine | P1-01 to P1-10 | ✅ Complete |
| Sprint 2 | AR | P2-01 to P2-11 | ✅ Complete |
| Sprint 3 | AP | P3-01 to P3-09 | ✅ Complete |
| Sprint 4 | AI Extraction | P4-01 to P4-12 | Not started |
| Sprint 5 | Bank Reconciliation | P5-01 to P5-09 | Not started |
| Sprint 6 | Reports | P6-01 to P6-12 | Not started |
| Sprint 7 | Dashboard | P7-01 to P7-06 | Not started |
| Sprint 8 | Subscriptions | P8-01 to P8-09 | Not started |
| Sprint 9 | Hardening | P9-01 to P9-10 | Not started |
| Sprint 10 | Chat Assistant | P10-01 to P10-14 | In Progress |

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-09 | Next.js 15 + tRPC chosen over REST API | End-to-end type safety, single repo, faster iteration |
| 2026-05-09 | Claude API for AI extraction over OpenAI | Best vision + structured JSON output for documents |
| 2026-05-09 | BullMQ for async jobs over serverless functions | Reliable retry, delay, priority; avoids cold starts for AI workloads |
| 2026-05-09 | Multi-currency deferred | Adds significant complexity to reporting and reconciliation; not needed for v1 |
| 2026-05-09 | Bank feed deferred | Plaid/TrueLayer integration requires compliance review; manual import sufficient for v1 |
| 2026-05-10 | Chat assistant uses Ollama tool-calling pattern | Reuses existing Ollama setup; tool calls parsed server-side and delegated to existing services |
| 2026-05-10 | Chat as floating panel, not separate page | Accessible from anywhere in the app without losing context; better UX for quick actions |
