# AutoAccounts — Chat Assistant Feature

**Version:** 1.0.0  
**Status:** In Progress  
**Created:** 2026-05-10  
**Branch:** `feature/chat-assistant`

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
| **Upload & extract documents** | (Upload receipt) "Add this as a bill" |
| **Query data** | "How much does Acme Corp owe me?", "What's my cash balance?" |
| **Get help** | "How do I reconcile my bank account?" |

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
│   /app/(app)/chat    │
└──────────┬──────────┘
           │ tRPC mutation: chat.sendMessage
           ▼
┌─────────────────────────────────────────────┐
│              Chat Router (tRPC)              │
│  - Persists user message                     │
│  - Calls ChatService.processMessage()        │
│  - Returns assistant response                │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│            ChatService                       │
│                                              │
│  1. Build prompt with conversation history   │
│  2. Include org context (accounts, contacts) │
│  3. Call Ollama with tool definitions         │
│  4. Parse tool calls from response           │
│  5. Execute tools (delegate to services)     │
│  6. Return formatted response                │
└──────────┬──────────────────────────────────┘
           │ delegates to
           ▼
┌─────────────────────────────────────────────┐
│         Existing Service Layer               │
│                                              │
│  AccountingService.createJournalEntry()      │
│  InvoiceService.createInvoice()              │
│  BillService.createBill()                    │
│  ReportService.getProfitAndLoss()            │
│  ReportService.getBalanceSheet()             │
│  ExtractionService.extractDocument()         │
│  + direct Prisma queries for lookups         │
└─────────────────────────────────────────────┘
```

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

**Available Tools:**

| Tool | Service | Description |
|------|---------|-------------|
| `create_journal_entry` | AccountingService | Create a manual journal entry with debit/credit lines |
| `create_invoice` | InvoiceService | Create a draft invoice for a customer |
| `create_bill` | BillService | Create a draft bill from a supplier |
| `get_profit_and_loss` | ReportService | Generate P&L report for a date range |
| `get_balance_sheet` | ReportService | Generate balance sheet as of a date |
| `get_trial_balance` | ReportService | Generate trial balance for a date range |
| `get_ar_aging` | Prisma query | Get accounts receivable aging |
| `get_ap_aging` | Prisma query | Get accounts payable aging |
| `list_accounts` | Prisma query | List chart of accounts |
| `list_contacts` | Prisma query | List customers or suppliers |
| `search_transactions` | Prisma query | Search journal entries |
| `get_account_balance` | Prisma query | Get balance for a specific account |
| `extract_document` | ExtractionService | Extract data from an uploaded receipt/invoice |

### 2.4 AI Integration

**Model:** Ollama (same as extraction — configurable via `OLLAMA_MODEL` env var)

**Prompt Strategy:**
1. System prompt defines the assistant's role, available tools, and output format
2. Org context injected: currency, business name, list of accounts (codes + names), recent contacts
3. Conversation history (last 20 messages) included for context
4. Tool calls use a structured JSON format that the service parses

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
| Text | Markdown-rendered text |
| Report table | Formatted table with currency values |
| Created document | Card with link to the invoice/bill/entry |
| Extraction result | Card showing extracted fields with confidence badges |
| Error | Red-tinted card with error message |
| Confirmation | Card with confirm/cancel buttons (for destructive actions) |
