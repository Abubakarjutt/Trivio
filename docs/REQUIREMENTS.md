# AutoAccounts — Product Requirements Document

**Version:** 0.3.0  
**Status:** Active  
**Last Updated:** 2026-05-17

---

## 1. Product Vision

AutoAccounts is a SaaS web application that empowers non-accountants — freelancers, solopreneurs, consultants, and small businesses — to manage their finances confidently without requiring accounting knowledge. The product abstracts accounting complexity behind intuitive workflows while maintaining double-entry bookkeeping integrity under the hood.

---

## 2. Target Users

| Persona | Description |
|---|---|
| **Freelancer / Solopreneur** | Individual managing their own income, expenses, and invoicing |
| **Small Business Owner** | Owner of a business with a handful of employees or contractors |
| **Small Company** | A small company needing structured accounts, AP/AR, and reporting |

All personas share a common trait: **limited or no formal accounting knowledge**.

---

## 3. Functional Requirements

### 3.1 Account Setup & Onboarding

- FR-01: User can register with email/password or OAuth (Google).
- FR-02: On first login, user completes a setup wizard:
  - Business name, type (sole trader, partnership, company, etc.)
  - Base currency selection (single currency per account; no multi-currency conversion at this stage)
  - Tax regime selection (e.g. UK VAT, US Sales Tax, EU VAT, GST, none)
  - Fiscal year start month
- FR-03: System auto-creates a default chart of accounts appropriate for the selected business type.
- FR-04: User can invite team members (subscription tier only) with role-based access (Owner, Editor, Viewer).

### 3.2 Chart of Accounts

- FR-05: System maintains a default chart of accounts with standard account categories:
  - Assets (current, fixed)
  - Liabilities (current, long-term)
  - Equity
  - Income / Revenue
  - Expenses
- FR-06: User can create custom accounts under any category.
- FR-07: User can rename, archive, or reorder accounts.
- FR-08: Each account has a type (debit-normal / credit-normal), code, name, and description.

### 3.3 Transactions & Journal Entries

- FR-09: User can manually enter income and expense transactions via a simplified form (no double-entry terminology exposed).
- FR-10: Under the hood, every transaction is stored as a balanced double-entry journal entry.
- FR-11: Transactions can be tagged with:
  - Date, description, amount, currency (fixed to account currency)
  - Category (mapped to a chart-of-accounts line)
  - Tax code / rate
  - Attachment (receipt, invoice image or PDF)
  - Project / cost-centre tag (optional)
- FR-12: User can edit or void (not delete) posted transactions, preserving audit trail.
- FR-13: User can bulk-import transactions via CSV upload.

### 3.4 Accounts Receivable (AR)

- FR-14: User can create customers.
- FR-15: User can create and send invoices:
  - Line items with description, quantity, unit price
  - Tax line auto-calculated based on tax regime
  - Due date and payment terms
  - PDF generation and email delivery
- FR-16: Invoice statuses: Draft → Sent → Partially Paid → Paid → Overdue → Void.
- FR-17: User can record payments against invoices (partial or full).
- FR-18: AR aging report showing outstanding balances by customer and age bucket.

### 3.5 Accounts Payable (AP)

- FR-19: User can create suppliers / vendors.
- FR-20: User can record bills (supplier invoices) with the same line-item structure as AR.
- FR-21: Bill statuses: Draft → Received → Partially Paid → Paid → Overdue → Void.
- FR-22: User can record payments against bills.
- FR-23: AP aging report showing outstanding balances by vendor and age bucket.

### 3.6 AI-Powered Invoice / Receipt Extraction

- FR-24: User can upload an invoice or receipt image/PDF.
- FR-25: System sends the document to an LLM (Claude API) to extract:
  - Vendor/customer name
  - Invoice number, date, due date
  - Line items (description, qty, unit price)
  - Tax amounts
  - Total amount
- FR-26: Extracted data is pre-filled into the transaction/bill/invoice form for user review and confirmation before saving.
- FR-27: User can correct any extracted field before confirming.
- FR-28: Extraction confidence indicators shown per field.

### 3.7 Bank Reconciliation

- FR-29: User can create bank accounts and manually enter or import bank statement lines (CSV).
- FR-30: System matches bank statement lines against recorded transactions using amount + date proximity + description similarity.
- FR-31: User reviews suggested matches, confirms, creates new transactions for unmatched lines, or marks lines as excluded.
- FR-32: Reconciliation is locked once completed for a statement period.
- FR-33: Reconciliation summary report shows opening balance, closing balance, matched/unmatched counts.
- FR-34: *(Future)* Automatic bank feed connection via open banking / Plaid.

### 3.8 Financial Reports

- FR-35: **Profit & Loss (Income Statement)** — for a selected date range.
- FR-36: **Balance Sheet** — assets, liabilities, equity at a point in time.
- FR-37: **Cash Flow Statement** — operating, investing, financing activities.
- FR-38: **Tax Summary** — tax collected (output) vs. tax paid (input) for a period, exportable for filing.
- FR-39: **AR Aging** — outstanding receivables by age bucket.
- FR-40: **AP Aging** — outstanding payables by age bucket.
- FR-41: **Trial Balance** — all accounts with debit/credit totals.
- FR-42: Reports are exportable as PDF and CSV.
- FR-43: Reports respect the user's fiscal year and tax period settings.

### 3.9 Dashboard

- FR-44: Dashboard shows at-a-glance KPIs:
  - Total income vs. expenses (current month / YTD)
  - Outstanding receivables
  - Outstanding payables
  - Net profit (current month / YTD)
  - Cash position (sum of bank accounts)
- FR-45: Charts: income vs. expense trend (last 12 months), expense breakdown by category.

### 3.10 AI Chat Assistant

- FR-51: User can open a floating chat panel from anywhere in the app without losing their current page context.
- FR-52: User can converse with an AI assistant in natural language to perform accounting tasks.
- FR-53: The assistant can create, list, and retrieve invoices and bills via chat.
- FR-54: The assistant can record payments (full or partial) against invoices and bills.
- FR-55: The assistant can void invoices, bills, and journal entries.
- FR-56: The assistant can send invoices and approve bills.
- FR-57: The assistant can create and update contacts (customers and suppliers).
- FR-58: The assistant can create new chart-of-accounts entries.
- FR-59: The assistant can generate financial reports (P&L, balance sheet, trial balance, AR/AP aging) and display them as visual cards inline in the chat.
- FR-60: The assistant can search journal entries and retrieve account balances.
- FR-61: When the user asks "how do I…", the assistant provides numbered step-by-step instructions for performing tasks manually in the app UI — without requiring a tool call.
- FR-62: Responses stream token-by-token with a typing animation; the UI renders the full response when streaming completes.
- FR-63: Raw tool call syntax is never shown to the user; only rendered visual result cards appear.
- FR-64: Tool results are displayed as contextual visual cards (invoice = blue, bill = amber, journal = violet, payment = green, void = orange, reports = themed tables).
- FR-65: Chat conversations are persisted; the user can view previous conversations in a sidebar and delete them.
- FR-66: All tool executions are scoped to the authenticated user's organisation. Tool calls and results are stored in `ChatMessage` for audit purposes.

### 3.11 Personal Finance Module (EasyFinance)

The Personal Finance module is a self-contained addition to AutoAccounts, merged from the EasyFinance project. It reuses existing double-entry bookkeeping data (JournalLine aggregation) for spend calculations — no duplicate transaction model.

#### 3.11.1 Budgets

- FR-67: User can create a budget with a name, category (partial match against expense account names), spending limit, and period (weekly/monthly/quarterly/yearly).
- FR-68: System automatically calculates how much has been spent in the current period by aggregating expense JournalLines whose account name contains the budget's category string (case-insensitive).
- FR-69: Each budget card shows: spent amount, remaining amount, utilization percentage (capped at 100%), and a colour-coded progress bar (green < 80%, amber 80–99%, red ≥ 100%).
- FR-70: User can archive a budget (hides it from the default list but preserves history).
- FR-71: User can delete a budget permanently.

#### 3.11.2 Goals

- FR-72: User can create a savings goal with a name, optional description, target amount, optional starting amount, and optional target date.
- FR-73: Goals have a status: ACTIVE, COMPLETED, or CANCELLED.
- FR-74: User can contribute funds to an active goal; the current amount increases by the contributed amount.
- FR-75: When a contribution brings the current amount to within $0.001 of the target, the goal is automatically marked COMPLETED.
- FR-76: User can manually mark a goal as COMPLETED or CANCELLED.
- FR-77: Goal cards show a progress bar, progress percentage, and remaining amount.
- FR-78: Goals list supports filtering by status (All / Active / Completed / Cancelled).
- FR-79: Summary strip shows total target, total saved, and still-needed across all ACTIVE goals.

#### 3.11.3 Recurring Items

- FR-80: User can create a recurring item (income or expense) with a name, amount, frequency (daily/weekly/fortnightly/monthly/quarterly/yearly), category, and next due date.
- FR-81: Recurring items list shows three sections: Due Now (overdue), Upcoming, and Inactive.
- FR-82: User can mark a recurring item as paid; the system advances the next due date by exactly one frequency period.
- FR-83: User can deactivate (pause) or reactivate a recurring item.
- FR-84: Summary strip normalises all active items to monthly equivalents and shows monthly income, monthly expense, and net.
- FR-85: Monthly normalisation factors: daily × 30, weekly × 4.33, fortnightly × 2.17, monthly × 1, quarterly ÷ 3, yearly ÷ 12.

#### 3.11.4 Watchlists

- FR-86: User can create a watchlist entry with a name, category, spending threshold, and period.
- FR-87: System calculates actual spend the same way as budgets (JournalLine aggregation over the period window).
- FR-88: A watchlist is marked as "breached" when actual spend strictly exceeds the threshold (spend > threshold).
- FR-89: An alert strip appears at the top of the Watchlists page listing all breached watchlists by name.
- FR-90: Watchlist cards show spend, threshold, percentage used (may exceed 100%), and a colour-coded bar.
- FR-91: User can pause or resume a watchlist (paused watchlists are excluded from the active list and breach detection).
- FR-92: User can delete a watchlist permanently.

### 3.12 Subscription & Billing

- FR-46: **Free Tier** — limited to:
  - 1 user
  - Up to 50 transactions/month
  - Up to 5 AI document extractions/month
  - Core reports (P&L, Balance Sheet)
  - No team members
- FR-47: **Pro Tier (paid, monthly/annual)** — includes:
  - Unlimited transactions
  - Unlimited AI extractions
  - All reports including Tax Summary
  - Up to 5 team members
  - Priority support
- FR-48: *(Future)* **Business Tier** — more team members, API access, advanced permissions.
- FR-49: Subscription managed via Stripe; user can upgrade, downgrade, or cancel from within the app.
- FR-50: Invoices / receipts for subscription payments sent automatically.

---

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Security**: All data encrypted at rest and in transit (TLS 1.2+). Row-level isolation ensures users cannot access other users' data. |
| NFR-02 | **Audit Trail**: Every write operation is logged with user ID, timestamp, and before/after state. |
| NFR-03 | **Availability**: Target 99.9% uptime once deployed to production. |
| NFR-04 | **Performance**: Dashboard and report pages load within 2 seconds for datasets up to 10,000 transactions. |
| NFR-05 | **Scalability**: Architecture must support horizontal scaling without code changes. |
| NFR-06 | **Data Portability**: Users can export all their data (transactions, invoices, bills) as CSV/JSON at any time. |
| NFR-07 | **Compliance**: GDPR-ready — user can request data deletion; data residency configurable per deployment. |
| NFR-08 | **Accessibility**: WCAG 2.1 AA compliance for all user-facing UI. |
| NFR-09 | **Extensibility**: Tax regime system must be pluggable to support new countries without core changes. |

---

## 5. Constraints & Assumptions

- Single currency per organisation account (multi-currency deferred to a future version).
- No real-time bank feed integration in MVP (manual import only).
- AI extraction relies on Claude API; extraction quality depends on document clarity.
- Initial deployment targets AWS; local development uses Docker Compose.
- Accounting model is **double-entry bookkeeping**; all transactions must balance.

---

## 6. Out of Scope (v1)

- Payroll processing
- Multi-currency / FX conversion
- Real-time bank feed (Plaid / Open Banking)
- Mobile native apps (responsive web only)
- Inventory management
- Fixed asset depreciation schedules
- Multi-company / consolidated accounts

---

## 7. Glossary

| Term | Definition |
|---|---|
| **Chart of Accounts** | Structured list of all accounts used by an organisation |
| **Double-Entry** | Every transaction debits one account and credits another by equal amounts |
| **AR** | Accounts Receivable — money owed to the business by customers |
| **AP** | Accounts Payable — money the business owes to suppliers |
| **Trial Balance** | List of all account balances; debits must equal credits |
| **Reconciliation** | Process of matching bank statement lines to recorded transactions |
| **Fiscal Year** | 12-month accounting period chosen by the organisation |
| **Tax Regime** | Country/region-specific tax rules (VAT, GST, Sales Tax, etc.) |
