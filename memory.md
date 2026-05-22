# AutoAccounts Memory

Last updated: 2026-05-14

Purpose: durable project memory for AutoAccounts. Use this file to keep product, architecture, accounting, security, compliance, AI, and UX decisions aligned as the codebase grows.

This document is a practical engineering guide, not legal, tax, audit, or accounting advice. For production launch in a regulated market, validate with a qualified accountant, privacy counsel, and security auditor.

## Product North Star

AutoAccounts is accounting software for non-accountants: freelancers, solopreneurs, consultants, and small businesses. The product should hide bookkeeping jargon while preserving proper accounting integrity underneath.

The user experience should feel calm, legible, and forgiving. Users should not have to know debits, credits, journals, accruals, or tax accounts to complete ordinary tasks. The system should explain consequences in plain business language: "This invoice increases income and accounts receivable" is useful; "credit revenue, debit AR" belongs in developer and accountant-facing surfaces.

## Current Project Reality

- Framework: Next.js 15 App Router, React 19, TypeScript.
- API: tRPC with Zod validation and organisation-scoped procedures.
- Database: PostgreSQL through Prisma.
- Auth: NextAuth.js v5.
- UI: Tailwind CSS, shadcn/ui, Radix primitives, lucide-react.
- Jobs: BullMQ and Redis.
- Storage: local filesystem storage is acceptable for current local testing. Production should use S3-compatible object storage such as AWS S3 or MinIO-compatible infrastructure.
- Email: nodemailer/MailHog locally, Resend intended for production.
- Billing: Stripe subscriptions and webhooks.
- AI: the repository currently has mixed docs. `README.md` and implemented chat/extraction flow point to local Ollama, while older docs and `AGENTS.md` mention Anthropic/Claude. Treat local Ollama as current implementation reality unless a new architecture decision deliberately changes it.
- Implemented feature surface already includes AR, AP, reports, bank reconciliation, extraction, subscriptions, and chat scaffolding beyond the older sprint checklist.

## Non-Negotiable Invariants

- Every posted financial transaction must be represented by balanced double-entry journal lines. Total debits must equal total credits.
- Use `Prisma.Decimal` and PostgreSQL `Decimal`/`NUMERIC(19,4)` for money. Never use JavaScript floating point arithmetic for financial totals.
- Every tenant-owned row must be scoped by `organisationId` either directly or through an owned parent. Every read and mutation must enforce organisation scope.
- Posted accounting records are voided or reversed, not hard-deleted. Hard delete is acceptable only for drafts or pre-posting artifacts where the audit requirement explicitly allows it.
- AI extraction requires human review/confirmation before extracted data is saved. Chat is allowed to post accounting records when the user clearly asks it to, but chat-posted records must go through the same tenant checks, service-layer accounting rules, audit logging, usage limits, and role checks as normal UI flows.
- Audit logs should be append-only from the application perspective and should record actor, organisation, action, entity, before/after where safe, and timestamp.
- File access must be organisation-scoped. Never trust a file key or attachment id without checking ownership.
- Stripe webhook handling must verify signatures and be idempotent.

## Accounting Best Practices

The accounting engine is the heart of trust. The IRS describes double-entry bookkeeping as self-balancing because each transaction is recorded as debit and credit entries and total debits must equal total credits after posting. AutoAccounts should preserve that property in every service path.

Implementation guidance:

- Centralize journal creation in `AccountingService`; do not let routers or UI code write `JournalEntry` and `JournalLine` directly.
- Validate balance at the service boundary and inside the database transaction that creates the entry.
- Store both sides of every line explicitly; avoid negative debit or negative credit conventions except in reversal generation where the service clearly maps original debits to credits and credits to debits.
- Keep source metadata (`source`, `sourceId`, reference, description) rich enough to trace a report balance back to an invoice, bill, bank statement line, extraction, or manual entry.
- Once an invoice, bill, payment, or manual transaction is posted, corrections should create auditable adjustments, reversals, or replacement entries.
- Use account normal balance rules consistently in report presentation, but do not rely on UI sign formatting as accounting logic.
- Reconciliation should never mutate historical posted entries silently. It should match, link, create new entries through normal posting paths, or mark statement lines excluded with an audit reason.
- Preserve original imported statement lines. Normalization for matching is fine, but the source description, date, amount, and import batch should remain available.

## Records And Retention

Small-business recordkeeping guidance emphasizes being able to substantiate income, expenses, tax positions, and business purpose. AutoAccounts should treat receipts, invoices, bills, statement imports, and exports as evidence, not just UI attachments.

Implementation guidance:

- Attachments should be linked to the accounting object they support and remain readable for the organisation even if the object is voided.
- Keep source filenames, MIME type, size, upload timestamp, uploader, storage key, extraction result, and extraction status.
- Add import batch records for CSV bank imports and transaction imports so users can trace where a line came from.
- Prefer retention policies configurable by deployment or organisation. Do not implement irreversible deletion of posted accounting evidence without a clear product, legal, and audit decision.
- For GDPR deletion requests, separate personal-data erasure from financial-record retention. Scrub or pseudonymize PII where possible while retaining accounting facts required for legitimate recordkeeping.

## Multi-Tenant SaaS Isolation

AWS SaaS tenant-isolation guidance distinguishes application-level tenant context from actual isolation enforcement. AutoAccounts is currently pooled multi-tenant by `organisationId`, so tenant context must be carried everywhere and enforced consistently.

Implementation guidance:

- Resolve `organisationId` from the authenticated session on the server; never accept it from client input for ordinary tenant operations.
- Every tRPC procedure should use organisation-aware middleware for auth, role, and tenant context.
- Every query on tenant data should include `organisationId` directly or through a parent relation filter.
- Add tests for cross-tenant denial on high-risk routers: invoices, bills, contacts, attachments, reports, bank accounts, chat, exports, and webhooks that update organisation state.
- Consider database row-level security before production or enterprise launch. Prisma filtering is useful, but database-level controls reduce blast radius.
- For production object storage, make tenant boundaries visible in object keys and enforce them in application authorization. Pre-signed URLs must be short-lived and generated only after ownership checks. For local filesystem storage, preserve the same ownership checks and tenant-scoped path structure so the adapter can be swapped safely.
- Avoid global sequential identifiers that leak tenant volume or business activity. Invoice numbers can be organisation-scoped.

## Security Baseline

Use OWASP Top 10, OWASP API Security Top 10, OWASP ASVS, NIST CSF 2.0, and CISA Secure by Design as the security baseline. For this product, the most important risks are broken access control, injection, auth/session mistakes, insecure design, security misconfiguration, vulnerable dependencies, logging gaps, SSRF/file handling, and API authorization flaws.

Implementation guidance:

- Default-deny authorization. Make the safe path the shortest path.
- Validate all API input with Zod. Validate again at service boundaries for cross-router reusable operations.
- Treat file uploads as hostile: MIME sniffing, size limits, extension allowlists, malware scanning before production, and no server-side fetch of arbitrary URLs.
- Rate-limit auth, AI extraction, chat, uploads, Stripe-sensitive routes, and expensive report/export endpoints.
- Store secrets only in environment or a secret manager. Never put API keys or webhook secrets in client bundles, logs, seed data, or markdown examples.
- Use secure cookies and CSRF protections appropriate to Auth.js and Next.js route handlers.
- Set security headers before production: HSTS, content security policy, frame protections, referrer policy, and strict MIME handling.
- Use dependency scanning and lockfile review in CI.
- Log security-relevant events without logging financial document contents, access tokens, passwords, card details, or raw LLM prompts containing user documents.
- Build incident visibility: error tracking, audit logs, structured server logs, webhook event processing status, background job status, and admin replay tools.

## API And Service Design

Financial APIs are high-consequence even when the app is small-business focused. Broken object-level authorization is a common API risk, and AutoAccounts uses many object ids.

Implementation guidance:

- Every route receiving an id must prove that id belongs to `ctx.organisationId`.
- Use idempotency for operations that may be retried: Stripe webhooks, email sending, import processing, AI extraction jobs, and payment recording.
- Separate command operations from query/report operations.
- Put business rules in services, not React components. UI validation helps the user; service validation protects the ledger.
- Make status transitions explicit for invoices, bills, extraction jobs, reconciliation, and subscriptions.
- For background jobs, persist enough job state to safely retry and inspect failures.

## Privacy And Data Protection

GDPR Article 25 requires data protection by design and by default. For AutoAccounts, this maps cleanly to data minimization, scoped access, retention controls, export, deletion workflows, and careful AI processing.

Implementation guidance:

- Collect only fields needed for accounting, tax, billing, support, and security.
- Make privacy-preserving defaults: team members get least privilege, exports are explicit, sharing is opt-in, and public links are avoided unless intentionally designed.
- Keep user data portable. CSV/JSON export is a core requirement, not a nice-to-have.
- Design deletion as a workflow with states and auditability: request, verify authority, export option, erase/pseudonymize, retain required accounting records, confirm completion.
- Document subprocessors before production: hosting, email, storage, payments, analytics, AI providers, and error monitoring.
- If cloud AI is reintroduced, make data transfer, retention, and model-training settings explicit in product and vendor reviews.

## AI Extraction And Chat Safety

OWASP's LLM guidance highlights prompt injection, sensitive information disclosure, insecure output handling, excessive agency, and overreliance. These are especially important because AutoAccounts handles financial records and may create accounting objects.

Implementation guidance:

- Treat uploaded documents, OCR text, bank descriptions, invoice notes, and chat user content as untrusted input. They may contain malicious instructions.
- Keep LLM output advisory until validated and confirmed by a human.
- Validate LLM output against strict schemas and business rules. Reject or quarantine malformed, unbalanced, implausible, or cross-tenant outputs.
- Do not let the model choose arbitrary tool names, account ids, organisation ids, file paths, URLs, or SQL. Map model intents to a closed set of server-owned tools.
- Chat may post journals, invoices, bills, and payments when the user clearly instructs it to. The safety requirement is that chat must use the same validated services as the UI, not direct model-controlled persistence. Require explicit confirmation for sending invoices/emails, changing billing, deleting/pseudonymizing data, exporting sensitive data, and any ambiguous or destructive accounting action.
- Show confidence and source evidence for extracted fields. Let the user correct each field before save.
- Keep prompts and tool results free of secrets. Avoid including full historical ledgers unless the task needs it.
- For chat tools, enforce the same `organisationId`, role, usage limits, audit logs, and service-layer rules as normal UI flows. Treat chat as another command surface, not a privileged bypass.
- Add tests for prompt-injection attempts in documents and chat messages, especially attempts to bypass confirmation or access another organisation.

## Stripe Billing Best Practices

Stripe subscription state is asynchronous. The application should not assume a checkout redirect means access is active; webhook-confirmed state or fresh Stripe retrieval should drive entitlements.

Implementation guidance:

- Verify every Stripe webhook signature against the raw request body.
- Store processed Stripe event ids and make handlers idempotent.
- Return quickly after persisting/validating the event; process side effects safely and retryably when feasible.
- Handle at least: checkout completion, subscription created/updated/deleted, invoice paid, invoice payment failed, customer updated, and portal-driven subscription changes.
- Keep Stripe customer and subscription ids unique at the organisation level.
- Entitlements should be computed from stored subscription state plus usage records, not from client state.
- Usage gates should fail closed for paid-only features when billing state is unknown, while giving users a clear recovery path.
- Do not store card numbers. Use Stripe-hosted Checkout, Billing Portal, Elements, or official SDK patterns to keep PCI scope low.

## Reliability And Data Integrity

Accounting apps are judged by correctness and recoverability more than novelty.

Implementation guidance:

- Use database transactions around multi-write financial operations.
- Prefer unique constraints for business invariants where possible: organisation-scoped invoice numbers, processed webhook event ids, monthly usage rows, import fingerprints.
- For report correctness, unit-test the accounting math with multiple account types, partial payments, voids, date boundaries, and tax.
- For reports and dashboard performance, add indexes before caching. Cache only after correctness is proven.
- Use UTC timestamps internally; display dates in the organisation/user locale. For accounting dates, preserve date-only semantics.
- Backups, point-in-time recovery, and restore drills are production launch requirements.
- Make exports deterministic and reconstructable.

## UX Principles For Non-Accountants

The best accounting UX reduces anxiety. Users need to understand what happened, what needs attention, and how to fix mistakes without damaging their books.

Implementation guidance:

- Use workflow language: invoices, bills, payments, expenses, receipts, bank matches, tax summary.
- Avoid exposing journal-entry terminology unless in an advanced/details view.
- Forms should accept common formats where unambiguous and give specific, field-level errors.
- Do not clear user-entered fields after validation errors.
- Always preview AI extraction and CSV import before committing.
- Use confirmation screens for irreversible or high-consequence actions: voiding, posting, sending invoice email, completing reconciliation, deleting draft records, changing billing.
- Prefer dense but readable operational screens over marketing-like layouts inside the app.
- Reports should support drill-down from totals to source transactions.
- Dashboard numbers should define their period and basis: month, YTD, as-of date, cash/accrual assumption.
- Empty states should offer the next meaningful action, not decorative copy.

## Accessibility

W3C recommends WCAG 2.2 to maximize future applicability, while the project docs currently mention WCAG 2.1 AA. Aim for WCAG 2.2 AA unless a specific launch target requires a different standard.

Implementation guidance:

- Use semantic HTML and Radix/shadcn components correctly.
- Ensure keyboard access for dialogs, menus, tabs, tables, upload flows, and reconciliation matching.
- Maintain visible focus states.
- Meet color contrast requirements for text, icons conveying meaning, badges, status chips, charts, and disabled states.
- Do not rely on color alone for invoice/bill/reconciliation statuses.
- Add accessible names to icon-only buttons.
- Use error summaries plus field-level messages for complex forms.
- Announce async states for extraction, uploads, long report generation, and chat tool execution.
- Test with Playwright plus automated accessibility checks before major releases, and manually check keyboard navigation.

## Compliance And Trust Roadmap

SOC 2 is not a feature checklist, but its Trust Services Criteria are a useful operating model for a SaaS handling financial data: security, availability, processing integrity, confidentiality, and privacy.

Implementation guidance:

- Start collecting evidence early: access reviews, dependency updates, backup checks, incident response docs, change management, production deploy logs, vulnerability remediation, and vendor inventory.
- Document control owners before the team grows.
- Processing integrity matters: tests proving ledger correctness, report correctness, and webhook idempotency are compliance evidence.
- Confidentiality matters: encryption, access control, logging discipline, and data retention should be visible in architecture docs.
- Availability matters: monitoring, backups, restore drills, background job alerts, and graceful degradation.

## Engineering Workflow Memory

- Update docs when architecture reality changes. The current Claude/Ollama mismatch should be resolved before production-facing documentation is trusted.
- Add or update tests whenever touching accounting, billing, tenant isolation, AI tools, reconciliation, exports, or reports.
- Prefer service-layer changes with small router adapters rather than duplicating logic in UI/API routes.
- Keep implementation vertical and user-verifiable.
- Run at minimum `npm run typecheck` and relevant `npm run test` slices after meaningful code changes.
- Never weaken accounting invariants to make a UI flow easier.

## Launch Readiness Checklist

- Ledger creation and voiding covered by tests.
- Cross-tenant access tests for all routers and file endpoints.
- Stripe webhooks signature-verified and idempotent.
- AI extraction cannot save without confirmation. Chat may post records on clear user instruction, but it cannot bypass service-layer validation, audit logging, tenant isolation, or role/usage checks.
- Attachment upload/download ownership checks covered.
- Report totals tested against known ledgers.
- Audit logs written for every mutation that changes accounting, contacts, billing, settings, imports, exports, and AI-confirmed records.
- Data export implemented and tested.
- GDPR deletion/pseudonymization workflow designed.
- Backups and restore tested.
- Security headers configured.
- Rate limits enabled on sensitive and expensive endpoints.
- WCAG 2.2 AA pass on core workflows.
- Production secrets managed outside source control.

## Research Sources

Primary and authoritative sources consulted on 2026-05-14:

- IRS Publication 583, "Starting a Business and Keeping Records": https://www.irs.gov/publications/p583
- OWASP Top 10 2021: https://owasp.org/Top10/2021/
- OWASP API Security Top 10 2023: https://owasp.org/www-project-api-security/
- OWASP ASVS overview: https://devguide.owasp.org/en/03-requirements/05-asvs/
- OWASP Top 10 for Large Language Model Applications 2025: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- AWS SaaS tenant isolation strategies: https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html
- NIST Cybersecurity Framework 2.0: https://www.nist.gov/cyberframework
- CISA Secure by Design: https://www.cisa.gov/securebydesign
- AICPA SOC 2 Trust Services Criteria overview: https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2
- GDPR Article 25, data protection by design and by default: https://gdpr-info.eu/art-25-gdpr/
- Stripe subscription webhook guidance: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe webhook signature verification guidance: https://docs.stripe.com/webhooks
- Stripe PCI compliance guide: https://stripe.com/guides/pci-compliance
- W3C WCAG 2.2: https://www.w3.org/TR/wcag/
- GOV.UK Design System validation guidance: https://design-system.service.gov.uk/patterns/validation/
- GOV.UK Design System error message guidance: https://design-system.service.gov.uk/components/error-message/
