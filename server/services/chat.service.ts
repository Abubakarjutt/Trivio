import { type PrismaClient, Prisma, InvoiceStatus } from "@prisma/client";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

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

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
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

const TOOL_DEFINITIONS = `Tools (use TOOL_CALL format to invoke):
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

Format: TOOL_CALL: {"tool":"name","args":{...}}
`;

export function localDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildSystemPrompt(orgContext: {
  orgName: string;
  currency: string;
  accounts: { code: string; name: string; type: string }[];
  contacts: { name: string; type: string }[];
}): string {
  const accountList = orgContext.accounts
    .slice(0, 15)
    .map((a) => `${a.code}:${a.name}`)
    .join(", ");

  const contactList = orgContext.contacts
    .slice(0, 10)
    .map((c) => `${c.name}(${c.type})`)
    .join(", ");

  const today = localDateString();

  return `You are an accounting assistant for "${orgContext.orgName}". Currency: ${orgContext.currency}. Today's date: ${today}.
Accounts: ${accountList}
Contacts: ${contactList}
${APP_UI_GUIDE}
${TOOL_DEFINITIONS}
Rules:
- When the user asks "how do I…" or wants to do something themselves, give numbered UI steps from the guide above.
- When the user asks you to perform a task directly (create, record, void, list, show), use the tools.
- For UI-only tasks (document upload, bank reconciliation, settings), always provide UI steps — no tool exists for these.
- Be concise. Confirm details before creating records.
- IMPORTANT: When the user mentions relative dates (today, yesterday, last week, last month, etc.), resolve them to an explicit YYYY-MM-DD date using today's date above BEFORE passing to any tool. Never guess or use a date from your training data.`;
}

export function parseToolCalls(response: string): { text: string; toolCalls: ToolCall[] } {
  const lines = response.split("\n");
  const toolCalls: ToolCall[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("TOOL_CALL:")) {
      try {
        const json = trimmed.slice("TOOL_CALL:".length).trim();
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
        return await toolCreateJournalEntry(db, organisationId, toolCall.args);
      case "search_transactions":
        return await toolSearchTransactions(db, organisationId, toolCall.args);
      case "void_transaction":
        return await toolVoidTransaction(db, organisationId, userId, toolCall.args);
      // Invoices
      case "create_invoice":
        return await toolCreateInvoice(db, organisationId, toolCall.args);
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
        return await toolCreateBill(db, organisationId, toolCall.args);
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
      case "extract_document":
        return { tool: toolCall.tool, success: true, data: { message: "Document extraction queued. Results will appear shortly." } };
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

  const entry = await db.journalEntry.create({
    data: {
      organisationId,
      date: new Date(date),
      description,
      source: "MANUAL",
      lines: {
        create: lines.map((l) => ({
          accountId: codeToId.get(l.accountCode)!,
          debit: l.debit ? new Prisma.Decimal(l.debit) : null,
          credit: l.credit ? new Prisma.Decimal(l.credit) : null,
          description,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  });

  return {
    tool: "create_journal_entry",
    success: true,
    data: {
      id: entry.id,
      date: entry.date,
      description: entry.description,
      lines: entry.lines.map((l) => ({
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

  const lastInvoice = await db.invoice.findFirst({
    where: { organisationId },
    orderBy: { number: "desc" },
  });
  const nextNum = lastInvoice ? `INV-${String(parseInt(lastInvoice.number.replace(/\D/g, "") || "0") + 1).padStart(4, "0")}` : "INV-0001";

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const arAccount = await db.chartAccount.findFirst({
    where: { organisationId, code: "1200" },
  }) ?? await db.chartAccount.findFirst({
    where: { organisationId, type: "ASSET", name: { contains: "receivable", mode: "insensitive" } },
  });
  const salesAccount = await db.chartAccount.findFirst({
    where: { organisationId, code: "4000" },
  }) ?? await db.chartAccount.findFirst({
    where: { organisationId, type: "INCOME" },
  });

  if (!arAccount || !salesAccount) {
    return { tool: "create_invoice", success: false, error: "Missing Accounts Receivable or Sales account. Set up your chart of accounts first." };
  }

  const journalEntry = await db.journalEntry.create({
    data: {
      organisationId,
      date: new Date(date),
      description: `Invoice ${nextNum} - ${contactName}`,
      source: "INVOICE",
      lines: {
        create: [
          { accountId: arAccount.id, debit: new Prisma.Decimal(subtotal), credit: null, description: `Invoice ${nextNum}` },
          { accountId: salesAccount.id, debit: null, credit: new Prisma.Decimal(subtotal), description: `Invoice ${nextNum}` },
        ],
      },
    },
  });

  const invoice = await db.invoice.create({
    data: {
      organisationId,
      contactId: contact.id,
      number: nextNum,
      date: new Date(date),
      dueDate: new Date(dueDate),
      status: "SENT",
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(subtotal),
      notes: (args.notes as string) || null,
      journalEntryId: journalEntry.id,
      lines: {
        create: lines.map((l, i) => ({
          description: l.description,
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(l.unitPrice),
          amount: new Prisma.Decimal(l.quantity * l.unitPrice),
          taxAmount: new Prisma.Decimal(0),
          sortOrder: i,
        })),
      },
    },
    include: { contact: true, lines: true },
  });

  return {
    tool: "create_invoice",
    success: true,
    data: {
      id: invoice.id,
      number: invoice.number,
      customer: invoice.contact.name,
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

  const lastBill = await db.bill.findFirst({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
  });
  const nextNum = lastBill?.number ? `BILL-${String(parseInt(lastBill.number.replace(/\D/g, "") || "0") + 1).padStart(4, "0")}` : "BILL-0001";

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const apAccount = await db.chartAccount.findFirst({
    where: { organisationId, code: "2100" },
  }) ?? await db.chartAccount.findFirst({
    where: { organisationId, type: "LIABILITY", name: { contains: "payable", mode: "insensitive" } },
  });
  const expenseAccount = await db.chartAccount.findFirst({
    where: { organisationId, code: "5000" },
  }) ?? await db.chartAccount.findFirst({
    where: { organisationId, type: "EXPENSE" },
  });

  if (!apAccount || !expenseAccount) {
    return { tool: "create_bill", success: false, error: "Missing Accounts Payable or Expense account. Set up your chart of accounts first." };
  }

  const journalEntry = await db.journalEntry.create({
    data: {
      organisationId,
      date: new Date(date),
      description: `Bill ${nextNum} - ${contactName}`,
      source: "BILL",
      lines: {
        create: [
          { accountId: expenseAccount.id, debit: new Prisma.Decimal(subtotal), credit: null, description: `Bill ${nextNum}` },
          { accountId: apAccount.id, debit: null, credit: new Prisma.Decimal(subtotal), description: `Bill ${nextNum}` },
        ],
      },
    },
  });

  const bill = await db.bill.create({
    data: {
      organisationId,
      contactId: contact.id,
      number: nextNum,
      date: new Date(date),
      dueDate: new Date(dueDate),
      status: "SENT",
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(subtotal),
      notes: (args.notes as string) || null,
      journalEntryId: journalEntry.id,
      lines: {
        create: lines.map((l, i) => ({
          description: l.description,
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(l.unitPrice),
          amount: new Prisma.Decimal(l.quantity * l.unitPrice),
          taxAmount: new Prisma.Decimal(0),
          sortOrder: i,
        })),
      },
    },
    include: { contact: true, lines: true },
  });

  return {
    tool: "create_bill",
    success: true,
    data: {
      id: bill.id,
      number: bill.number,
      supplier: bill.contact.name,
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
    where: { accountId: account.id, journalEntry: { isVoid: false } },
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

  const arAccount = await db.chartAccount.findFirst({ where: { organisationId, code: "1200" } })
    ?? await db.chartAccount.findFirst({ where: { organisationId, type: "ASSET", name: { contains: "receivable", mode: "insensitive" } } });
  if (!arAccount) return { tool: "record_invoice_payment", success: false, error: "Accounts Receivable account not found" };

  const outstanding = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  if (amount > outstanding + 0.001) return { tool: "record_invoice_payment", success: false, error: `Payment ($${amount}) exceeds outstanding balance ($${outstanding.toFixed(2)})` };

  const date = args.date ? new Date(args.date as string) : new Date();
  const reference = args.reference as string | undefined;

  await db.journalEntry.create({
    data: {
      organisationId,
      date,
      description: `Payment: ${invoice.number}`,
      reference: reference ?? invoice.number,
      source: "INVOICE",
      sourceId: invoice.id,
      lines: {
        create: [
          { accountId: cashAccount.id, debit: new Prisma.Decimal(amount), description: `Payment received: ${invoice.number}` },
          { accountId: arAccount.id, credit: new Prisma.Decimal(amount), description: `AR cleared: ${invoice.number}` },
        ],
      },
    },
  });

  const newPaid = Number(invoice.amountPaid) + amount;
  const newStatus = newPaid >= Number(invoice.totalAmount) - 0.001 ? "PAID" : "PARTIAL";
  await db.invoice.update({ where: { id: invoice.id }, data: { amountPaid: new Prisma.Decimal(newPaid), status: newStatus } });

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

  // Reverse the journal entry if one exists
  if (invoice.journalEntryId) {
    const original = await db.journalEntry.findUnique({
      where: { id: invoice.journalEntryId },
      include: { lines: true },
    });
    if (original && !original.isVoid) {
      await db.journalEntry.create({
        data: {
          organisationId,
          date: new Date(),
          description: `REVERSAL: ${original.description} — ${reason}`,
          source: "MANUAL",
          lines: {
            create: original.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: `Reversal: ${l.description ?? ""}`,
            })),
          },
        },
      });
      await db.journalEntry.update({ where: { id: original.id }, data: { isVoid: true } });
    }
  }

  await db.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
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

  const apAccount = await db.chartAccount.findFirst({ where: { organisationId, code: "2100" } })
    ?? await db.chartAccount.findFirst({ where: { organisationId, type: "LIABILITY", name: { contains: "payable", mode: "insensitive" } } });
  if (!apAccount) return { tool: "record_bill_payment", success: false, error: "Accounts Payable account not found" };

  const outstanding = Number(bill.totalAmount) - Number(bill.amountPaid);
  if (amount > outstanding + 0.001) return { tool: "record_bill_payment", success: false, error: `Payment ($${amount}) exceeds outstanding balance ($${outstanding.toFixed(2)})` };

  const date = args.date ? new Date(args.date as string) : new Date();

  await db.journalEntry.create({
    data: {
      organisationId,
      date,
      description: `Payment: ${bill.number}`,
      reference: (args.reference as string) ?? bill.number,
      source: "BILL",
      sourceId: bill.id,
      lines: {
        create: [
          { accountId: apAccount.id, debit: new Prisma.Decimal(amount), description: `AP cleared: ${bill.number}` },
          { accountId: cashAccount.id, credit: new Prisma.Decimal(amount), description: `Payment made: ${bill.number}` },
        ],
      },
    },
  });

  const newPaid = Number(bill.amountPaid) + amount;
  const newStatus = newPaid >= Number(bill.totalAmount) - 0.001 ? "PAID" : "PARTIAL";
  await db.bill.update({ where: { id: bill.id }, data: { amountPaid: new Prisma.Decimal(newPaid), status: newStatus } });

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

  if (bill.journalEntryId) {
    const original = await db.journalEntry.findUnique({ where: { id: bill.journalEntryId }, include: { lines: true } });
    if (original && !original.isVoid) {
      await db.journalEntry.create({
        data: {
          organisationId,
          date: new Date(),
          description: `REVERSAL: ${original.description} — ${reason}`,
          source: "MANUAL",
          lines: {
            create: original.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: `Reversal: ${l.description ?? ""}`,
            })),
          },
        },
      });
      await db.journalEntry.update({ where: { id: original.id }, data: { isVoid: true } });
    }
  }

  await db.bill.update({ where: { id: bill.id }, data: { status: "VOID" } });
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

  await db.journalEntry.create({
    data: {
      organisationId,
      date: new Date(),
      description: `REVERSAL: ${entry.description} — ${reason}`,
      source: "MANUAL",
      lines: {
        create: entry.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          description: `Reversal: ${l.description ?? ""}`,
        })),
      },
    },
  });

  await db.journalEntry.update({ where: { id: entry.id }, data: { isVoid: true } });
  return { tool: "void_transaction", success: true, data: { id: entry.id, description: entry.description } };
}

export async function buildChatMessages(
  db: PrismaClient,
  params: {
    organisationId: string;
    conversationId: string;
    userMessage: string;
    attachmentId?: string;
  },
): Promise<{ role: string; content: string }[]> {
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
    where: { conversationId: params.conversationId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  history.reverse();

  const systemPrompt = buildSystemPrompt({
    orgName: org.name,
    currency: org.currency,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
    contacts: contacts.map((c) => ({ name: c.name, type: c.type })),
  });

  return [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.attachmentId ? `[User attached a file (attachmentId: ${params.attachmentId})]\n\n${params.userMessage}` : params.userMessage },
  ];
}

export async function processMessage(
  db: PrismaClient,
  params: {
    organisationId: string;
    userId: string;
    conversationId: string;
    userMessage: string;
    attachmentId?: string;
  },
): Promise<ChatResponse> {
  const messages = await buildChatMessages(db, params);

  let aiResponse: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const json = await res.json();
    aiResponse = json.message?.content ?? "I'm sorry, I couldn't process that request.";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      aiResponse = "The AI model took too long to respond. Please try a shorter or simpler request.";
    } else {
      aiResponse = `I'm having trouble connecting to the AI model. Please make sure Ollama is running. Error: ${err instanceof Error ? err.message : "Unknown"}`;
    }
    return { content: aiResponse, toolCalls: [], toolResults: [] };
  }

  const { text, toolCalls } = parseToolCalls(aiResponse);
  const toolResults: ToolResult[] = [];

  for (const call of toolCalls) {
    const result = await executeToolCall(db, params.organisationId, params.userId, call);
    toolResults.push(result);
  }

  return { content: text, toolCalls, toolResults };
}
