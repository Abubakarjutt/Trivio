/**
 * Chat tool smoke-test.
 * Calls Gemini directly with the same system prompt the app uses, then checks:
 *  - finishReason is "STOP" (not "UNEXPECTED_TOOL_CALL")
 *  - response contains at least one TOOL_CALL_{nonce} line (for action tests)
 *  - the tool name in the JSON matches what we expect
 *
 * Run: npx tsx scripts/test-chat-tools.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = process.env.CHAT_MODEL ?? "gemini-2.5-flash-lite";

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set");
  process.exit(1);
}

// ─── Minimal system-prompt builder (mirrors chat.service.ts) ─────────────────

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
- set_budget: {"category","limitAmount","name?","period?":"WEEKLY|MONTHLY|QUARTERLY|YEARLY"}
- set_budgets: {"budgets":[{"category","limitAmount","name?","period?"},...]}
- list_budgets: {}
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

Format: TOOL_CALL_\${NONCE}: {"tool":"name","args":{...}}
`;

function buildSystemPrompt(nonce: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const toolDefs = TOOL_DEFINITIONS.replaceAll("${NONCE}", nonce);
  return `You are an accounting assistant for "TestCo". Currency: USD. Today's date: ${today}.
Accounts: 1000:Cash, 1100:Accounts Receivable, 2000:Accounts Payable, 4000:Sales Revenue, 5000:Cost of Goods Sold
Contacts: ACME Corp(CUSTOMER), Office Depot(SUPPLIER), Tech Supplier(SUPPLIER)
${toolDefs}
Rules:
- ALWAYS output plain text only. NEVER use function calling, JSON mode, or structured output.
- When performing an action, write the ACTION line in plain text: TOOL_CALL_${nonce}: {"tool":"...","args":{...}}
- When the user asks you to perform a task directly (create, record, void, list, show), output the ACTION line.
- Be concise.`.replaceAll("${NONCE}", nonce);
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(systemPrompt: string, userMessage: string): Promise<{
  finishReason: string;
  text: string;
  rawParts: unknown[];
  error?: string;
}> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    toolConfig: { functionCallingConfig: { mode: "NONE" } },
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    // Retry on 429 / 503 with exponential backoff
    if (res.status === 429 || res.status === 503) {
      const waitMs = Math.min(2000 * 2 ** attempt, 32000);
      process.stdout.write(` [rate-limited, retry in ${waitMs / 1000}s]`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { finishReason: "HTTP_ERROR", text: "", rawParts: [], error: `${res.status}: ${errText.slice(0, 200)}` };
    }

    const json = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: unknown }> };
        finishReason?: string;
      }>;
      error?: { message?: string };
    };

    if (json.error) return { finishReason: "API_ERROR", text: "", rawParts: [], error: json.error.message };

    const candidate = json.candidates?.[0];
    const finishReason = candidate?.finishReason ?? "UNKNOWN";
    const rawParts = candidate?.content?.parts ?? [];

    const text = rawParts
      .filter((p: { text?: string; thought?: boolean }) => !p.thought && p.text)
      .map((p: { text?: string }) => p.text!)
      .join("")
      .trim();

    return { finishReason, text, rawParts };
  }

  return { finishReason: "HTTP_ERROR", text: "", rawParts: [], error: "Max retries exceeded (persistent 429/503)" };
}

// ─── Test cases ───────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  message: string;
  expectTool?: string;   // expected tool name in the TOOL_CALL line (undefined = conversational, no tool expected)
  expectNoTool?: boolean; // for questions where UI steps are the right response
}

// One representative test per tool category — keeps total under free-tier RPM.
// Run with: npx tsx scripts/test-chat-tools.ts [--full] for expanded coverage.
const FULL_MODE = process.argv.includes("--full");

const CORE_TEST_CASES: TestCase[] = [
  // Invoices (representative)
  { name: "create_invoice",            message: "post an invoice for 4000 for ACME Corp due next week",                        expectTool: "create_invoice" },
  { name: "list_invoices",             message: "list all sent invoices",                                                       expectTool: "list_invoices" },
  { name: "record_invoice_payment",    message: "record a payment of 4000 for invoice INV-0001",                               expectTool: "record_invoice_payment" },
  // Bills (representative)
  { name: "create_bill",               message: "post a bill for office supplies 20000 from Office Depot",                     expectTool: "create_bill" },
  { name: "void_bill",                 message: "void bill BILL-0001",                                                         expectTool: "void_bill" },
  // Contacts
  { name: "create_contact",            message: "add a new customer called Widget World",                                      expectTool: "create_contact" },
  // Accounts
  { name: "get_account_balance",       message: "what is the balance of account 1000?",                                       expectTool: "get_account_balance" },
  // Journal / transactions
  { name: "create_journal_entry",      message: "create a journal entry: debit 1100 for 5000, credit 4000 for 5000, description: Test sale", expectTool: "create_journal_entry" },
  // Reports
  { name: "get_profit_and_loss",       message: "show me the profit and loss for this year",                                   expectTool: "get_profit_and_loss" },
  { name: "get_ar_aging",              message: "show accounts receivable aging",                                               expectTool: "get_ar_aging" },
  // Budgets
  { name: "set_budget",                message: "set a monthly budget of 5000 for Food",                                       expectTool: "set_budget" },
  // CRM
  { name: "create_crm_lead",           message: "add a new lead: John Smith from Acme Corp",                                   expectTool: "create_crm_lead" },
  { name: "create_crm_deal",           message: "create a deal called 'Enterprise License' for ACME Corp worth 50000",         expectTool: "create_crm_deal" },
  { name: "create_crm_activity_call",  message: "log a call with subject 'Follow-up call' due next Monday",                   expectTool: "create_crm_activity" },
  { name: "create_crm_company",        message: "add a CRM company called 'Big Tech Ltd', medium size, technology industry",   expectTool: "create_crm_company" },
  // Recurring / Goals / Watchlist
  { name: "create_recurring",          message: "add a monthly recurring expense called 'Office Rent' for 3000",               expectTool: "create_recurring" },
  { name: "create_goal",               message: "create a savings goal called 'Emergency Fund' for 50000",                    expectTool: "create_goal" },
  { name: "create_watchlist",          message: "create a watchlist alert for monthly Food spending above 8000",               expectTool: "create_watchlist" },
  // UI-only (no tool expected)
  { name: "how_to_upload_receipt",     message: "how do I upload a receipt?",                                                  expectNoTool: true },
  { name: "how_to_reconcile",          message: "how do I do bank reconciliation?",                                            expectNoTool: true },
];

const EXTRA_TEST_CASES: TestCase[] = [
  { name: "get_invoice",               message: "show me invoice INV-0001",                                        expectTool: "get_invoice" },
  { name: "void_invoice",              message: "void invoice INV-0001",                                           expectTool: "void_invoice" },
  { name: "send_invoice",              message: "send invoice INV-0001 to the customer",                           expectTool: "send_invoice" },
  { name: "list_bills",                message: "show all outstanding bills",                                      expectTool: "list_bills" },
  { name: "get_bill",                  message: "show me bill BILL-0001",                                          expectTool: "get_bill" },
  { name: "approve_bill",              message: "approve bill BILL-0001",                                          expectTool: "approve_bill" },
  { name: "record_bill_payment",       message: "record a payment of 20000 for bill BILL-0001",                   expectTool: "record_bill_payment" },
  { name: "list_contacts",             message: "show me all customers",                                           expectTool: "list_contacts" },
  { name: "update_contact",            message: "update contact ACME Corp phone to +1-555-9999",                  expectTool: "update_contact" },
  { name: "list_accounts",             message: "list all expense accounts",                                       expectTool: "list_accounts" },
  { name: "create_account",            message: "create a new expense account with code 6100 called Travel",      expectTool: "create_account" },
  { name: "search_transactions",       message: "search transactions for 'rent'",                                  expectTool: "search_transactions" },
  { name: "get_balance_sheet",         message: "give me the balance sheet as of today",                           expectTool: "get_balance_sheet" },
  { name: "get_trial_balance",         message: "run a trial balance",                                             expectTool: "get_trial_balance" },
  { name: "get_ap_aging",              message: "show accounts payable aging",                                      expectTool: "get_ap_aging" },
  { name: "list_budgets",              message: "show my current budgets",                                          expectTool: "list_budgets" },
  { name: "set_budgets",               message: "set budgets: Food 5000, Transport 3000, Entertainment 2000 monthly", expectTool: "set_budgets" },
  { name: "list_crm_leads",            message: "list all new CRM leads",                                          expectTool: "list_crm_leads" },
  { name: "list_crm_deals",            message: "list all deals",                                                   expectTool: "list_crm_deals" },
  { name: "list_crm_activities",       message: "show all upcoming CRM activities",                                 expectTool: "list_crm_activities" },
  { name: "list_crm_companies",        message: "list all CRM companies",                                           expectTool: "list_crm_companies" },
  { name: "list_recurring",            message: "show all recurring expenses",                                      expectTool: "list_recurring" },
  { name: "list_goals",                message: "show all my financial goals",                                      expectTool: "list_goals" },
  { name: "list_watchlists",           message: "show my spending watchlists",                                      expectTool: "list_watchlists" },
];

const TEST_CASES: TestCase[] = FULL_MODE ? [...CORE_TEST_CASES, ...EXTRA_TEST_CASES] : CORE_TEST_CASES;

// ─── Runner ───────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  pass: boolean;
  finishReason: string;
  foundTool?: string;
  expectedTool?: string;
  error?: string;
  responseSnippet?: string;
}

async function runTest(tc: TestCase, nonce: string, systemPrompt: string): Promise<TestResult> {
  const { finishReason, text, error } = await callGemini(systemPrompt, tc.message);

  if (error) {
    return { name: tc.name, pass: false, finishReason, error };
  }

  if (finishReason !== "STOP") {
    return {
      name: tc.name,
      pass: false,
      finishReason,
      expectedTool: tc.expectTool,
      responseSnippet: text.slice(0, 200),
    };
  }

  // Parse tool calls
  const PREFIX = `TOOL_CALL_${nonce}:`;
  const foundToolCalls: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(PREFIX)) {
      try {
        const parsed = JSON.parse(trimmed.slice(PREFIX.length).trim()) as { tool?: string };
        if (parsed.tool) foundToolCalls.push(parsed.tool);
      } catch { /* malformed */ }
    }
  }

  const foundTool = foundToolCalls[0];

  if (tc.expectNoTool) {
    const pass = foundToolCalls.length === 0;
    return { name: tc.name, pass, finishReason, foundTool, responseSnippet: text.slice(0, 200) };
  }

  if (tc.expectTool) {
    const pass = foundTool === tc.expectTool;
    return { name: tc.name, pass, finishReason, foundTool, expectedTool: tc.expectTool, responseSnippet: text.slice(0, 200) };
  }

  return { name: tc.name, pass: true, finishReason, responseSnippet: text.slice(0, 200) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const nonce = "TESTRUN1";
  const systemPrompt = buildSystemPrompt(nonce);

  console.log(`\nChat tool test — model: ${GEMINI_MODEL}`);
  console.log(`Running ${TEST_CASES.length} tests...\n`);

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`  ${tc.name.padEnd(35)} `);
    const result = await runTest(tc, nonce, systemPrompt);
    results.push(result);

    if (result.pass) {
      passed++;
      console.log(`PASS  (finishReason=${result.finishReason}, tool=${result.foundTool ?? "none"})`);
    } else {
      failed++;
      const detail = result.error
        ? `ERROR: ${result.error}`
        : `finishReason=${result.finishReason}, expected=${result.expectedTool ?? (tc.expectNoTool ? "no-tool" : "?")}, got=${result.foundTool ?? "none"}`;
      console.log(`FAIL  ${detail}`);
      if (result.responseSnippet && !result.error) {
        console.log(`        response: ${result.responseSnippet.slice(0, 150).replace(/\n/g, "↵")}`);
      }
    }

    // Pause between tests to stay within free-tier RPM limits
    await sleep(FULL_MODE ? 4000 : 3000);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter((r) => !r.pass).forEach((r) => {
      console.log(`  - ${r.name}: expected=${r.expectedTool ?? (TEST_CASES.find(t => t.name === r.name)?.expectNoTool ? "no-tool" : "?")} got=${r.foundTool ?? r.finishReason}`);
    });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
