import { type PrismaClient, Prisma } from "@prisma/client";

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

const TOOL_DEFINITIONS = `
Available tools (respond with a JSON tool call block when you need to perform an action):

1. create_journal_entry: Create a journal entry
   Args: { "date": "YYYY-MM-DD", "description": "string", "lines": [{"accountCode": "string", "debit": number|null, "credit": number|null}] }

2. create_invoice: Create a customer invoice
   Args: { "contactName": "string", "date": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD", "lines": [{"description": "string", "quantity": number, "unitPrice": number}], "notes": "string"|null }

3. create_bill: Create a supplier bill
   Args: { "contactName": "string", "date": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD", "lines": [{"description": "string", "quantity": number, "unitPrice": number}], "notes": "string"|null }

4. get_profit_and_loss: Get profit & loss report
   Args: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }

5. get_balance_sheet: Get balance sheet
   Args: { "asOfDate": "YYYY-MM-DD" }

6. get_trial_balance: Get trial balance
   Args: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }

7. get_ar_aging: Get accounts receivable aging report
   Args: {}

8. get_ap_aging: Get accounts payable aging report
   Args: {}

9. list_accounts: List chart of accounts
   Args: { "type": "ASSET"|"LIABILITY"|"EQUITY"|"INCOME"|"EXPENSE"|null }

10. list_contacts: List contacts
    Args: { "type": "CUSTOMER"|"SUPPLIER"|null }

11. search_transactions: Search journal entries
    Args: { "query": "string", "limit": number }

12. get_account_balance: Get balance for a specific account
    Args: { "accountCode": "string" }

13. extract_document: Extract data from an uploaded receipt/invoice
    Args: { "attachmentId": "string" }

To call a tool, output EXACTLY this format on its own line:
TOOL_CALL: {"tool": "tool_name", "args": {...}}

You can include multiple TOOL_CALL lines if needed.
After tool results are returned, continue with your natural language response.
`;

function buildSystemPrompt(orgContext: {
  orgName: string;
  currency: string;
  accounts: { code: string; name: string; type: string }[];
  contacts: { name: string; type: string }[];
}): string {
  const accountList = orgContext.accounts
    .slice(0, 30)
    .map((a) => `  ${a.code} - ${a.name} (${a.type})`)
    .join("\n");

  const contactList = orgContext.contacts
    .slice(0, 20)
    .map((c) => `  ${c.name} (${c.type})`)
    .join("\n");

  return `You are an AI accounting assistant for "${orgContext.orgName}".
You help users manage their books through natural language conversation.
The organisation's base currency is ${orgContext.currency}.
Today's date is ${new Date().toISOString().slice(0, 10)}.

Chart of Accounts (partial):
${accountList}

Contacts (partial):
${contactList}

${TOOL_DEFINITIONS}

Guidelines:
- Be concise and helpful. Format monetary values with the currency symbol.
- When creating entries/invoices/bills, confirm what you're about to do before calling the tool.
- If the user asks for a report, call the appropriate tool and present the results in a readable format.
- If dates are not specified, use reasonable defaults (today for entries, 30 days for due dates).
- For journal entries, ensure debits equal credits.
- If you cannot find a matching contact or account, ask the user for clarification.
- When given an attachment, use extract_document to analyse it.
`;
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
      case "create_journal_entry":
        return await toolCreateJournalEntry(db, organisationId, toolCall.args);
      case "create_invoice":
        return await toolCreateInvoice(db, organisationId, toolCall.args);
      case "create_bill":
        return await toolCreateBill(db, organisationId, toolCall.args);
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
      case "list_accounts":
        return await toolListAccounts(db, organisationId, toolCall.args);
      case "list_contacts":
        return await toolListContacts(db, organisationId, toolCall.args);
      case "search_transactions":
        return await toolSearchTransactions(db, organisationId, toolCall.args);
      case "get_account_balance":
        return await toolGetAccountBalance(db, organisationId, toolCall.args);
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

  const invoice = await db.invoice.create({
    data: {
      organisationId,
      contactId: contact.id,
      number: nextNum,
      date: new Date(date),
      dueDate: new Date(dueDate),
      status: "DRAFT",
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(subtotal),
      notes: (args.notes as string) || null,
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
      status: "DRAFT",
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

  const bill = await db.bill.create({
    data: {
      organisationId,
      contactId: contact.id,
      number: nextNum,
      date: new Date(date),
      dueDate: new Date(dueDate),
      status: "DRAFT",
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(subtotal),
      notes: (args.notes as string) || null,
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
      status: "DRAFT",
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
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const systemPrompt = buildSystemPrompt({
    orgName: org.name,
    currency: org.currency,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
    contacts: contacts.map((c) => ({ name: c.name, type: c.type })),
  });

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.attachmentId ? `[User attached a file (attachmentId: ${params.attachmentId})]\n\n${params.userMessage}` : params.userMessage },
  ];

  let aiResponse: string;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
    });

    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const json = await res.json();
    aiResponse = json.message?.content ?? "I'm sorry, I couldn't process that request.";
  } catch (err) {
    aiResponse = `I'm having trouble connecting to the AI model. Please make sure Ollama is running. Error: ${err instanceof Error ? err.message : "Unknown"}`;
    return { content: aiResponse, toolCalls: [], toolResults: [] };
  }

  const { text, toolCalls } = parseToolCalls(aiResponse);
  const toolResults: ToolResult[] = [];

  for (const call of toolCalls) {
    const result = await executeToolCall(db, params.organisationId, params.userId, call);
    toolResults.push(result);
  }

  let finalContent = text;
  if (toolResults.length > 0) {
    const resultSummary = toolResults.map((r) => {
      if (r.success) return `✅ ${r.tool}: ${JSON.stringify(r.data)}`;
      return `❌ ${r.tool}: ${r.error}`;
    }).join("\n\n");
    finalContent = finalContent ? `${finalContent}\n\n${resultSummary}` : resultSummary;
  }

  return { content: finalContent, toolCalls, toolResults };
}
