import { type PrismaClient, Prisma, InvoiceStatus, CrmLeadStatus, CrmLeadSource, CrmActivityType, RecurringType, RecurringFrequency, GoalStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { createJournalEntry, voidJournalEntry } from "./accounting.service";
import { createInvoice, postInvoiceToLedger, recordInvoicePayment, voidInvoice } from "./invoice.service";
import { createBill, postBillToLedger, recordBillPayment, voidBill } from "./bill.service";
import { extractionQueue } from "@/lib/queue";

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

const APP_UI_GUIDE = `
App pages & navigation:
/dashboard — overview stats, recent activity
/invoices — list invoices; "New Invoice" button top-right
/invoices/new — invoice form: customer, date, due date, line items (description/qty/price), notes → Save as Draft → Send
/invoices/[id] — invoice detail: Record Payment button, Send button, Void button, download PDF
/bills — list bills; "New Bill" button top-right
/bills/new — bill form: supplier, date, due date, line items → Save; then Approve → pay
/bills/[id] — bill detail: Approve button, Record Payment button, Void button
/contacts — list customers & suppliers; "New Contact" button; click row to edit
/accounts — chart of accounts list; "New Account" button; set code, name, type (Asset/Liability/Equity/Income/Expense)
/transactions — journal entry list; "New Entry" button
/transactions/new — manual journal: date, description, add lines (account + debit or credit); debits must equal credits
/extract — AI document extraction: drag-drop or click to upload PDF/image → AI reads it → review extracted data → confirm to save as invoice or bill
/reconciliation — bank reconciliation: select bank account → upload CSV statement → match transactions to journal entries → mark reconciled
/recurring — recurring items: income and expense items that repeat; "New Recurring" button; track salary, rent, subscriptions
/goals — financial goals: set target amount, target date; track progress manually or auto-calculated from transactions
/crm — CRM overview: leads, deals, companies, activities pipeline
/crm/leads — lead list; "New Lead" button; set status, source, estimated value
/crm/deals — deals board; kanban by pipeline stage; "New Deal" button
/crm/activities — activity log; schedule calls/emails/meetings/tasks
/crm/companies — company list linked to contacts
/reports — report hub; links to all reports below
/reports/profit-loss — P&L: set date range → Run
/reports/balance-sheet — Balance Sheet: set as-of date → Run
/reports/trial-balance — Trial Balance: set date range → Run
/reports/ar-aging — Accounts Receivable Aging
/reports/ap-aging — Accounts Payable Aging
/reports/tax-summary — Tax/GST summary for a period
/settings — business name, currency, tax settings
/settings/billing — subscription & billing plan

Step-by-step guides (use these when user asks "how do I…"):
Create an invoice manually:
  1. Go to Invoices → click "New Invoice"
  2. Select or type customer name, set invoice date and due date
  3. Add line items: description, quantity, unit price
  4. Click "Save" (saves as Draft) then "Send" to mark it sent
  5. Share the invoice link or download PDF from the invoice detail page

Record invoice payment:
  1. Go to Invoices → click the invoice
  2. Click "Record Payment"
  3. Enter amount, payment date, select bank/cash account → Save
  4. Invoice status updates to Partial or Paid automatically

Create a bill (supplier invoice):
  1. Go to Bills → "New Bill"
  2. Select supplier, set date and due date, add line items → Save
  3. Click "Approve" to mark it ready for payment
  4. Click "Record Payment" when paid

Upload a receipt or document (AI extraction):
  1. Go to Extract (sidebar)
  2. Drag-drop the PDF or image, or click to browse
  3. AI reads the document and fills in the fields automatically
  4. Review the extracted data, correct if needed
  5. Click "Save as Invoice" or "Save as Bill" to create the record

Bank reconciliation:
  1. Go to Reconciliation → select your bank account
  2. Upload a CSV bank statement export from your bank
  3. The app shows bank transactions alongside your journal entries
  4. Match each bank line to a journal entry (or create a new entry)
  5. Click "Complete Reconciliation" when all lines are matched

Add a contact (customer or supplier):
  1. Go to Contacts → "New Contact"
  2. Enter name, select type (Customer / Supplier / Both)
  3. Optionally add email, phone, address, tax number → Save

Create a chart of accounts entry:
  1. Go to Accounts → "New Account"
  2. Enter account code (e.g. 1010), name, type → Save
  3. Account is immediately available for journal entries

Record a manual journal entry:
  1. Go to Transactions → "New Entry"
  2. Set date and description
  3. Add lines: select account, enter debit OR credit amount
  4. Total debits must equal total credits → click "Save"

Run a report:
  1. Go to Reports → click the report name
  2. Set the date range or as-of date
  3. Click "Run" or "Generate" — results display on screen
  4. Use the export button to download as PDF or CSV
`;

const TOOL_DEFINITIONS = `IMPORTANT: You must ONLY output plain text. Never use function calling or structured output.
When you need to perform an action, write a single ACTION line in plain text using this exact format:
TOOL_CALL_\${NONCE}: {"tool":"<name>","args":{...}}

Available actions:
Invoices & Bills:
- create_invoice: {"contactName","date?","dueDate?","lines":[{"description","quantity","unitPrice"}],"notes?"}
- list_invoices: {"status?":"ALL|DRAFT|SENT|PARTIAL|PAID|OVERDUE|VOID","search?","limit?"}
- get_invoice: {"invoiceNumber"}
- send_invoice: {"invoiceNumber"}
- record_invoice_payment: {"invoiceNumber","amount","date?","cashAccountCode?","reference?"}
- void_invoice: {"invoiceNumber","reason?"}
- create_bill: {"contactName","date?","dueDate?","lines":[{"description","quantity","unitPrice"}],"notes?"}
- list_bills: {"status?":"ALL|DRAFT|SENT|PARTIAL|PAID|OVERDUE|VOID","search?","limit?"}
- get_bill: {"billNumber"}
- approve_bill: {"billNumber"}
- record_bill_payment: {"billNumber","amount","date?","cashAccountCode?","reference?"}
- void_bill: {"billNumber","reason?"}
Contacts:
- list_contacts: {"type?":"CUSTOMER|SUPPLIER","search?"}
- create_contact: {"name","type":"CUSTOMER|SUPPLIER|BOTH","email?","phone?","address?","taxNumber?"}
- update_contact: {"name","newName?","email?","phone?","address?","taxNumber?","type?"}
Accounts (Chart of Accounts):
- list_accounts: {"type?":"ASSET|LIABILITY|EQUITY|INCOME|EXPENSE"}
- get_account_balance: {"accountCode"}
- create_account: {"code","name","type":"ASSET|LIABILITY|EQUITY|INCOME|EXPENSE","normalBalance?":"DEBIT|CREDIT","description?"}
Transactions:
- create_journal_entry: {"date?","description","lines":[{"accountCode","debit?","credit?"}]}
- search_transactions: {"query","limit?"}
- void_transaction: {"transactionId","reason?"}
Reports:
- get_profit_and_loss: {"startDate?","endDate?"}
- get_balance_sheet: {"asOfDate?"}
- get_trial_balance: {"startDate?","endDate?"}
- get_ar_aging: {}
- get_ap_aging: {}
Personal Finance Budgets:
- set_budget: {"category","limitAmount","name?","period?":"WEEKLY|MONTHLY|QUARTERLY|YEARLY"} — create or update a single category budget (period defaults to MONTHLY)
- set_budgets: {"budgets":[{"category","limitAmount","name?","period?"},...]} — create or update multiple category budgets at once; use this when the user asks to set several budgets, wants a full budget plan, or asks to readjust existing budgets (e.g. "cut all by 10%", "move 1000 from Transport to Food", "keep total under 30000")
- list_budgets: {} — show current budgets with spending progress
Budget readjustment: always call list_budgets first to get current limits, compute the new values, then call set_budgets. Show before→after numbers in your reply.
CRM — Leads:
- create_crm_lead: {"firstName","lastName","email?","phone?","companyName?","jobTitle?","estimatedValue?","source?":"WEBSITE|REFERRAL|SOCIAL_MEDIA|COLD_OUTREACH|EVENT|ADVERTISING|OTHER","notes?"}
- list_crm_leads: {"status?":"NEW|CONTACTED|QUALIFIED|UNQUALIFIED|CONVERTED","search?","limit?"}
- update_crm_lead_status: {"leadId","status":"NEW|CONTACTED|QUALIFIED|UNQUALIFIED|CONVERTED","notes?"}
CRM — Deals:
- create_crm_deal: {"name","contactName","value?","expectedCloseDate?","stageName?","notes?"}
- list_crm_deals: {"search?","limit?"}
- move_crm_deal: {"dealId","stageName"}
CRM — Activities:
- create_crm_activity: {"type":"CALL|EMAIL|MEETING|NOTE|TASK","subject","notes?","contactName?","dealId?","dueDate?"}
- list_crm_activities: {"contactName?","limit?"}
Recurring Items:
- create_recurring: {"name","amount","type":"INCOME|EXPENSE","frequency":"DAILY|WEEKLY|FORTNIGHTLY|MONTHLY|QUARTERLY|YEARLY","nextDueDate?","category?","description?"}
- list_recurring: {"type?":"INCOME|EXPENSE"}
- mark_recurring_paid: {"recurringId"}
Goals:
- create_goal: {"name","targetAmount","targetDate?","description?"}
- list_goals: {}
- update_goal_progress: {"goalId","currentAmount"}
CRM — Companies:
- create_crm_company: {"name","industry?","website?","phone?","address?","size?":"SOLO|SMALL|MEDIUM|LARGE|ENTERPRISE","notes?"}
- list_crm_companies: {"search?","limit?"}
Watchlists:
- create_watchlist: {"name","category","threshold","period?":"WEEKLY|MONTHLY|QUARTERLY|YEARLY"}
- list_watchlists: {}
Document Extraction:
- extract_document: {"attachmentId"} — extract invoice/bill/receipt data from an uploaded file (use the attachmentId shown in the user message)

Format: TOOL_CALL_\${NONCE}: {"tool":"name","args":{...}}
`;

export function localDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildSystemPrompt(
  orgContext: {
    orgName: string;
    currency: string;
    accounts: { code: string; name: string; type: string }[];
    contacts: { name: string; type: string }[];
  },
  nonce: string,
): string {
  const accountList = orgContext.accounts
    .slice(0, 15)
    .map((a) => `${a.code}:${a.name}`)
    .join(", ");

  const contactList = orgContext.contacts
    .slice(0, 10)
    .map((c) => `${c.name}(${c.type})`)
    .join(", ");

  const today = localDateString();

  // Embed nonce into the tool-call format string. The LLM sees the resolved
  // prefix; injected user text cannot forge tool calls without knowing the nonce.
  const toolDefs = TOOL_DEFINITIONS.replaceAll("${NONCE}", nonce);

  const prompt = `You are an accounting assistant for "${orgContext.orgName}". Currency: ${orgContext.currency}. Today's date: ${today}.
Accounts: ${accountList}
Contacts: ${contactList}
${APP_UI_GUIDE}
${toolDefs}
Rules:
- ALWAYS output plain text only. NEVER use function calling, JSON mode, or structured output.
- When performing an action, write the ACTION line in plain text: TOOL_CALL_\${NONCE}: {"tool":"...","args":{...}}
- When the user asks "how do I…" or wants to do something themselves, give numbered UI steps from the guide above.
- When the user asks you to perform a task directly (create, record, void, list, show), output the ACTION line.
- For UI-only tasks (document upload, bank reconciliation, settings), always provide UI steps — no action exists for these.
- Be concise. Confirm details before creating records.
- IMPORTANT: When the user mentions relative dates (today, yesterday, last week, last month, etc.), resolve them to an explicit YYYY-MM-DD date using today's date above BEFORE passing to any action. Never guess or use a date from your training data.`;

  return prompt.replaceAll("${NONCE}", nonce);
}

export function parseToolCalls(response: string, nonce: string): { text: string; toolCalls: ToolCall[] } {
  const PREFIX = `TOOL_CALL_${nonce}:`;
  const lines = response.split("\n");
  const toolCalls: ToolCall[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(PREFIX)) {
      try {
        const json = trimmed.slice(PREFIX.length).trim();
        const parsed = JSON.parse(json);
        if (parsed.tool && typeof parsed.tool === "string") {
          toolCalls.push({ tool: parsed.tool, args: parsed.args ?? {} });
        }
      } catch {
        textLines.push(line);
      }
    } else {
      textLines.push(line);
    }
  }

  return { text: textLines.join("\n").trim(), toolCalls };
}

export async function executeToolCall(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  toolCall: ToolCall,
): Promise<ToolResult> {
  try {
    switch (toolCall.tool) {
      // Journal entries
      case "create_journal_entry":
        return await toolCreateJournalEntry(db, organisationId, userId, toolCall.args);
      case "search_transactions":
        return await toolSearchTransactions(db, organisationId, toolCall.args);
      case "void_transaction":
        return await toolVoidTransaction(db, organisationId, userId, toolCall.args);
      // Invoices
      case "create_invoice":
        return await toolCreateInvoice(db, organisationId, userId, toolCall.args);
      case "list_invoices":
        return await toolListInvoices(db, organisationId, toolCall.args);
      case "get_invoice":
        return await toolGetInvoice(db, organisationId, toolCall.args);
      case "send_invoice":
        return await toolSendInvoice(db, organisationId, toolCall.args);
      case "record_invoice_payment":
        return await toolRecordInvoicePayment(db, organisationId, userId, toolCall.args);
      case "void_invoice":
        return await toolVoidInvoice(db, organisationId, userId, toolCall.args);
      // Bills
      case "create_bill":
        return await toolCreateBill(db, organisationId, userId, toolCall.args);
      case "list_bills":
        return await toolListBills(db, organisationId, toolCall.args);
      case "get_bill":
        return await toolGetBill(db, organisationId, toolCall.args);
      case "approve_bill":
        return await toolApproveBill(db, organisationId, toolCall.args);
      case "record_bill_payment":
        return await toolRecordBillPayment(db, organisationId, userId, toolCall.args);
      case "void_bill":
        return await toolVoidBill(db, organisationId, userId, toolCall.args);
      // Contacts
      case "list_contacts":
        return await toolListContacts(db, organisationId, toolCall.args);
      case "create_contact":
        return await toolCreateContact(db, organisationId, toolCall.args);
      case "update_contact":
        return await toolUpdateContact(db, organisationId, toolCall.args);
      // Accounts
      case "list_accounts":
        return await toolListAccounts(db, organisationId, toolCall.args);
      case "get_account_balance":
        return await toolGetAccountBalance(db, organisationId, toolCall.args);
      case "create_account":
        return await toolCreateAccount(db, organisationId, toolCall.args);
      // Reports
      case "get_profit_and_loss":
        return await toolGetProfitAndLoss(db, organisationId, toolCall.args);
      case "get_balance_sheet":
        return await toolGetBalanceSheet(db, organisationId, toolCall.args);
      case "get_trial_balance":
        return await toolGetTrialBalance(db, organisationId, toolCall.args);
      case "get_ar_aging":
        return await toolGetArAging(db, organisationId);
      case "get_ap_aging":
        return await toolGetApAging(db, organisationId);
      case "extract_document": {
        const attachmentId = toolCall.args.attachmentId as string | undefined;
        if (!attachmentId) return { tool: "extract_document", success: false, error: "attachmentId is required" };
        const attachment = await db.attachment.findFirst({ where: { id: attachmentId, organisationId } });
        if (!attachment) return { tool: "extract_document", success: false, error: "Attachment not found" };
        await extractionQueue.add("extract", { attachmentId, organisationId, userId });
        return { tool: "extract_document", success: true, data: { attachmentId, status: "queued" } };
      }
      // Personal Finance Budgets
      case "set_budget":
        return await toolSetBudget(db, organisationId, toolCall.args);
      case "set_budgets":
        return await toolSetBudgets(db, organisationId, toolCall.args);
      case "list_budgets":
        return await toolListBudgets(db, organisationId);
      // CRM — Leads
      case "create_crm_lead":
        return await toolCreateCrmLead(db, organisationId, toolCall.args);
      case "list_crm_leads":
        return await toolListCrmLeads(db, organisationId, toolCall.args);
      case "update_crm_lead_status":
        return await toolUpdateCrmLeadStatus(db, organisationId, toolCall.args);
      // CRM — Deals
      case "create_crm_deal":
        return await toolCreateCrmDeal(db, organisationId, toolCall.args);
      case "list_crm_deals":
        return await toolListCrmDeals(db, organisationId, toolCall.args);
      case "move_crm_deal":
        return await toolMoveCrmDeal(db, organisationId, toolCall.args);
      // CRM — Activities
      case "create_crm_activity":
        return await toolCreateCrmActivity(db, organisationId, userId, toolCall.args);
      case "list_crm_activities":
        return await toolListCrmActivities(db, organisationId, toolCall.args);
      // Recurring
      case "create_recurring":
        return await toolCreateRecurring(db, organisationId, toolCall.args);
      case "list_recurring":
        return await toolListRecurring(db, organisationId, toolCall.args);
      case "mark_recurring_paid":
        return await toolMarkRecurringPaid(db, organisationId, toolCall.args);
      // Goals
      case "create_goal":
        return await toolCreateGoal(db, organisationId, toolCall.args);
      case "list_goals":
        return await toolListGoals(db, organisationId);
      case "update_goal_progress":
        return await toolUpdateGoalProgress(db, organisationId, toolCall.args);
      // CRM — Companies
      case "create_crm_company":
        return await toolCreateCrmCompany(db, organisationId, toolCall.args);
      case "list_crm_companies":
        return await toolListCrmCompanies(db, organisationId, toolCall.args);
      // Watchlists
      case "create_watchlist":
        return await toolCreateWatchlist(db, organisationId, toolCall.args);
      case "list_watchlists":
        return await toolListWatchlists(db, organisationId);
      default:
        return { tool: toolCall.tool, success: false, error: `Unknown tool: ${toolCall.tool}` };
    }
  } catch (err) {
    return { tool: toolCall.tool, success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function toolCreateJournalEntry(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const date = (args.date as string) || new Date().toISOString().slice(0, 10);
  const description = (args.description as string) || "Journal entry from chat";
  const lines = args.lines as { accountCode: string; debit?: number | null; credit?: number | null }[];

  if (!lines || lines.length < 2) {
    return { tool: "create_journal_entry", success: false, error: "A journal entry needs at least 2 lines (debit and credit)" };
  }

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return { tool: "create_journal_entry", success: false, error: `Debits ($${totalDebit.toFixed(2)}) must equal credits ($${totalCredit.toFixed(2)})` };
  }

  const accountCodes = lines.map((l) => l.accountCode);
  const accounts = await db.chartAccount.findMany({
    where: { organisationId, code: { in: accountCodes } },
  });

  const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
  for (const line of lines) {
    if (!codeToId.has(line.accountCode)) {
      return { tool: "create_journal_entry", success: false, error: `Account code "${line.accountCode}" not found` };
    }
  }

  // Use the canonical createJournalEntry — enforces balance check at 0.0001 tolerance
  const entry = await createJournalEntry(db, {
    organisationId,
    userId,
    date: new Date(date),
    description,
    source: "MANUAL",
    lines: lines.map((l) => ({
      accountId: codeToId.get(l.accountCode)!,
      debit: l.debit ?? undefined,
      credit: l.credit ?? undefined,
      description,
    })),
  });

  // Re-fetch with account details for the response
  const entryWithAccounts = await db.journalEntry.findUnique({
    where: { id: entry.id },
    include: { lines: { include: { account: true } } },
  });

  return {
    tool: "create_journal_entry",
    success: true,
    data: {
      id: entry.id,
      date: entry.date,
      description: entry.description,
      lines: (entryWithAccounts?.lines ?? []).map((l) => ({
        account: `${l.account.code} - ${l.account.name}`,
        debit: l.debit?.toNumber() ?? null,
        credit: l.credit?.toNumber() ?? null,
      })),
    },
  };
}

async function toolCreateInvoice(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const contactName = args.contactName as string;
  const lines = args.lines as { description: string; quantity: number; unitPrice: number }[];

  if (!contactName) return { tool: "create_invoice", success: false, error: "Contact name is required" };
  if (!lines || lines.length === 0) return { tool: "create_invoice", success: false, error: "At least one line item is required" };

  const contact = await db.contact.findFirst({
    where: { organisationId, name: { contains: contactName, mode: "insensitive" }, type: { in: ["CUSTOMER", "BOTH"] } },
  });
  if (!contact) return { tool: "create_invoice", success: false, error: `Customer "${contactName}" not found. Create them first or check the name.` };

  const date = (args.date as string) || new Date().toISOString().slice(0, 10);
  const dueDate = (args.dueDate as string) || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

  // Use createInvoice + postInvoiceToLedger so all validation and balance checks are enforced
  const invoice = await createInvoice(db, {
    organisationId,
    contactId: contact.id,
    date: new Date(date),
    dueDate: new Date(dueDate),
    notes: (args.notes as string) || undefined,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
  });

  await postInvoiceToLedger(db, invoice.id, organisationId, userId);

  // Mark as SENT (createInvoice creates as DRAFT)
  await db.invoice.update({ where: { id: invoice.id }, data: { status: "SENT" } });

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  return {
    tool: "create_invoice",
    success: true,
    data: {
      id: invoice.id,
      number: invoice.number,
      customer: contact.name,
      date,
      dueDate,
      total: subtotal,
      status: "SENT",
      lineCount: lines.length,
    },
  };
}

async function toolCreateBill(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const contactName = args.contactName as string;
  const lines = args.lines as { description: string; quantity: number; unitPrice: number }[];

  if (!contactName) return { tool: "create_bill", success: false, error: "Contact name is required" };
  if (!lines || lines.length === 0) return { tool: "create_bill", success: false, error: "At least one line item is required" };

  const contact = await db.contact.findFirst({
    where: { organisationId, name: { contains: contactName, mode: "insensitive" }, type: { in: ["SUPPLIER", "BOTH"] } },
  });
  if (!contact) return { tool: "create_bill", success: false, error: `Supplier "${contactName}" not found. Create them first or check the name.` };

  const date = (args.date as string) || new Date().toISOString().slice(0, 10);
  const dueDate = (args.dueDate as string) || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

  // Use createBill + postBillToLedger so all validation and balance checks are enforced
  const bill = await createBill(db, {
    organisationId,
    contactId: contact.id,
    date: new Date(date),
    dueDate: new Date(dueDate),
    notes: (args.notes as string) || undefined,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
  });

  await postBillToLedger(db, bill.id, organisationId, userId);

  // Mark as SENT (createBill creates as DRAFT)
  await db.bill.update({ where: { id: bill.id }, data: { status: "SENT" } });

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  return {
    tool: "create_bill",
    success: true,
    data: {
      id: bill.id,
      number: bill.number,
      supplier: contact.name,
      date,
      dueDate,
      total: subtotal,
      status: "SENT",
      lineCount: lines.length,
    },
  };
}

async function toolGetProfitAndLoss(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const now = new Date();
  const startDate = (args.startDate as string) || `${now.getFullYear()}-01-01`;
  const endDate = (args.endDate as string) || now.toISOString().slice(0, 10);

  const entries = await db.journalLine.findMany({
    where: {
      journalEntry: { organisationId, isVoid: false, date: { gte: new Date(startDate), lte: new Date(endDate) } },
      account: { type: { in: ["INCOME", "EXPENSE"] } },
    },
    include: { account: true },
  });

  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const line of entries) {
    const name = line.account.name;
    const amount = (line.credit?.toNumber() ?? 0) - (line.debit?.toNumber() ?? 0);
    if (line.account.type === "INCOME") {
      income[name] = (income[name] ?? 0) + amount;
    } else {
      expenses[name] = (expenses[name] ?? 0) - amount;
    }
  }

  const totalIncome = Object.values(income).reduce((s, v) => s + v, 0);
  const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);

  return {
    tool: "get_profit_and_loss",
    success: true,
    data: { period: { startDate, endDate }, income, totalIncome, expenses, totalExpenses, netProfit: totalIncome - totalExpenses },
  };
}

async function toolGetBalanceSheet(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const asOfDate = (args.asOfDate as string) || new Date().toISOString().slice(0, 10);

  const entries = await db.journalLine.findMany({
    where: {
      journalEntry: { organisationId, isVoid: false, date: { lte: new Date(asOfDate) } },
      account: { type: { in: ["ASSET", "LIABILITY", "EQUITY"] } },
    },
    include: { account: true },
  });

  const balances: Record<string, Record<string, number>> = { ASSET: {}, LIABILITY: {}, EQUITY: {} };

  for (const line of entries) {
    const type = line.account.type as "ASSET" | "LIABILITY" | "EQUITY";
    const name = line.account.name;
    const debit = line.debit?.toNumber() ?? 0;
    const credit = line.credit?.toNumber() ?? 0;
    const amount = line.account.normalBalance === "DEBIT" ? debit - credit : credit - debit;
    balances[type][name] = (balances[type][name] ?? 0) + amount;
  }

  return {
    tool: "get_balance_sheet",
    success: true,
    data: {
      asOfDate,
      assets: balances.ASSET,
      totalAssets: Object.values(balances.ASSET).reduce((s, v) => s + v, 0),
      liabilities: balances.LIABILITY,
      totalLiabilities: Object.values(balances.LIABILITY).reduce((s, v) => s + v, 0),
      equity: balances.EQUITY,
      totalEquity: Object.values(balances.EQUITY).reduce((s, v) => s + v, 0),
    },
  };
}

async function toolGetTrialBalance(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const now = new Date();
  const startDate = (args.startDate as string) || `${now.getFullYear()}-01-01`;
  const endDate = (args.endDate as string) || now.toISOString().slice(0, 10);

  const entries = await db.journalLine.findMany({
    where: {
      journalEntry: { organisationId, isVoid: false, date: { gte: new Date(startDate), lte: new Date(endDate) } },
    },
    include: { account: true },
  });

  const accounts: Record<string, { debit: number; credit: number }> = {};

  for (const line of entries) {
    const key = `${line.account.code} - ${line.account.name}`;
    if (!accounts[key]) accounts[key] = { debit: 0, credit: 0 };
    accounts[key].debit += line.debit?.toNumber() ?? 0;
    accounts[key].credit += line.credit?.toNumber() ?? 0;
  }

  const totalDebit = Object.values(accounts).reduce((s, v) => s + v.debit, 0);
  const totalCredit = Object.values(accounts).reduce((s, v) => s + v.credit, 0);

  return {
    tool: "get_trial_balance",
    success: true,
    data: { period: { startDate, endDate }, accounts, totalDebit, totalCredit },
  };
}

async function toolGetArAging(db: PrismaClient, organisationId: string): Promise<ToolResult> {
  const invoices = await db.invoice.findMany({
    where: { organisationId, status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
    include: { contact: true },
  });

  const now = new Date();
  const aging = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const details: { customer: string; amount: number; daysOverdue: number }[] = [];

  for (const inv of invoices) {
    const outstanding = inv.totalAmount.toNumber() - inv.amountPaid.toNumber();
    const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000);
    if (days <= 0) aging.current += outstanding;
    else if (days <= 30) aging["1-30"] += outstanding;
    else if (days <= 60) aging["31-60"] += outstanding;
    else if (days <= 90) aging["61-90"] += outstanding;
    else aging["90+"] += outstanding;
    details.push({ customer: inv.contact.name, amount: outstanding, daysOverdue: Math.max(0, days) });
  }

  return { tool: "get_ar_aging", success: true, data: { aging, total: Object.values(aging).reduce((s, v) => s + v, 0), details: details.slice(0, 10) } };
}

async function toolGetApAging(db: PrismaClient, organisationId: string): Promise<ToolResult> {
  const bills = await db.bill.findMany({
    where: { organisationId, status: { in: ["DRAFT", "SENT", "PARTIAL", "OVERDUE"] } },
    include: { contact: true },
  });

  const now = new Date();
  const aging = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const details: { supplier: string; amount: number; daysOverdue: number }[] = [];

  for (const bill of bills) {
    const outstanding = bill.totalAmount.toNumber() - bill.amountPaid.toNumber();
    const days = Math.floor((now.getTime() - bill.dueDate.getTime()) / 86400000);
    if (days <= 0) aging.current += outstanding;
    else if (days <= 30) aging["1-30"] += outstanding;
    else if (days <= 60) aging["31-60"] += outstanding;
    else if (days <= 90) aging["61-90"] += outstanding;
    else aging["90+"] += outstanding;
    details.push({ supplier: bill.contact.name, amount: outstanding, daysOverdue: Math.max(0, days) });
  }

  return { tool: "get_ap_aging", success: true, data: { aging, total: Object.values(aging).reduce((s, v) => s + v, 0), details: details.slice(0, 10) } };
}

async function toolListAccounts(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const where: Prisma.ChartAccountWhereInput = { organisationId, isArchived: false };
  if (args.type) where.type = args.type as Prisma.EnumAccountTypeFilter;

  const accounts = await db.chartAccount.findMany({ where, orderBy: { code: "asc" }, take: 50 });
  return {
    tool: "list_accounts",
    success: true,
    data: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
  };
}

async function toolListContacts(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const where: Prisma.ContactWhereInput = { organisationId, isArchived: false };
  if (args.type) where.type = args.type as Prisma.EnumContactTypeFilter;

  const contacts = await db.contact.findMany({ where, orderBy: { name: "asc" }, take: 50 });
  return {
    tool: "list_contacts",
    success: true,
    data: contacts.map((c) => ({ id: c.id, name: c.name, type: c.type, email: c.email })),
  };
}

async function toolSearchTransactions(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = (args.query as string) || "";
  const limit = Math.min((args.limit as number) || 10, 20);

  const entries = await db.journalEntry.findMany({
    where: { organisationId, isVoid: false, description: { contains: query, mode: "insensitive" } },
    include: { lines: { include: { account: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });

  return {
    tool: "search_transactions",
    success: true,
    data: entries.map((e) => ({
      id: e.id,
      date: e.date,
      description: e.description,
      lines: e.lines.map((l) => ({
        account: `${l.account.code} - ${l.account.name}`,
        debit: l.debit?.toNumber() ?? null,
        credit: l.credit?.toNumber() ?? null,
      })),
    })),
  };
}

async function toolGetAccountBalance(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const accountCode = args.accountCode as string;
  if (!accountCode) return { tool: "get_account_balance", success: false, error: "accountCode is required" };

  const account = await db.chartAccount.findFirst({ where: { organisationId, code: accountCode } });
  if (!account) return { tool: "get_account_balance", success: false, error: `Account "${accountCode}" not found` };

  const lines = await db.journalLine.findMany({
    where: { accountId: account.id, journalEntry: { organisationId, isVoid: false } },
  });

  const totalDebit = lines.reduce((s, l) => s + (l.debit?.toNumber() ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit?.toNumber() ?? 0), 0);
  const balance = account.normalBalance === "DEBIT" ? totalDebit - totalCredit : totalCredit - totalDebit;

  return {
    tool: "get_account_balance",
    success: true,
    data: { code: account.code, name: account.name, type: account.type, balance },
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async function resolveCashAccount(db: PrismaClient, organisationId: string, code?: string): Promise<{ id: string; name: string } | null> {
  if (code) {
    return db.chartAccount.findFirst({ where: { organisationId, code }, select: { id: true, name: true } });
  }
  // Auto-discover: prefer code 1000, then first cash-like asset account
  return (
    (await db.chartAccount.findFirst({ where: { organisationId, code: "1000" }, select: { id: true, name: true } })) ??
    (await db.chartAccount.findFirst({
      where: { organisationId, type: "ASSET", name: { contains: "cash", mode: "insensitive" } },
      select: { id: true, name: true },
    })) ??
    (await db.chartAccount.findFirst({ where: { organisationId, type: "ASSET" }, select: { id: true, name: true }, orderBy: { code: "asc" } }))
  );
}

// ─── Invoice tools ────────────────────────────────────────────────────────────

async function toolListInvoices(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const status = (args.status as string) || "ALL";
  const search = args.search as string | undefined;
  const limit = Math.min((args.limit as number) || 10, 25);
  const now = new Date();

  const where: Prisma.InvoiceWhereInput = {
    organisationId,
    ...(status !== "ALL" && status !== "OVERDUE"
      ? { status: status as InvoiceStatus }
      : status === "OVERDUE"
      ? { dueDate: { lt: now }, status: { in: ["SENT", "PARTIAL"] as InvoiceStatus[] } }
      : {}),
    ...(search ? { OR: [
      { number: { contains: search, mode: "insensitive" as const } },
      { contact: { name: { contains: search, mode: "insensitive" as const } } },
    ]} : {}),
  };

  const invoices = await db.invoice.findMany({
    where,
    include: { contact: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });

  return {
    tool: "list_invoices",
    success: true,
    data: invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      customer: inv.contact.name,
      date: inv.date.toISOString().slice(0, 10),
      dueDate: inv.dueDate.toISOString().slice(0, 10),
      total: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      outstanding: Number(inv.totalAmount) - Number(inv.amountPaid),
      status: inv.status,
    })),
  };
}

async function toolGetInvoice(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.invoiceNumber as string;
  if (!number) return { tool: "get_invoice", success: false, error: "invoiceNumber is required" };

  const invoice = await db.invoice.findFirst({
    where: { organisationId, number: { equals: number, mode: "insensitive" } },
    include: { contact: { select: { name: true } }, lines: true },
  });
  if (!invoice) return { tool: "get_invoice", success: false, error: `Invoice "${number}" not found` };

  return {
    tool: "get_invoice",
    success: true,
    data: {
      id: invoice.id,
      number: invoice.number,
      customer: invoice.contact.name,
      date: invoice.date.toISOString().slice(0, 10),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      status: invoice.status,
      subtotal: Number(invoice.subtotal),
      total: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid),
      outstanding: Number(invoice.totalAmount) - Number(invoice.amountPaid),
      notes: invoice.notes,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        amount: Number(l.amount),
      })),
    },
  };
}

async function toolSendInvoice(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.invoiceNumber as string;
  if (!number) return { tool: "send_invoice", success: false, error: "invoiceNumber is required" };

  const invoice = await db.invoice.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!invoice) return { tool: "send_invoice", success: false, error: `Invoice "${number}" not found` };
  if (invoice.status === "VOID") return { tool: "send_invoice", success: false, error: "Cannot send a voided invoice" };

  await db.invoice.update({ where: { id: invoice.id }, data: { status: "SENT" } });
  return { tool: "send_invoice", success: true, data: { number: invoice.number, status: "SENT" } };
}

async function toolRecordInvoicePayment(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.invoiceNumber as string;
  const amount = args.amount as number;
  if (!number) return { tool: "record_invoice_payment", success: false, error: "invoiceNumber is required" };
  if (!amount || amount <= 0) return { tool: "record_invoice_payment", success: false, error: "amount must be a positive number" };

  const invoice = await db.invoice.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!invoice) return { tool: "record_invoice_payment", success: false, error: `Invoice "${number}" not found` };
  if (invoice.status === "VOID") return { tool: "record_invoice_payment", success: false, error: "Cannot pay a voided invoice" };
  if (invoice.status === "PAID") return { tool: "record_invoice_payment", success: false, error: "Invoice is already fully paid" };

  const cashAccount = await resolveCashAccount(db, organisationId, args.cashAccountCode as string | undefined);
  if (!cashAccount) return { tool: "record_invoice_payment", success: false, error: "No cash/bank account found. Create one first." };

  const outstanding = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  if (amount > outstanding + 0.001) return { tool: "record_invoice_payment", success: false, error: `Payment ($${amount}) exceeds outstanding balance ($${outstanding.toFixed(2)})` };

  const date = args.date ? new Date(args.date as string) : new Date();

  // Use the canonical service function — enforces balance check and correct source/sourceId
  await recordInvoicePayment(db, {
    invoiceId: invoice.id,
    organisationId,
    userId,
    amount,
    cashAccountId: cashAccount.id,
    date,
    reference: args.reference as string | undefined,
  });

  const newPaid = Number(invoice.amountPaid) + amount;
  const newStatus = newPaid >= Number(invoice.totalAmount) - 0.001 ? "PAID" : "PARTIAL";

  return {
    tool: "record_invoice_payment",
    success: true,
    data: { number: invoice.number, amountPaid: amount, newStatus, cashAccount: cashAccount.name },
  };
}

async function toolVoidInvoice(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.invoiceNumber as string;
  if (!number) return { tool: "void_invoice", success: false, error: "invoiceNumber is required" };

  const invoice = await db.invoice.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!invoice) return { tool: "void_invoice", success: false, error: `Invoice "${number}" not found` };
  if (invoice.status === "VOID") return { tool: "void_invoice", success: false, error: "Invoice is already voided" };

  const reason = (args.reason as string) || "Voided via chat";

  // Use canonical voidInvoice — also reverses payment entries, sets voidedAt/voidReason, uses atomic transaction
  await voidInvoice(db, invoice.id, organisationId, userId, reason);

  return { tool: "void_invoice", success: true, data: { number: invoice.number, status: "VOID" } };
}

// ─── Bill tools ───────────────────────────────────────────────────────────────

async function toolListBills(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const status = (args.status as string) || "ALL";
  const search = args.search as string | undefined;
  const limit = Math.min((args.limit as number) || 10, 25);
  const now = new Date();

  const where: Prisma.BillWhereInput = {
    organisationId,
    ...(status !== "ALL" && status !== "OVERDUE"
      ? { status: status as InvoiceStatus }
      : status === "OVERDUE"
      ? { dueDate: { lt: now }, status: { in: ["SENT", "PARTIAL"] as InvoiceStatus[] } }
      : {}),
    ...(search ? { OR: [
      { number: { contains: search, mode: "insensitive" as const } },
      { contact: { name: { contains: search, mode: "insensitive" as const } } },
    ]} : {}),
  };

  const bills = await db.bill.findMany({
    where,
    include: { contact: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });

  return {
    tool: "list_bills",
    success: true,
    data: bills.map((b) => ({
      id: b.id,
      number: b.number,
      supplier: b.contact.name,
      date: b.date.toISOString().slice(0, 10),
      dueDate: b.dueDate.toISOString().slice(0, 10),
      total: Number(b.totalAmount),
      amountPaid: Number(b.amountPaid),
      outstanding: Number(b.totalAmount) - Number(b.amountPaid),
      status: b.status,
    })),
  };
}

async function toolGetBill(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.billNumber as string;
  if (!number) return { tool: "get_bill", success: false, error: "billNumber is required" };

  const bill = await db.bill.findFirst({
    where: { organisationId, number: { equals: number, mode: "insensitive" } },
    include: { contact: { select: { name: true } }, lines: true },
  });
  if (!bill) return { tool: "get_bill", success: false, error: `Bill "${number}" not found` };

  return {
    tool: "get_bill",
    success: true,
    data: {
      id: bill.id,
      number: bill.number,
      supplier: bill.contact.name,
      date: bill.date.toISOString().slice(0, 10),
      dueDate: bill.dueDate.toISOString().slice(0, 10),
      status: bill.status,
      total: Number(bill.totalAmount),
      amountPaid: Number(bill.amountPaid),
      outstanding: Number(bill.totalAmount) - Number(bill.amountPaid),
      notes: bill.notes,
      lines: bill.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        amount: Number(l.amount),
      })),
    },
  };
}

async function toolApproveBill(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.billNumber as string;
  if (!number) return { tool: "approve_bill", success: false, error: "billNumber is required" };

  const bill = await db.bill.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!bill) return { tool: "approve_bill", success: false, error: `Bill "${number}" not found` };
  if (bill.status !== "DRAFT") return { tool: "approve_bill", success: false, error: `Bill is already ${bill.status.toLowerCase()}, not a draft` };

  await db.bill.update({ where: { id: bill.id }, data: { status: "SENT" } });
  return { tool: "approve_bill", success: true, data: { number: bill.number, status: "SENT" } };
}

async function toolRecordBillPayment(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.billNumber as string;
  const amount = args.amount as number;
  if (!number) return { tool: "record_bill_payment", success: false, error: "billNumber is required" };
  if (!amount || amount <= 0) return { tool: "record_bill_payment", success: false, error: "amount must be a positive number" };

  const bill = await db.bill.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!bill) return { tool: "record_bill_payment", success: false, error: `Bill "${number}" not found` };
  if (bill.status === "VOID") return { tool: "record_bill_payment", success: false, error: "Cannot pay a voided bill" };
  if (bill.status === "PAID") return { tool: "record_bill_payment", success: false, error: "Bill is already fully paid" };

  const cashAccount = await resolveCashAccount(db, organisationId, args.cashAccountCode as string | undefined);
  if (!cashAccount) return { tool: "record_bill_payment", success: false, error: "No cash/bank account found. Create one first." };

  const outstanding = Number(bill.totalAmount) - Number(bill.amountPaid);
  if (amount > outstanding + 0.001) return { tool: "record_bill_payment", success: false, error: `Payment ($${amount}) exceeds outstanding balance ($${outstanding.toFixed(2)})` };

  const date = args.date ? new Date(args.date as string) : new Date();

  // Use the canonical service function — enforces balance check, correct source/sourceId
  await recordBillPayment(db, {
    billId: bill.id,
    organisationId,
    userId,
    amount,
    cashAccountId: cashAccount.id,
    date,
    reference: args.reference as string | undefined,
  });

  const newPaid = Number(bill.amountPaid) + amount;
  const newStatus = newPaid >= Number(bill.totalAmount) - 0.001 ? "PAID" : "PARTIAL";

  return {
    tool: "record_bill_payment",
    success: true,
    data: { number: bill.number, amountPaid: amount, newStatus, cashAccount: cashAccount.name },
  };
}

async function toolVoidBill(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const number = args.billNumber as string;
  if (!number) return { tool: "void_bill", success: false, error: "billNumber is required" };

  const bill = await db.bill.findFirst({ where: { organisationId, number: { equals: number, mode: "insensitive" } } });
  if (!bill) return { tool: "void_bill", success: false, error: `Bill "${number}" not found` };
  if (bill.status === "VOID") return { tool: "void_bill", success: false, error: "Bill is already voided" };

  const reason = (args.reason as string) || "Voided via chat";

  // Use canonical voidBill — also reverses payment entries, sets voidedAt/voidReason, uses atomic transaction
  await voidBill(db, bill.id, organisationId, userId, reason);

  return { tool: "void_bill", success: true, data: { number: bill.number, status: "VOID" } };
}

// ─── Contact tools ────────────────────────────────────────────────────────────

async function toolCreateContact(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  const type = args.type as string;
  if (!name) return { tool: "create_contact", success: false, error: "name is required" };
  if (!["CUSTOMER", "SUPPLIER", "BOTH"].includes(type)) return { tool: "create_contact", success: false, error: "type must be CUSTOMER, SUPPLIER, or BOTH" };

  const existing = await db.contact.findFirst({ where: { organisationId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return { tool: "create_contact", success: false, error: `Contact "${name}" already exists` };

  const contact = await db.contact.create({
    data: {
      organisationId,
      name,
      type: type as "CUSTOMER" | "SUPPLIER" | "BOTH",
      email: (args.email as string) || null,
      phone: (args.phone as string) || null,
      address: (args.address as string) || null,
      taxNumber: (args.taxNumber as string) || null,
    },
  });

  return { tool: "create_contact", success: true, data: { id: contact.id, name: contact.name, type: contact.type } };
}

async function toolUpdateContact(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  if (!name) return { tool: "update_contact", success: false, error: "name (current name) is required" };

  const contact = await db.contact.findFirst({ where: { organisationId, name: { equals: name, mode: "insensitive" } } });
  if (!contact) return { tool: "update_contact", success: false, error: `Contact "${name}" not found` };

  const updated = await db.contact.update({
    where: { id: contact.id },
    data: {
      ...(args.newName ? { name: args.newName as string } : {}),
      ...(args.type ? { type: args.type as "CUSTOMER" | "SUPPLIER" | "BOTH" } : {}),
      ...(args.email !== undefined ? { email: (args.email as string) || null } : {}),
      ...(args.phone !== undefined ? { phone: (args.phone as string) || null } : {}),
      ...(args.address !== undefined ? { address: (args.address as string) || null } : {}),
      ...(args.taxNumber !== undefined ? { taxNumber: (args.taxNumber as string) || null } : {}),
    },
  });

  return { tool: "update_contact", success: true, data: { id: updated.id, name: updated.name, type: updated.type } };
}

// ─── Account tools ────────────────────────────────────────────────────────────

async function toolCreateAccount(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const code = args.code as string;
  const name = args.name as string;
  const type = args.type as string;
  if (!code) return { tool: "create_account", success: false, error: "code is required" };
  if (!name) return { tool: "create_account", success: false, error: "name is required" };
  if (!["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].includes(type)) {
    return { tool: "create_account", success: false, error: "type must be ASSET, LIABILITY, EQUITY, INCOME, or EXPENSE" };
  }

  const existing = await db.chartAccount.findUnique({ where: { organisationId_code: { organisationId, code } } });
  if (existing) return { tool: "create_account", success: false, error: `Account code "${code}" already exists` };

  // Infer normalBalance if not provided
  const normalBalance = (args.normalBalance as string) || (["ASSET", "EXPENSE"].includes(type) ? "DEBIT" : "CREDIT");

  const account = await db.chartAccount.create({
    data: {
      organisationId,
      code,
      name,
      type: type as "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE",
      normalBalance: normalBalance as "DEBIT" | "CREDIT",
      description: (args.description as string) || null,
    },
  });

  return { tool: "create_account", success: true, data: { code: account.code, name: account.name, type: account.type } };
}

// ─── Transaction void ─────────────────────────────────────────────────────────

async function toolVoidTransaction(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const id = args.transactionId as string;
  if (!id) return { tool: "void_transaction", success: false, error: "transactionId is required" };

  const entry = await db.journalEntry.findFirst({ where: { id, organisationId }, include: { lines: true } });
  if (!entry) return { tool: "void_transaction", success: false, error: `Transaction "${id}" not found` };
  if (entry.isVoid) return { tool: "void_transaction", success: false, error: "Transaction is already voided" };

  const reason = (args.reason as string) || "Voided via chat";

  // Use canonical voidJournalEntry — atomic transaction, sets voidedAt/voidReason
  await voidJournalEntry(db, entry.id, organisationId, userId, reason);

  return { tool: "void_transaction", success: true, data: { id: entry.id, description: entry.description } };
}

async function toolSetBudget(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const category = args.category as string;
  const limitAmount = Number(args.limitAmount);
  if (!category || !limitAmount || limitAmount <= 0) {
    return { tool: "set_budget", success: false, error: "category and a positive limitAmount are required" };
  }
  const name = (args.name as string | undefined) ?? category;
  const period = (["WEEKLY","MONTHLY","QUARTERLY","YEARLY"].includes(args.period as string) ? args.period as string : "MONTHLY") as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

  const existing = await db.budget.findFirst({ where: { organisationId, category } });
  let budget;
  if (existing) {
    budget = await db.budget.update({ where: { id: existing.id }, data: { name, limitAmount: new Prisma.Decimal(limitAmount), period, isArchived: false } });
  } else {
    budget = await db.budget.create({ data: { organisationId, name, category, limitAmount: new Prisma.Decimal(limitAmount), period } });
  }
  return { tool: "set_budget", success: true, data: { category: budget.category, limitAmount: Number(budget.limitAmount), period: budget.period, action: existing ? "updated" : "created" } };
}

async function toolSetBudgets(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const list = args.budgets as Array<{ category: string; limitAmount: number; name?: string; period?: string }> | undefined;
  if (!Array.isArray(list) || list.length === 0) {
    return { tool: "set_budgets", success: false, error: "budgets array is required" };
  }

  const results: Array<{ category: string; limitAmount: number; action: string }> = [];
  for (const item of list) {
    const r = await toolSetBudget(db, organisationId, item as Record<string, unknown>);
    if (r.success && r.data) {
      const d = r.data as { category: string; limitAmount: number; action: string };
      results.push({ category: d.category, limitAmount: d.limitAmount, action: d.action });
    }
  }
  return { tool: "set_budgets", success: true, data: { saved: results.length, budgets: results } };
}

async function toolListBudgets(
  db: PrismaClient,
  organisationId: string,
): Promise<ToolResult> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const budgets = await db.budget.findMany({
    where: { organisationId, isArchived: false },
    orderBy: { createdAt: "asc" },
  });

  const thisMonthTxns = await db.statementTransaction.findMany({
    where: { organisationId, isExcluded: false, type: "DEBIT", date: { gte: monthStart } },
    select: { category: true, amount: true },
  });

  const spendByCategory: Record<string, number> = {};
  for (const t of thisMonthTxns) {
    const c = t.category ?? "Other";
    spendByCategory[c] = (spendByCategory[c] ?? 0) + Number(t.amount);
  }

  const result = budgets.map((b) => {
    const spent = spendByCategory[b.category] ?? 0;
    const limit = Number(b.limitAmount);
    return { category: b.category, limit, spent, remaining: Math.max(0, limit - spent), period: b.period };
  });

  return { tool: "list_budgets", success: true, data: { budgets: result } };
}

// ─── CRM — Lead tools ─────────────────────────────────────────────────────────

async function toolCreateCrmLead(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const firstName = args.firstName as string;
  const lastName = args.lastName as string;
  if (!firstName || !lastName) return { tool: "create_crm_lead", success: false, error: "firstName and lastName are required" };

  const validSources = ["WEBSITE","REFERRAL","SOCIAL_MEDIA","COLD_OUTREACH","EVENT","ADVERTISING","OTHER"];
  const source = validSources.includes(args.source as string) ? (args.source as CrmLeadSource) : "OTHER";

  const lead = await db.crmLead.create({
    data: {
      organisationId,
      firstName,
      lastName,
      email: (args.email as string) || null,
      phone: (args.phone as string) || null,
      companyName: (args.companyName as string) || null,
      jobTitle: (args.jobTitle as string) || null,
      estimatedValue: args.estimatedValue ? new Prisma.Decimal(args.estimatedValue as number) : null,
      source,
      notes: (args.notes as string) || null,
      status: "NEW",
    },
  });

  return { tool: "create_crm_lead", success: true, data: { id: lead.id, name: `${lead.firstName} ${lead.lastName}`, status: lead.status, source: lead.source } };
}

async function toolListCrmLeads(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const validStatuses: CrmLeadStatus[] = ["NEW","CONTACTED","QUALIFIED","UNQUALIFIED","CONVERTED"];
  const status = validStatuses.includes(args.status as CrmLeadStatus) ? (args.status as CrmLeadStatus) : undefined;
  const search = args.search as string | undefined;
  const limit = Math.min((args.limit as number) || 15, 30);

  const leads = await db.crmLead.findMany({
    where: {
      organisationId,
      ...(status ? { status } : {}),
      ...(search ? { OR: [
        { firstName: { contains: search, mode: "insensitive" as const } },
        { lastName: { contains: search, mode: "insensitive" as const } },
        { companyName: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ]} : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    tool: "list_crm_leads",
    success: true,
    data: leads.map((l) => ({
      id: l.id,
      name: `${l.firstName} ${l.lastName}`,
      company: l.companyName,
      email: l.email,
      status: l.status,
      source: l.source,
      estimatedValue: l.estimatedValue ? Number(l.estimatedValue) : null,
    })),
  };
}

async function toolUpdateCrmLeadStatus(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const leadId = args.leadId as string;
  const status = args.status as CrmLeadStatus;
  if (!leadId) return { tool: "update_crm_lead_status", success: false, error: "leadId is required" };
  const validStatuses: CrmLeadStatus[] = ["NEW","CONTACTED","QUALIFIED","UNQUALIFIED","CONVERTED"];
  if (!validStatuses.includes(status)) return { tool: "update_crm_lead_status", success: false, error: "status must be NEW|CONTACTED|QUALIFIED|UNQUALIFIED|CONVERTED" };

  const lead = await db.crmLead.findFirst({ where: { id: leadId, organisationId } });
  if (!lead) return { tool: "update_crm_lead_status", success: false, error: `Lead "${leadId}" not found` };

  const updated = await db.crmLead.update({
    where: { id: leadId },
    data: {
      status,
      ...(args.notes ? { notes: args.notes as string } : {}),
      ...(status === "CONVERTED" ? { convertedAt: new Date() } : {}),
    },
  });

  return { tool: "update_crm_lead_status", success: true, data: { id: updated.id, name: `${updated.firstName} ${updated.lastName}`, status: updated.status } };
}

// ─── CRM — Deal tools ─────────────────────────────────────────────────────────

async function toolCreateCrmDeal(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  const contactName = args.contactName as string;
  if (!name) return { tool: "create_crm_deal", success: false, error: "name is required" };
  if (!contactName) return { tool: "create_crm_deal", success: false, error: "contactName is required" };

  const contact = await db.contact.findFirst({
    where: { organisationId, name: { contains: contactName, mode: "insensitive" } },
  });
  if (!contact) return { tool: "create_crm_deal", success: false, error: `Contact "${contactName}" not found — create them first` };

  // Find default pipeline
  const pipeline = await db.crmPipeline.findFirst({
    where: { organisationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline || pipeline.stages.length === 0) return { tool: "create_crm_deal", success: false, error: "No CRM pipeline found. Create one from the CRM settings page first." };

  let stage = pipeline.stages[0];
  if (args.stageName) {
    const named = pipeline.stages.find((s) => s.name.toLowerCase().includes((args.stageName as string).toLowerCase()));
    if (named) stage = named;
  }

  const deal = await db.crmDeal.create({
    data: {
      organisationId,
      name,
      contactId: contact.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      value: args.value ? new Prisma.Decimal(args.value as number) : new Prisma.Decimal(0),
      expectedCloseDate: args.expectedCloseDate ? new Date(args.expectedCloseDate as string) : null,
      probability: stage.probability,
    },
  });

  return { tool: "create_crm_deal", success: true, data: { id: deal.id, name: deal.name, contact: contact.name, stage: stage.name, value: Number(deal.value) } };
}

async function toolListCrmDeals(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const search = args.search as string | undefined;
  const limit = Math.min((args.limit as number) || 15, 30);

  const deals = await db.crmDeal.findMany({
    where: {
      organisationId,
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { contact: { name: { contains: search, mode: "insensitive" as const } } },
      ]} : {}),
    },
    include: { contact: { select: { name: true } }, stage: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    tool: "list_crm_deals",
    success: true,
    data: deals.map((d) => ({
      id: d.id,
      name: d.name,
      contact: d.contact.name,
      stage: d.stage.name,
      value: Number(d.value),
      expectedCloseDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
      probability: d.probability,
    })),
  };
}

async function toolMoveCrmDeal(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const dealId = args.dealId as string;
  const stageName = args.stageName as string;
  if (!dealId) return { tool: "move_crm_deal", success: false, error: "dealId is required" };
  if (!stageName) return { tool: "move_crm_deal", success: false, error: "stageName is required" };

  const deal = await db.crmDeal.findFirst({ where: { id: dealId, organisationId }, include: { pipeline: { include: { stages: true } } } });
  if (!deal) return { tool: "move_crm_deal", success: false, error: `Deal "${dealId}" not found` };

  const stage = deal.pipeline.stages.find((s) => s.name.toLowerCase().includes(stageName.toLowerCase()));
  if (!stage) return { tool: "move_crm_deal", success: false, error: `Stage "${stageName}" not found in pipeline "${deal.pipeline.name}"` };

  const updated = await db.crmDeal.update({ where: { id: dealId }, data: { stageId: stage.id, probability: stage.probability } });
  return { tool: "move_crm_deal", success: true, data: { id: updated.id, name: deal.name, newStage: stage.name } };
}

// ─── CRM — Activity tools ─────────────────────────────────────────────────────

async function toolCreateCrmActivity(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const validTypes: CrmActivityType[] = ["CALL","EMAIL","MEETING","NOTE","TASK"];
  const type = args.type as CrmActivityType;
  const subject = args.subject as string;
  if (!validTypes.includes(type)) return { tool: "create_crm_activity", success: false, error: "type must be CALL|EMAIL|MEETING|NOTE|TASK" };
  if (!subject) return { tool: "create_crm_activity", success: false, error: "subject is required" };

  let contactId: string | null = null;
  if (args.contactName) {
    const contact = await db.contact.findFirst({ where: { organisationId, name: { contains: args.contactName as string, mode: "insensitive" } } });
    if (contact) contactId = contact.id;
  }

  let dealId: string | null = null;
  if (args.dealId) {
    const deal = await db.crmDeal.findFirst({ where: { id: args.dealId as string, organisationId } });
    if (deal) dealId = deal.id;
  }

  const activity = await db.crmActivity.create({
    data: {
      organisationId,
      type,
      subject,
      notes: (args.notes as string) || null,
      contactId,
      dealId,
      dueDate: args.dueDate ? new Date(args.dueDate as string) : null,
      createdById: userId,
    },
  });

  return { tool: "create_crm_activity", success: true, data: { id: activity.id, type: activity.type, subject: activity.subject, dueDate: activity.dueDate?.toISOString().slice(0, 10) ?? null } };
}

async function toolListCrmActivities(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limit = Math.min((args.limit as number) || 15, 30);

  let contactId: string | undefined;
  if (args.contactName) {
    const contact = await db.contact.findFirst({ where: { organisationId, name: { contains: args.contactName as string, mode: "insensitive" } } });
    if (contact) contactId = contact.id;
  }

  const activities = await db.crmActivity.findMany({
    where: { organisationId, ...(contactId ? { contactId } : {}) },
    include: { contact: { select: { name: true } }, deal: { select: { name: true } } },
    orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: limit,
  });

  return {
    tool: "list_crm_activities",
    success: true,
    data: activities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      contact: a.contact?.name ?? null,
      deal: a.deal?.name ?? null,
      dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null,
      completed: !!a.completedAt,
    })),
  };
}

// ─── Recurring tools ──────────────────────────────────────────────────────────

function nextDueDateFromFrequency(from: Date, frequency: RecurringFrequency): Date {
  const d = new Date(from);
  switch (frequency) {
    case "DAILY":        d.setDate(d.getDate() + 1); break;
    case "WEEKLY":       d.setDate(d.getDate() + 7); break;
    case "FORTNIGHTLY":  d.setDate(d.getDate() + 14); break;
    case "MONTHLY":      d.setMonth(d.getMonth() + 1); break;
    case "QUARTERLY":    d.setMonth(d.getMonth() + 3); break;
    case "YEARLY":       d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

async function toolCreateRecurring(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  const amount = Number(args.amount);
  const validTypes: RecurringType[] = ["INCOME", "EXPENSE"];
  const validFreqs: RecurringFrequency[] = ["DAILY","WEEKLY","FORTNIGHTLY","MONTHLY","QUARTERLY","YEARLY"];
  const type = validTypes.includes(args.type as RecurringType) ? (args.type as RecurringType) : null;
  const frequency = validFreqs.includes(args.frequency as RecurringFrequency) ? (args.frequency as RecurringFrequency) : "MONTHLY";

  if (!name) return { tool: "create_recurring", success: false, error: "name is required" };
  if (!amount || amount <= 0) return { tool: "create_recurring", success: false, error: "amount must be a positive number" };
  if (!type) return { tool: "create_recurring", success: false, error: "type must be INCOME or EXPENSE" };

  const nextDueDate = args.nextDueDate ? new Date(args.nextDueDate as string) : new Date();

  const item = await db.recurringItem.create({
    data: {
      organisationId,
      name,
      amount: new Prisma.Decimal(amount),
      type,
      frequency,
      nextDueDate,
      category: (args.category as string) || null,
      description: (args.description as string) || null,
      isActive: true,
    },
  });

  return { tool: "create_recurring", success: true, data: { id: item.id, name: item.name, amount: Number(item.amount), type: item.type, frequency: item.frequency, nextDueDate: item.nextDueDate.toISOString().slice(0, 10) } };
}

async function toolListRecurring(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const validTypes: RecurringType[] = ["INCOME", "EXPENSE"];
  const type = validTypes.includes(args.type as RecurringType) ? (args.type as RecurringType) : undefined;

  const items = await db.recurringItem.findMany({
    where: { organisationId, isActive: true, ...(type ? { type } : {}) },
    orderBy: { nextDueDate: "asc" },
  });

  return {
    tool: "list_recurring",
    success: true,
    data: items.map((i) => ({
      id: i.id,
      name: i.name,
      amount: Number(i.amount),
      type: i.type,
      frequency: i.frequency,
      category: i.category,
      nextDueDate: i.nextDueDate.toISOString().slice(0, 10),
      lastPaidAt: i.lastPaidAt?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

async function toolMarkRecurringPaid(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const id = args.recurringId as string;
  if (!id) return { tool: "mark_recurring_paid", success: false, error: "recurringId is required" };

  const item = await db.recurringItem.findFirst({ where: { id, organisationId } });
  if (!item) return { tool: "mark_recurring_paid", success: false, error: `Recurring item "${id}" not found` };

  const newNextDueDate = nextDueDateFromFrequency(item.nextDueDate, item.frequency);

  const updated = await db.recurringItem.update({
    where: { id },
    data: { lastPaidAt: new Date(), nextDueDate: newNextDueDate },
  });

  return { tool: "mark_recurring_paid", success: true, data: { name: updated.name, lastPaidAt: updated.lastPaidAt?.toISOString().slice(0, 10), nextDueDate: updated.nextDueDate.toISOString().slice(0, 10) } };
}

// ─── Goal tools ───────────────────────────────────────────────────────────────

async function toolCreateGoal(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  const targetAmount = Number(args.targetAmount);
  if (!name) return { tool: "create_goal", success: false, error: "name is required" };
  if (!targetAmount || targetAmount <= 0) return { tool: "create_goal", success: false, error: "targetAmount must be a positive number" };

  const goal = await db.goal.create({
    data: {
      organisationId,
      name,
      targetAmount: new Prisma.Decimal(targetAmount),
      targetDate: args.targetDate ? new Date(args.targetDate as string) : null,
      description: (args.description as string) || null,
      status: "ACTIVE",
    },
  });

  return { tool: "create_goal", success: true, data: { id: goal.id, name: goal.name, targetAmount: Number(goal.targetAmount), targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null } };
}

async function toolListGoals(
  db: PrismaClient,
  organisationId: string,
): Promise<ToolResult> {
  const goals = await db.goal.findMany({
    where: { organisationId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
  });

  return {
    tool: "list_goals",
    success: true,
    data: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: Number(g.targetAmount),
      currentAmount: Number(g.currentAmount),
      progress: Math.min(100, Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100)),
      targetDate: g.targetDate?.toISOString().slice(0, 10) ?? null,
      status: g.status,
    })),
  };
}

async function toolUpdateGoalProgress(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const goalId = args.goalId as string;
  const currentAmount = Number(args.currentAmount);
  if (!goalId) return { tool: "update_goal_progress", success: false, error: "goalId is required" };
  if (isNaN(currentAmount) || currentAmount < 0) return { tool: "update_goal_progress", success: false, error: "currentAmount must be a non-negative number" };

  const goal = await db.goal.findFirst({ where: { id: goalId, organisationId } });
  if (!goal) return { tool: "update_goal_progress", success: false, error: `Goal "${goalId}" not found` };

  const newStatus: GoalStatus = currentAmount >= Number(goal.targetAmount) ? "COMPLETED" : "ACTIVE";

  const updated = await db.goal.update({
    where: { id: goalId },
    data: { currentAmount: new Prisma.Decimal(currentAmount), status: newStatus },
  });

  return {
    tool: "update_goal_progress",
    success: true,
    data: {
      name: updated.name,
      currentAmount: Number(updated.currentAmount),
      targetAmount: Number(updated.targetAmount),
      progress: Math.min(100, Math.round((Number(updated.currentAmount) / Number(updated.targetAmount)) * 100)),
      status: updated.status,
    },
  };
}

// ─── CRM — Company tools ──────────────────────────────────────────────────────

async function toolCreateCrmCompany(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  if (!name) return { tool: "create_crm_company", success: false, error: "name is required" };

  const validSizes = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"];
  const size = validSizes.includes(args.size as string) ? (args.size as "SOLO" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE") : "SMALL";

  const company = await db.crmCompany.create({
    data: {
      organisationId,
      name,
      industry: (args.industry as string) || null,
      website: (args.website as string) || null,
      phone: (args.phone as string) || null,
      address: (args.address as string) || null,
      size,
      notes: (args.notes as string) || null,
    },
  });

  return { tool: "create_crm_company", success: true, data: { id: company.id, name: company.name, industry: company.industry, size: company.size } };
}

async function toolListCrmCompanies(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const search = args.search as string | undefined;
  const limit = Math.min((args.limit as number) || 15, 30);

  const companies = await db.crmCompany.findMany({
    where: {
      organisationId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    include: { _count: { select: { deals: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    tool: "list_crm_companies",
    success: true,
    data: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      size: c.size,
      phone: c.phone,
      website: c.website,
      dealCount: c._count.deals,
    })),
  };
}

// ─── Watchlist tools ──────────────────────────────────────────────────────────

async function toolCreateWatchlist(
  db: PrismaClient,
  organisationId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const name = args.name as string;
  const category = args.category as string;
  const threshold = Number(args.threshold);
  if (!name) return { tool: "create_watchlist", success: false, error: "name is required" };
  if (!category) return { tool: "create_watchlist", success: false, error: "category is required" };
  if (!threshold || threshold <= 0) return { tool: "create_watchlist", success: false, error: "threshold must be a positive number" };

  const validPeriods = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
  const period = validPeriods.includes(args.period as string) ? (args.period as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY") : "MONTHLY";

  const watchlist = await db.watchlist.create({
    data: {
      organisationId,
      name,
      category,
      threshold: new Prisma.Decimal(threshold),
      period,
      isActive: true,
    },
  });

  return { tool: "create_watchlist", success: true, data: { id: watchlist.id, name: watchlist.name, category: watchlist.category, threshold: Number(watchlist.threshold), period: watchlist.period } };
}

async function toolListWatchlists(
  db: PrismaClient,
  organisationId: string,
): Promise<ToolResult> {
  const watchlists = await db.watchlist.findMany({
    where: { organisationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    tool: "list_watchlists",
    success: true,
    data: watchlists.map((w) => ({
      id: w.id,
      name: w.name,
      category: w.category,
      threshold: Number(w.threshold),
      period: w.period,
    })),
  };
}

export async function buildChatMessages(
  db: PrismaClient,
  params: {
    organisationId: string;
    conversationId: string;
    userMessage: string;
    attachmentId?: string;
  },
): Promise<{ messages: { role: string; content: string }[]; nonce: string }> {
  const nonce = randomBytes(8).toString("hex");

  const org = await db.organisation.findUniqueOrThrow({
    where: { id: params.organisationId },
  });

  const accounts = await db.chartAccount.findMany({
    where: { organisationId: params.organisationId, isArchived: false },
    orderBy: { code: "asc" },
    take: 30,
  });

  const contacts = await db.contact.findMany({
    where: { organisationId: params.organisationId, isArchived: false },
    orderBy: { name: "asc" },
    take: 20,
  });

  const history = await db.chatMessage.findMany({
    where: {
      conversationId: params.conversationId,
      // Scoped to org to prevent cross-tenant history leaks if conversationId is manipulated
      conversation: { organisationId: params.organisationId },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  history.reverse();

  const systemPrompt = buildSystemPrompt(
    {
      orgName: org.name,
      currency: org.currency,
      accounts: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
      contacts: contacts.map((c) => ({ name: c.name, type: c.type })),
    },
    nonce,
  );

  const messages = [
    { role: "system", content: systemPrompt },
    // Skip empty assistant messages — Gemini rejects parts with empty text
    ...history.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.attachmentId ? `[User attached a file (attachmentId: ${params.attachmentId})]\n\n${params.userMessage}` : params.userMessage },
  ];

  return { messages, nonce };
}

