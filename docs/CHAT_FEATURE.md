# AutoAccounts — Chat Assistant Feature

**Version:** 1.1.0  
**Status:** Complete (core), In Progress (extract_document)  
**Created:** 2026-05-10  
**Last Updated:** 2026-05-15

---

## 1. Overview

The Chat Assistant is a conversational interface that allows users to perform core accounting tasks through natural language. Instead of navigating to different pages and filling out forms, users can type commands like "create an invoice for Acme Corp for $500" or "show me this month's P&L" and the system handles it.

### 1.1 Capabilities

| Capability | Examples |
|------------|---------|
| **Create journal entries** | "Record $200 expense for office supplies" |
| **Generate reports** | "Show me the P&L for this month", "What's my AR aging?" |
| **Create invoices** | "Create an invoice for Acme Corp: 5 hours consulting at $150/hr" |
| **Create bills** | "Record a bill from AWS for $432.10 due June 15" |
| **Record payments** | "Mark invoice #INV-042 as paid", "Record $500 payment against the AWS bill" |
| **Void records** | "Void invoice #INV-007", "Cancel that journal entry" |
| **Send invoices** | "Send invoice #INV-042 to the customer" |
| **Manage contacts** | "Create a new customer: Acme Corp, acme@example.com" |
| **Manage accounts** | "Add an account called 'Software Subscriptions' under expenses" |
| **List & search** | "Show all unpaid invoices", "List my suppliers", "Search transactions for 'AWS'" |
| **Upload & extract documents** | (Upload receipt) "Add this as a bill" |
| **Query data** | "How much does Acme Corp owe me?", "What's my cash balance?" |
| **UI guidance** | "How do I reconcile my bank account?", "Walk me through creating an invoice manually" |

### 1.2 Non-Goals (v1)

- Voice input
- Multi-turn editing of in-progress documents ("change the amount on line 2")
- Proactive notifications ("Invoice #42 is overdue")
- Collaboration (shared chat between team members)

---

## 2. Architecture

### 2.1 High-Level Flow

```
User types message / uploads file
        │
        ▼
┌─────────────────────┐
│   Chat UI Component  │  (floating panel, right side)
│   chat-panel.tsx     │
└──────────┬──────────┘
           │ POST /api/chat  (SSE stream)
           ▼
┌─────────────────────────────────────────────┐
│            /api/chat Route Handler           │
│  - Auth check + org scope                   │
│  - Create/reuse ChatConversation             │
│  - Persist user ChatMessage                  │
│  - Build prompt via ChatService              │
│  - Stream Ollama response via SSE            │
│  - Parse + execute tool calls server-side   │
│  - Persist assistant ChatMessage             │
│  - Send SSE "done" event with full result   │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│            ChatService (chat.service.ts)     │
│                                              │
│  buildChatMessages()                         │
│  1. Build system prompt with org context     │
│  2. Inject APP_UI_GUIDE for how-to questions │
│  3. Inject TOOL_DEFINITIONS (25 tools)       │
│  4. Append conversation history              │
│                                              │
│  parseToolCalls()                            │
│  5. Extract TOOL_CALL: {…} lines from text  │
│  6. Strip tool call lines from display text  │
│                                              │
│  executeToolCall()                           │
│  7. Dispatch to the appropriate tool fn      │
└──────────┬──────────────────────────────────┘
           │ delegates to
           ▼
┌─────────────────────────────────────────────┐
│         Existing Service Layer + Prisma      │
│                                              │
│  AccountingService.createJournalEntry()      │
│  InvoiceService.createInvoice/Payment/Void() │
│  BillService.createBill/Payment/Void()       │
│  ReportService.getProfitAndLoss()            │
│  ReportService.getBalanceSheet()             │
│  ReportService.getTrialBalance()             │
│  + direct Prisma queries for lookups         │
└─────────────────────────────────────────────┘
```

**Streaming:** The route uses Server-Sent Events. The client receives `token` events during generation (for the typing animation), then a final `done` event with the complete content, tool calls, and tool results. The `conversationId` is sent in the initial `start` event so the UI can open the right conversation before the response finishes.

### 2.2 Data Model

```prisma
model ChatConversation {
  id              String        @id @default(cuid())
  organisationId  String
  userId          String
  title           String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  organisation    Organisation  @relation(fields: [organisationId], references: [id])
  user            User          @relation(fields: [userId], references: [id])
  messages        ChatMessage[]

  @@index([organisationId])
  @@index([userId])
}

model ChatMessage {
  id               String            @id @default(cuid())
  conversationId   String
  role             String            // "user" | "assistant"
  content          String            // text content
  toolCalls        Json?             // tools the AI called (for audit)
  toolResults      Json?             // results of tool execution
  attachmentId     String?           // optional linked attachment
  createdAt        DateTime          @default(now())
  conversation     ChatConversation  @relation(fields: [conversationId], references: [id])
  attachment       Attachment?       @relation(fields: [attachmentId], references: [id])

  @@index([conversationId])
}
```

### 2.3 Tool System

The AI model receives a system prompt with tool definitions. When it needs to perform an action, it outputs a structured tool call that the ChatService intercepts and executes server-side.

**Available Tools (25 total):**

| Tool | Service | Description |
|------|---------|-------------|
| `create_journal_entry` | AccountingService | Create a balanced double-entry journal entry |
| `create_invoice` | InvoiceService | Create a draft invoice for a customer |
| `create_bill` | BillService | Create a draft bill from a supplier |
| `get_invoice` | Prisma query | Fetch a single invoice by number |
| `get_bill` | Prisma query | Fetch a single bill by number |
| `list_invoices` | Prisma query | List invoices filtered by status |
| `list_bills` | Prisma query | List bills filtered by status |
| `record_invoice_payment` | InvoiceService | Record full or partial payment against an invoice |
| `record_bill_payment` | BillService | Record full or partial payment against a bill |
| `void_invoice` | InvoiceService | Void an invoice (posts reversal journal) |
| `void_bill` | BillService | Void a bill (posts reversal journal) |
| `void_transaction` | AccountingService | Void a journal entry (posts reversal) |
| `send_invoice` | InvoiceService | Mark invoice as sent / email it to customer |
| `approve_bill` | BillService | Move bill from draft to received/approved |
| `create_contact` | Prisma | Create a new customer or supplier contact |
| `update_contact` | Prisma | Update an existing contact |
| `create_account` | Prisma | Create a new chart-of-accounts entry |
| `get_profit_and_loss` | ReportService | Generate P&L report for a date range |
| `get_balance_sheet` | ReportService | Generate balance sheet as of a date |
| `get_trial_balance` | ReportService | Generate trial balance for a date range |
| `get_ar_aging` | Prisma query | Get accounts receivable aging buckets |
| `get_ap_aging` | Prisma query | Get accounts payable aging buckets |
| `list_accounts` | Prisma query | List chart of accounts |
| `list_contacts` | Prisma query | List customers or suppliers |
| `search_transactions` | Prisma query | Search journal entries by description |
| `get_account_balance` | Prisma query | Get running balance for a specific account |
| `extract_document` | ExtractionService | *(planned)* Extract data from an uploaded receipt/invoice |

### 2.4 AI Integration

**Model:** Ollama (same as extraction — configurable via `OLLAMA_MODEL` env var)

**Prompt Strategy:**
1. System prompt defines the assistant's role, available tools, and output format
2. `APP_UI_GUIDE` injected — step-by-step procedures for every page/workflow in the app, so the AI can answer "how do I…" questions without a tool call
3. Org context injected: currency, business name, list of accounts (codes + names), recent contacts
4. Conversation history (last 20 messages) included for context
5. Tool calls use a structured JSON format that the service parses; all other text is shown to the user

**Tool Call Format (from AI):**
```json
{"tool": "create_invoice", "args": {"contactName": "Acme Corp", "lines": [{"description": "Consulting", "quantity": 5, "unitPrice": 150}], "dueDate": "2026-06-10"}}
```

**Response Format:**
The AI returns natural language with optional embedded tool calls. The service:
1. Extracts tool calls from the response
2. Executes them against real services
3. Formats results back into the conversation

### 2.5 File Upload in Chat

Users can attach files (receipts, invoices) directly in the chat. Flow:

1. File uploaded via existing `/api/attachments/upload` endpoint
2. `attachmentId` included in the chat message
3. ChatService detects the attachment and triggers extraction
4. Extraction result presented in chat for user confirmation
5. User says "add as bill" or "create invoice from this" → service creates the document

---

## 3. Implementation Plan

### Phase 10 — Chat Assistant (Sprint 10)

**Goal:** Conversational AI assistant that can create entries, generate reports, and process uploaded documents.

### Tasks

- [x] **P10-01** Prisma schema: `ChatConversation`, `ChatMessage` models + migration.
- [x] **P10-02** `ChatService` — core service: prompt building, Ollama SSE streaming, tool parsing, tool execution.
- [x] **P10-03** Tool implementations: `create_journal_entry`, `create_invoice`, `create_bill`.
- [x] **P10-04** Tool implementations: `get_profit_and_loss`, `get_balance_sheet`, `get_trial_balance`.
- [x] **P10-05** Tool implementations: `list_accounts`, `list_contacts`, `search_transactions`, `get_account_balance`, `list_invoices`, `list_bills`, `get_invoice`, `get_bill`.
- [x] **P10-06** Tool implementations: `get_ar_aging`, `get_ap_aging`.
- [x] **P10-07** Tool implementations: `record_invoice_payment`, `record_bill_payment`, `void_invoice`, `void_bill`, `void_transaction`, `send_invoice`, `approve_bill`, `create_contact`, `update_contact`, `create_account`.
- [ ] **P10-08** Tool implementation: `extract_document` — integrate with existing extraction service.
- [x] **P10-09** `/api/chat` SSE route + tRPC: `chat.getConversation`, `chat.listConversations`, `chat.deleteConversation`.
- [x] **P10-10** Chat UI: floating panel component with message list, streaming typing animation, input, conversation sidebar.
- [x] **P10-11** Chat UI: 20+ visual tool result card types with consistent white+colored-header design.
- [x] **P10-12** Chat UI: `APP_UI_GUIDE` injected into system prompt; AI answers "how do I…" with numbered steps.
- [ ] **P10-13** Chat UI: file attachment preview and upload progress.
- [x] **P10-14** Unit tests: 75 tests covering all 25 tool implementations. 140 total suite tests passing.
- [ ] **P10-15** Integration/E2E tests: end-to-end chat flows.
- [x] **P10-16** Chat conversation management: conversation list sidebar, create new, delete.

**Definition of Done:** User can open chat panel, create invoices/bills/entries, view reports, and upload receipts — all via natural language conversation.

---

## 4. Security Considerations

- **Org scoping:** All tool executions use the authenticated user's `organisationId`. No cross-tenant data access.
- **Audit trail:** Tool calls and results are persisted in `ChatMessage.toolCalls` and `toolResults` for auditability.
- **AI confirmation:** Destructive actions (create invoice, journal entry) show a confirmation card before executing. The AI presents what it will do, and the user must confirm.
- **Rate limiting:** Chat messages subject to existing rate limits. AI calls counted against usage limits.
- **Input sanitization:** All tool arguments validated with Zod before execution.
- **File uploads:** Existing MIME type and size validation applies.

---

## 5. UI Design

### 5.1 Chat Panel

- **Position:** Floating panel on the right side of the app, toggled by a chat button in the sidebar
- **Width:** 420px (collapsible)
- **Components:**
  - Header: conversation title, new chat button, close button
  - Message list: scrollable, auto-scroll to bottom
  - User messages: right-aligned, primary color
  - Assistant messages: left-aligned, with rich formatting
  - Tool result cards: inline in assistant messages (tables, confirmation cards)
  - Input area: text input + file upload button + send button
  - Typing indicator: animated dots while AI is processing

### 5.2 Rich Message Types

| Type | Rendering |
|------|-----------|
| Text | Plain text, whitespace-preserved; `TOOL_CALL:` lines stripped before display |
| UI guidance | Numbered step-by-step text from the AI's built-in app guide |
| Created invoice | Blue card — number, customer, dates, status badge, total |
| Created bill | Amber card — number, supplier, dates, status badge, total |
| Created journal entry | Violet card — description + DR/CR lines with fixed-width columns |
| Payment recorded | Green card — invoice/bill number, amount paid, new status |
| Void | Orange card — voided record number + type |
| Invoice/bill detail | White card with status badge, line items, outstanding amount |
| Invoice/bill list | Scrollable table of records with status badges and amounts |
| Contact card | Card with contact type badge (customer / supplier / both), email |
| Contact list | Table of contacts with type and email |
| Account card | White card with account code, type, balance |
| Account list | Fixed-width table — code, name, type, balance |
| Account balance | Card — account name, code (monospace), large balance figure |
| P&L report | Two-section card (Income / Expenses) with net profit total |
| Balance sheet | Three-section card (Assets / Liabilities / Equity) |
| Trial balance | Fixed-width three-column table (account, debit, credit) with totals |
| AR aging | Blue-themed table with 30/60/90/90+ day bucket columns |
| AP aging | Amber-themed table with 30/60/90/90+ day bucket columns |
| Transaction search | Table of journal entries with date, description, amount |
| Error | Red-tinted banner with error message |
