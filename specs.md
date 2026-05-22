# AutoAccounts Specifications

Last updated: 2026-05-14

Purpose: product and technical specifications for the AutoAccounts SaaS accounting application. This document captures what is already implemented in the repository and defines best-practice target specs for a production-grade SaaS app in this category.

This is an engineering specification, not legal, tax, accounting, or audit advice. Before production launch, validate tax, accounting, privacy, and compliance details with qualified specialists in the target markets.

## 1. Product Scope

AutoAccounts is a multi-tenant SaaS accounting app for freelancers, solopreneurs, consultants, and small businesses. It provides user-friendly workflows for invoices, bills, expenses, payments, bank reconciliation, reporting, document extraction, and conversational assistance while maintaining double-entry bookkeeping integrity behind the scenes.

Primary users:

- Owner: manages organisation setup, billing, accounting data, and exports.
- Editor: creates and updates operational accounting records.
- Viewer: reads records and reports without mutating accounting state.

Primary value:

- Make accounting approachable for non-accountants.
- Preserve an auditable, balanced ledger.
- Reduce manual entry through imports, AI extraction, and chat assistance.
- Provide trustworthy reports and exports for business decisions and tax/accountant workflows.

## 2. Implemented Specifications

This section is based on the current repository structure, Prisma schema, tRPC routers, route handlers, pages, and tests.

### 2.1 Foundation And App Shell

Status: Implemented

Specs:

- The app uses Next.js 15 App Router with TypeScript and React 19.
- The authenticated app lives under `app/(app)` with dashboard, accounts, transactions, invoices, bills, contacts, extraction, reconciliation, reports, and settings routes.
- The public/auth surfaces include login, register, onboarding, marketing pricing, auth API routes, and Stripe webhook route.
- Shared UI uses Tailwind CSS, shadcn/ui/Radix primitives, and lucide-react.
- tRPC is the primary typed API layer.
- Prisma is the data access layer for PostgreSQL.

Evidence:

- `package.json`
- `app/(app)/*`
- `server/root.ts`
- `prisma/schema.prisma`

### 2.2 Authentication And Organisation Setup

Status: Implemented

Specs:

- Users can register through the `auth.register` tRPC mutation.
- Auth uses NextAuth/Auth.js with Prisma adapter tables for accounts, sessions, and verification tokens.
- Users are attached to an optional organisation.
- Onboarding creates or updates organisation context and stores business type, currency, tax regime, fiscal year start month, and onboarding completion state.
- Supported user roles are `OWNER`, `EDITOR`, and `VIEWER`.

API surface:

- `auth.register`
- `auth.me`
- `org.getCurrencies`
- `org.getTaxRegimes`
- `org.setupStep1`
- `org.setupStep2`
- `org.get`
- `org.update`

Data models:

- `User`
- `Organisation`
- `Account`
- `Session`
- `VerificationToken`
- `TaxRegime`
- `TaxRate`

### 2.3 Multi-Tenancy And Authorisation

Status: Implemented pattern, production hardening recommended

Specs:

- Organisation-aware tRPC procedures use server-side session context to resolve `organisationId`.
- Tenant-owned tables are scoped by `organisationId` directly or through parent ownership.
- Most domain queries filter by `ctx.organisationId`.
- Attachment file access verifies ownership before reading file content.

Best-practice gap:

- Database row-level security is not currently visible in the Prisma schema/migrations.
- Cross-tenant denial tests should be expanded for every high-risk route and direct file endpoint.
- Client input should never be allowed to override `organisationId`; this remains a standing invariant.

Data models with direct organisation ownership:

- `ChartAccount`
- `JournalEntry`
- `Contact`
- `Invoice`
- `Bill`
- `BankAccount`
- `Attachment`
- `AuditLog`
- `ChatConversation`
- `UsageRecord`

### 2.4 Chart Of Accounts

Status: Implemented

Specs:

- Organisations have a customizable chart of accounts.
- Accounts include code, name, type, normal balance, parent hierarchy, archive flag, system flag, and sort order.
- Account codes are unique per organisation.
- System accounts are protected from unsafe deletion/archiving behavior by service/router logic.
- Account balances can be retrieved as of a date.

API surface:

- `accounts.list`
- `accounts.listFlat`
- `accounts.create`
- `accounts.update`
- `accounts.archive`
- `accounts.getBalances`

Data model:

- `ChartAccount`

### 2.5 Double-Entry Ledger And Transactions

Status: Implemented

Specs:

- Journal entries are stored with one or more journal lines.
- Monetary line values are stored as `Decimal(19,4)`.
- Journal creation is centralized in `AccountingService`.
- `AccountingService` validates that total debits equal total credits.
- Manual income and expense flows hide debit/credit mechanics from the user.
- Raw journal entry creation exists for advanced/manual use.
- Posted entries are voided with reversal logic, not hard-deleted.
- Transaction list supports search/filter style inputs.
- CSV transaction import creates ledger entries through transaction logic.

API surface:

- `transactions.list`
- `transactions.createIncome`
- `transactions.createExpense`
- `transactions.createRaw`
- `transactions.void`
- `transactions.importCSV`
- `transactions.getById`

Services:

- `AccountingService`
- `AuditService`

Data models:

- `JournalEntry`
- `JournalLine`

Tests:

- `tests/unit/accounting.test.ts`

### 2.6 Contacts

Status: Implemented

Specs:

- Contacts are organisation-scoped.
- Contacts can be customers, suppliers, or both.
- Contacts include name, email, phone, address, tax number, and archive status.
- Contact mutations write audit logs.

API surface:

- `contacts.list`
- `contacts.getById`
- `contacts.create`
- `contacts.update`
- `contacts.archive`

Data model:

- `Contact`

### 2.7 Accounts Receivable: Invoices

Status: Implemented

Specs:

- Invoices are organisation-scoped and linked to customer contacts.
- Invoice numbers are unique per organisation.
- Invoices include date, due date, status, subtotal, tax amount, total amount, amount paid, notes, journal link, and line items.
- Invoice lines include quantity, unit price, amount, tax regime, tax rate code, tax amount, and sort order.
- Invoices can be created, updated, sent, paid partially or fully, voided, listed, and retrieved.
- Sending an invoice can post it to the ledger and send email/PDF behavior through service logic.
- Invoice payment posting creates appropriate AR/cash ledger entries.
- AR aging report is implemented.
- PDF data and PDF route are implemented for invoice rendering/download.

API surface:

- `invoices.list`
- `invoices.getById`
- `invoices.create`
- `invoices.update`
- `invoices.send`
- `invoices.recordPayment`
- `invoices.void`
- `invoices.arAging`
- `invoices.getPdfData`
- `GET /api/invoices/[id]/pdf`

Services:

- `InvoiceService`
- `EmailService`
- `invoice-pdf`

Data models:

- `Invoice`
- `InvoiceLine`

### 2.8 Accounts Payable: Bills

Status: Implemented

Specs:

- Bills are organisation-scoped and linked to supplier contacts.
- Bills include date, due date, status, subtotal, tax amount, total amount, amount paid, notes, journal link, and line items.
- Bill lines mirror invoice line structure.
- Bills can be created, updated, approved, paid partially or fully, voided, listed, and retrieved.
- Bill approval posts AP, expense, and tax entries to the ledger.
- Bill payment posting creates appropriate AP/cash ledger entries.
- AP aging report is implemented.

API surface:

- `bills.list`
- `bills.getById`
- `bills.create`
- `bills.update`
- `bills.approve`
- `bills.recordPayment`
- `bills.void`
- `bills.apAging`

Services:

- `BillService`

Data models:

- `Bill`
- `BillLine`

### 2.9 Bank Accounts And Reconciliation

Status: Implemented

Specs:

- Organisations can create bank accounts linked to chart-of-accounts cash/bank accounts.
- Bank statement lines can be imported with date, description, and amount.
- Statement line statuses include unmatched, matched, excluded, and created.
- Auto-match attempts to match statement lines to journal lines.
- Users can manually match, unmatch, exclude, restore, or create a journal entry from a bank statement line.
- Reconciliation summary and unmatched journal line retrieval are implemented.

API surface:

- `bankAccounts.list`
- `bankAccounts.create`
- `bankAccounts.getById`
- `bankAccounts.importStatementLines`
- `bankAccounts.getStatementLines`
- `bankAccounts.autoMatch`
- `bankAccounts.matchLine`
- `bankAccounts.unmatchLine`
- `bankAccounts.excludeLine`
- `bankAccounts.restoreLine`
- `bankAccounts.createJournalForLine`
- `bankAccounts.getReconciliationSummary`
- `bankAccounts.getUnmatchedJournalLines`

Services:

- `ReconciliationService`

Data models:

- `BankAccount`
- `BankStatementLine`

Tests:

- `tests/unit/reconciliation.service.test.ts`

### 2.10 Financial Reports And Dashboard

Status: Implemented

Specs:

- Reports are organisation-scoped.
- Profit and Loss supports date range.
- Balance Sheet supports as-of date.
- Trial Balance supports date range.
- Tax Summary supports date range.
- AR and AP aging reports are exposed through invoice/bill routers and report pages.
- Dashboard exposes KPIs, income/expense trend, expense breakdown, recent transactions, and outstanding invoices.

API surface:

- `reports.profitAndLoss`
- `reports.balanceSheet`
- `reports.trialBalance`
- `reports.taxSummary`
- `dashboard.getKPIs`
- `dashboard.getIncomeExpenseTrend`
- `dashboard.getExpenseBreakdown`
- `dashboard.getRecentTransactions`
- `dashboard.getOutstandingInvoices`

Services:

- `ReportService`

Tests:

- `tests/unit/report.service.test.ts`

### 2.11 Attachments And AI Extraction

Status: Implemented

Specs:

- Authenticated users can upload files to the attachment endpoint.
- Uploads are organisation-scoped.
- Upload accepts JPEG, PNG, WebP, and PDF.
- Upload size limit is 10 MB.
- File bytes are stored through `lib/storage`, which is the current local development storage adapter.
- Attachment DB rows include filename, MIME type, size, storage key, extraction status, and optional extraction result.
- Upload enqueues an `ai-extraction` BullMQ job.
- Attachment status can be queried.
- Attachments can be listed for invoices or bills, linked to invoices or bills, deleted, and downloaded after ownership checks.

API surface:

- `POST /api/attachments/upload`
- `GET /api/attachments/[id]/file`
- `attachments.getStatus`
- `attachments.listForInvoice`
- `attachments.listForBill`
- `attachments.delete`
- `attachments.linkToInvoice`
- `attachments.linkToBill`

Services/queues:

- `ExtractionService`
- `extractionQueue`
- `extraction.worker.ts`

Data model:

- `Attachment`

Best-practice gap:

- Production should use S3-compatible object storage, such as AWS S3 or a MinIO-compatible deployment, and add malware scanning, deeper file signature validation, storage encryption review, and stricter retention rules.

### 2.12 Subscription Billing And Usage

Status: Implemented

Specs:

- Organisations track subscription tier, Stripe customer id, and Stripe subscription id.
- Subscription status can be retrieved.
- Checkout sessions can be created.
- Billing portal sessions can be created.
- Stripe webhooks verify signatures using the raw request body.
- Webhook route delegates to subscription service event handling.
- Usage records track monthly transaction and AI extraction counts.
- Free-tier usage checks exist for extraction/subscription limits.

API surface:

- `subscription.getStatus`
- `subscription.createCheckoutSession`
- `subscription.createPortalSession`
- `POST /api/webhooks/stripe`

Services:

- `SubscriptionService`
- `usageGate`

Data models:

- `UsageRecord`
- `Organisation.stripeCustomerId`
- `Organisation.stripeSubscriptionId`

Tests:

- `tests/unit/subscription.service.test.ts`
- `tests/unit/usageGate.test.ts`

Best-practice gap:

- Store processed Stripe event ids to make webhook handling idempotent.
- Do not return success for recoverable webhook processing failures unless the event is durably stored for retry.

### 2.13 Chat Assistant

Status: Implemented/in progress

Specs:

- Chat conversations and messages are organisation-scoped.
- Users can send messages through tRPC.
- Conversations can be listed, retrieved, and deleted.
- Chat can call accounting/reporting/contact/search tools through `ChatService`.
- Chat is allowed to post accounting records when the user clearly asks it to.
- Chat messages can store tool calls, tool results, and optional attachment references.
- Chat feature design targets a floating panel available across the app.

API surface:

- `chat.sendMessage`
- `chat.getConversation`
- `chat.listConversations`
- `chat.deleteConversation`
- `POST /api/chat`

Services:

- `ChatService`

Data models:

- `ChatConversation`
- `ChatMessage`

Tests:

- `tests/unit/chat.service.test.ts`
- `tests/unit/chat.tools.test.ts`

Best-practice gap:

- Chat-posted records should go through the same validated service layer, tenant checks, role checks, audit logs, usage limits, and accounting invariants as normal UI-created records.
- Explicit confirmation is still required for sending invoices/emails, exporting sensitive data, changing billing state, deletion/pseudonymization, and ambiguous or destructive accounting actions.
- Prompt-injection and excessive-agency tests should be expanded.

### 2.14 Data Export

Status: Implemented

Specs:

- Authenticated users can export organisation data as a ZIP file.
- Export includes CSVs for invoices, bills, contacts, and journal entries.
- Export is scoped to the authenticated user's organisation.
- Export route uses JSZip and server-side CSV serialization.

API surface:

- `GET /api/export`

Best-practice gap:

- Expand export to include accounts, bank accounts, statement lines, attachments metadata, audit logs, and tax regimes where appropriate.
- Add export audit logs and larger dataset streaming/backpressure for production.

### 2.15 Testing

Status: Implemented baseline

Specs:

- Unit/integration tests use Vitest.
- E2E skeleton uses Playwright.
- Existing unit tests cover accounting, reconciliation, report service, chat service/tools, usage gates, rate limiting, and subscription service.
- Existing E2E tests cover auth and navigation.

Test files:

- `tests/unit/accounting.test.ts`
- `tests/unit/reconciliation.service.test.ts`
- `tests/unit/report.service.test.ts`
- `tests/unit/chat.service.test.ts`
- `tests/unit/chat.tools.test.ts`
- `tests/unit/usageGate.test.ts`
- `tests/unit/rateLimit.test.ts`
- `tests/unit/subscription.service.test.ts`
- `tests/e2e/auth.spec.ts`
- `tests/e2e/navigation.spec.ts`

## 3. Production Target Specifications

These specs combine the implemented product direction with researched best practices for SaaS, accounting software, payments, security, privacy, AI, and accessibility.

### 3.1 Accounting Integrity Spec

Requirement:

- All posted accounting events must be balanced, traceable, immutable by default, and reversible through explicit accounting corrections.

Acceptance criteria:

- Journal creation rejects unbalanced entries.
- All invoice, bill, payment, transaction import, bank-created transaction, AI-created transaction, and chat-created transaction flows use the same ledger service.
- Chat-created records are permitted to post immediately when the user's intent is clear, provided the chat tool uses the normal service-layer posting path.
- Posted records cannot be silently edited in ways that alter historical reports without audit trail.
- Voiding creates or links a reversal journal entry.
- Reports exclude or display voided entries consistently according to report type.
- Trial balance always totals to zero net imbalance for non-void posted entries.
- Report drill-down can trace balances to journal lines and source documents.

### 3.2 Money And Tax Precision Spec

Requirement:

- Financial calculations must use decimal arithmetic and deterministic rounding rules.

Acceptance criteria:

- No JavaScript `number` arithmetic for money totals in services.
- Store money as `NUMERIC(19,4)` or Prisma `Decimal`.
- Store tax rates separately from computed tax amounts.
- Define rounding behavior for line-level tax, invoice-level tax, payment allocations, and report presentation.
- Persist computed posted values rather than recalculating historical invoices from mutable tax rules.

### 3.3 Tenant Isolation Spec

Requirement:

- Users must never access, infer, mutate, export, download, or trigger jobs against another organisation's data.

Acceptance criteria:

- `organisationId` is resolved server-side from session context.
- Every tenant-owned query filters by organisation directly or through a verified parent.
- Every id-based API path includes ownership checks.
- File downloads check attachment ownership before reading storage.
- Background jobs include `organisationId` and re-check ownership before processing.
- Cross-tenant tests exist for all routers and file routes.
- Production architecture evaluates database row-level security or equivalent defense-in-depth controls.

### 3.4 Security Spec

Requirement:

- Security design follows OWASP Top 10, OWASP API Security Top 10, OWASP ASVS, CISA Secure by Design, and NIST CSF principles.

Acceptance criteria:

- All inputs are validated with Zod or equivalent schemas.
- Authenticated procedures use default-deny authorization.
- Role permissions are enforced consistently across UI and server.
- Rate limits protect auth, upload, extraction, chat, report/export, and billing endpoints.
- Security headers are configured before production.
- Secrets are stored only in environment/secret manager.
- Logs never include passwords, tokens, full financial documents, raw card data, or sensitive prompt payloads.
- Dependency scanning and lockfile checks run in CI.
- Production has error monitoring, structured logs, and alerting.

### 3.5 API Spec

Requirement:

- APIs are typed, validated, tenant-safe, and predictable under retries.

Acceptance criteria:

- tRPC inputs and outputs are schema-validated where practical.
- Command operations are separated from report/query operations.
- Mutating operations return stable ids and status.
- Retried operations are idempotent where external systems or network retries are expected.
- Pagination exists for growing lists: transactions, invoices, bills, contacts, attachments, chat messages, audit logs, and statement lines.
- Date filters use explicit date-only semantics for accounting dates.
- Errors use consistent user-safe messages and developer-safe logs.

### 3.6 Stripe Billing Spec

Requirement:

- Billing and entitlement state must be driven by Stripe-verified events and resilient to retries, delays, and partial failures.

Acceptance criteria:

- Webhook signature verification is mandatory.
- Processed event ids are persisted.
- Webhook handlers are idempotent.
- Recoverable failures are retried from a durable event record or surfaced in an admin retry queue.
- Entitlements are computed from stored subscription state, not client redirects.
- Checkout, portal, subscription update, cancellation, invoice paid, and payment failed flows are handled.
- Card data is never stored by AutoAccounts.
- Billing actions are audited.

### 3.7 File And Document Extraction Spec

Requirement:

- File handling must protect tenant data, system resources, and downstream AI workflows.

Acceptance criteria:

- Allowed MIME types and max file size are enforced.
- File signatures are checked, not only browser-provided MIME type.
- Production uploads are malware-scanned or quarantined before extraction.
- Local development may use filesystem storage through `lib/storage`; production must use S3-compatible object storage.
- Storage keys or local paths are tenant-scoped and unguessable.
- Download routes perform ownership checks.
- Extraction jobs are idempotent by attachment id.
- Extraction results are schema-validated and require user confirmation before creating accounting records.
- Low-confidence fields are visually identified and easy to correct.

### 3.8 AI And Chat Spec

Requirement:

- AI must assist users without bypassing accounting, authorization, privacy, or safety controls. Chat may post records on clear user instruction, but it must behave as a normal command surface over trusted services.

Acceptance criteria:

- LLM output is treated as untrusted.
- Tool calls are restricted to a server-owned allowlist.
- Tool arguments are validated and mapped to server-owned ids.
- Chat-posted journals, invoices, bills, and payments use the same service-layer validation, tenant isolation, role checks, audit logging, usage limits, and accounting invariants as UI-created records.
- Explicit confirmation is required before sending invoices/emails, exporting sensitive data, changing billing, deleting/pseudonymizing data, or executing ambiguous/destructive accounting actions.
- AI-created records are auditable and traceable to the user instruction or confirmation that caused them.
- Prompt-injection attempts in documents, bank descriptions, invoice notes, and chat messages are tested.
- AI does not receive unnecessary ledger history, secrets, cross-tenant data, or raw credentials.
- Usage limits apply to chat and extraction.

### 3.9 Audit Trail Spec

Requirement:

- Every material mutation must be attributable, timestamped, tenant-scoped, and reviewable.

Acceptance criteria:

- Audit log records actor, organisation, action, entity type, entity id, before/after where safe, and timestamp.
- Audit logs cover accounting records, contacts, organisation settings, billing state, imports, exports, attachments, AI confirmations, and reconciliation changes.
- Audit logs are append-only from the application perspective.
- Audit entries avoid storing secrets or full document contents.
- Admin/accountant-facing audit views can filter by entity, actor, date, and action.

### 3.10 Data Export And Retention Spec

Requirement:

- Users can export their data, and the product has a defensible retention/deletion model.

Acceptance criteria:

- Export includes ledger, accounts, contacts, invoices, bills, payments, bank accounts, statement lines, attachments metadata, tax rates/regimes, and audit logs where appropriate.
- Export formats are documented and stable.
- Large exports use background jobs or streaming.
- Export requests are audited.
- GDPR deletion separates PII erasure/pseudonymization from legitimate financial record retention.
- Retention policies are documented per deployment/market.

### 3.11 Reporting Spec

Requirement:

- Reports must be accurate, explainable, date-aware, and performant for target datasets.

Acceptance criteria:

- P&L, Balance Sheet, Trial Balance, Tax Summary, AR Aging, and AP Aging have known-ledger tests.
- Reports honor organisation currency, fiscal year, accounting date filters, voided entries, and posted state.
- Report totals drill down to source journal lines.
- Dashboard KPIs disclose period and calculation basis.
- Report pages load within target performance budgets for realistic datasets.
- Exported report values match on-screen values.

### 3.12 Accessibility And UX Spec

Requirement:

- Core workflows meet WCAG 2.2 AA targets and are understandable to non-accountants.

Acceptance criteria:

- Every icon-only button has an accessible name.
- Forms use labels, field-level errors, and error summaries for complex workflows.
- Keyboard users can complete onboarding, invoices, bills, transactions, uploads, reconciliation, reports, chat, and billing.
- Status is not conveyed by color alone.
- Charts include accessible summaries or table alternatives.
- Loading, upload, extraction, chat, and long-running job states are announced.
- User-facing copy uses business terms, not accounting jargon unless in advanced/details views.

### 3.13 Reliability And Operations Spec

Requirement:

- The app should be recoverable, observable, and safe under retries or partial outages.

Acceptance criteria:

- Database backups and restore drills exist before production.
- Background queues expose failure counts and retry status.
- External service failures degrade gracefully with user-visible retry paths.
- Critical jobs are idempotent.
- Production logs are structured and correlated by request/job id.
- Error monitoring is configured.
- Health checks cover app, database, Redis, storage, and worker dependencies.

### 3.14 Compliance Readiness Spec

Requirement:

- The app should be designed so SOC 2-style controls can be evidenced later without rewriting architecture.

Acceptance criteria:

- Access reviews, change management, incident response, backup evidence, vulnerability remediation, vendor inventory, and production deploy history are documented.
- Processing integrity evidence includes tests for ledger correctness, report correctness, webhook idempotency, and cross-tenant authorization.
- Confidentiality evidence includes encryption, access control, logging discipline, retention rules, and vendor reviews.
- Availability evidence includes monitoring, backup/restore checks, and incident runbooks.

## 4. Prioritized Gap List

These are not blockers for local development, but they should be addressed before handling real customer financial data.

- Add persisted Stripe webhook event idempotency and retry handling.
- Add cross-tenant authorization tests across every router and file/export endpoint.
- Resolve the Claude/Ollama documentation mismatch.
- Add role-based authorization checks beyond organisation membership.
- Add database-level tenant isolation review, ideally PostgreSQL RLS for production.
- Keep local filesystem storage as a development adapter, but implement S3-compatible object storage before production.
- Add malware scanning or quarantine for uploaded files.
- Add file signature validation.
- Expand export coverage and audit export events.
- Expand audit logging to all material mutations.
- Add pagination for growing list APIs.
- Add prompt-injection and excessive-agency tests for chat and extraction.
- Add report drill-down and known-ledger fixtures for all reports.
- Add security headers and production logging/monitoring.
- Add accessibility test coverage for core workflows.

## 5. Research Sources

Primary and authoritative sources consulted on 2026-05-14:

- IRS Publication 583, "Starting a Business and Keeping Records": https://www.irs.gov/publications/p583
- OWASP Top 10 2021: https://owasp.org/Top10/
- OWASP API Security Top 10 2023: https://owasp.org/www-project-api-security/
- OWASP Application Security Verification Standard overview: https://devguide.owasp.org/en/03-requirements/05-asvs/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP Top 10 for Large Language Model Applications 2025: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- AWS SaaS tenant isolation strategies: https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html
- Microsoft Azure Architecture Center, multitenant SaaS: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview
- Google Cloud, SaaS architecture: https://cloud.google.com/architecture/saas
- The Twelve-Factor App: https://12factor.net/
- NIST Cybersecurity Framework 2.0: https://www.nist.gov/cyberframework
- NIST AI Risk Management Framework: https://www.nist.gov/itl/ai-risk-management-framework
- CISA Secure by Design: https://www.cisa.gov/securebydesign
- AICPA SOC 2 overview: https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2
- GDPR Article 25, data protection by design and by default: https://gdpr-info.eu/art-25-gdpr/
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe subscription webhooks: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe PCI compliance guide: https://stripe.com/guides/pci-compliance
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- GOV.UK Design System, validation: https://design-system.service.gov.uk/patterns/validation/
- GOV.UK Design System, error messages: https://design-system.service.gov.uk/components/error-message/
