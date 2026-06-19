/**
 * Integration tests for all AI chat tool handlers.
 *
 * Tests every executeToolCall handler + parseToolCalls + buildSystemPrompt
 * against the real PostgreSQL database. No Gemini API calls — we exercise
 * the tool execution pipeline directly.
 *
 * Requires the dev database to be running:
 *   docker compose up -d
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  executeToolCall,
  parseToolCalls,
  buildSystemPrompt,
  buildChatMessages,
} from "@/server/services/chat.service";

const db = new PrismaClient();

let orgId: string;
let userId: string;

// IDs created during tests (used by later tests)
let invoiceNumber: string;
let billNumber: string;
let crmLeadId: string;
let crmDealId: string;
let recurringId: string;
let goalId: string;

beforeAll(async () => {
  const org = await db.organisation.create({ data: { name: "Chat Tool Test Org" } });
  orgId = org.id;

  const user = await db.user.create({
    data: {
      email: `chat-tools+${Date.now()}@test.example`,
      hashedPassword: "x",
      organisationId: orgId,
    },
  });
  userId = user.id;

  // Chart of accounts — codes must match what invoice.service.ts and bill.service.ts hardcode
  await db.chartAccount.createMany({
    data: [
      { organisationId: orgId, code: "1000", name: "Cash",                  type: "ASSET",     normalBalance: "DEBIT" },
      { organisationId: orgId, code: "1100", name: "Accounts Receivable",   type: "ASSET",     normalBalance: "DEBIT" },
      { organisationId: orgId, code: "1200", name: "Trade Receivables",     type: "ASSET",     normalBalance: "DEBIT" },
      { organisationId: orgId, code: "2100", name: "Accounts Payable",      type: "LIABILITY", normalBalance: "CREDIT" },
      { organisationId: orgId, code: "2200", name: "Tax Payable",           type: "LIABILITY", normalBalance: "CREDIT" },
      { organisationId: orgId, code: "2201", name: "GST Payable",           type: "LIABILITY", normalBalance: "CREDIT" },
      { organisationId: orgId, code: "4000", name: "Sales Revenue",         type: "INCOME",    normalBalance: "CREDIT" },
      { organisationId: orgId, code: "4100", name: "Revenue",               type: "INCOME",    normalBalance: "CREDIT" },
      { organisationId: orgId, code: "5000", name: "Cost of Goods",         type: "EXPENSE",   normalBalance: "DEBIT" },
      { organisationId: orgId, code: "5100", name: "Operating Expenses",    type: "EXPENSE",   normalBalance: "DEBIT" },
    ],
  });

  // Contacts
  await db.contact.createMany({
    data: [
      { organisationId: orgId, name: "ACME Corp",    type: "CUSTOMER" },
      { organisationId: orgId, name: "Office Depot", type: "SUPPLIER" },
    ],
  });

  // CRM pipeline with stages
  const pipeline = await db.crmPipeline.create({
    data: {
      organisationId: orgId,
      name: "Sales",
      isDefault: true,
      stages: {
        create: [
          { name: "Lead",        order: 0, probability: 10 },
          { name: "Proposal",    order: 1, probability: 50 },
          { name: "Negotiation", order: 2, probability: 80 },
          { name: "Won",         order: 3, probability: 100 },
        ],
      },
    },
  });
  void pipeline; // used implicitly by create_crm_deal
});

afterAll(async () => {
  // Delete in FK dependency order
  await db.crmActivity.deleteMany({ where: { organisationId: orgId } });
  await db.crmDeal.deleteMany({ where: { organisationId: orgId } });
  await db.crmLead.deleteMany({ where: { organisationId: orgId } });
  await db.crmCompany.deleteMany({ where: { organisationId: orgId } });
  await db.crmPipelineStage.deleteMany({ where: { pipeline: { organisationId: orgId } } });
  await db.crmPipeline.deleteMany({ where: { organisationId: orgId } });
  await db.watchlist.deleteMany({ where: { organisationId: orgId } });
  await db.goal.deleteMany({ where: { organisationId: orgId } });
  await db.recurringItem.deleteMany({ where: { organisationId: orgId } });
  await db.budget.deleteMany({ where: { organisationId: orgId } });
  await db.invoiceLine.deleteMany({ where: { invoice: { organisationId: orgId } } });
  await db.billLine.deleteMany({ where: { bill: { organisationId: orgId } } });
  await db.journalLine.deleteMany({ where: { journalEntry: { organisationId: orgId } } });
  await db.invoice.deleteMany({ where: { organisationId: orgId } });
  await db.bill.deleteMany({ where: { organisationId: orgId } });
  await db.journalEntry.deleteMany({ where: { organisationId: orgId } });
  await db.contact.deleteMany({ where: { organisationId: orgId } });
  await db.chartAccount.deleteMany({ where: { organisationId: orgId } });
  await db.chatMessage.deleteMany({ where: { conversation: { organisationId: orgId } } });
  await db.chatConversation.deleteMany({ where: { organisationId: orgId } });
  await db.user.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
  await db.$disconnect();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const call = (tool: string, args: Record<string, unknown>) =>
  executeToolCall(db, orgId, userId, { tool, args });

// ─── System prompt & parser ───────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("resolves ${NONCE} throughout", () => {
    const prompt = buildSystemPrompt(
      { orgName: "TestCo", currency: "USD", accounts: [], contacts: [] },
      "ABC123",
    );
    expect(prompt).not.toContain("${NONCE}");
    expect(prompt).toContain("TOOL_CALL_ABC123");
  });

  it("includes org name and currency", () => {
    const prompt = buildSystemPrompt(
      { orgName: "Acme Inc", currency: "GBP", accounts: [], contacts: [] },
      "X",
    );
    expect(prompt).toContain("Acme Inc");
    expect(prompt).toContain("GBP");
  });
});

describe("parseToolCalls", () => {
  const nonce = "N1";

  it("parses a single tool call", () => {
    const text = `Sure!\nTOOL_CALL_N1: {"tool":"create_invoice","args":{"contactName":"ACME"}}\nDone.`;
    const { text: stripped, toolCalls } = parseToolCalls(text, nonce);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].tool).toBe("create_invoice");
    expect(toolCalls[0].args).toMatchObject({ contactName: "ACME" });
    expect(stripped).not.toContain("TOOL_CALL_N1");
  });

  it("parses multiple tool calls", () => {
    const text = [
      `TOOL_CALL_N1: {"tool":"list_invoices","args":{}}`,
      `TOOL_CALL_N1: {"tool":"list_bills","args":{}}`,
    ].join("\n");
    const { toolCalls } = parseToolCalls(text, nonce);
    expect(toolCalls).toHaveLength(2);
  });

  it("ignores wrong nonce", () => {
    const text = `TOOL_CALL_WRONG: {"tool":"create_invoice","args":{}}`;
    const { toolCalls } = parseToolCalls(text, nonce);
    expect(toolCalls).toHaveLength(0);
  });

  it("ignores malformed JSON", () => {
    const text = `TOOL_CALL_N1: not-json`;
    const { toolCalls } = parseToolCalls(text, nonce);
    expect(toolCalls).toHaveLength(0);
  });
});

// ─── Invoices ─────────────────────────────────────────────────────────────────

describe("Invoice tools", () => {
  it("create_invoice — creates and posts to ledger", async () => {
    const r = await call("create_invoice", {
      contactName: "ACME Corp",
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 1000 }],
    });
    expect(r.success).toBe(true);
    const d = r.data as { number: string; total: number; status: string };
    expect(d.total).toBe(2000);
    expect(d.status).toBe("SENT");
    invoiceNumber = d.number;
  });

  it("list_invoices — returns the created invoice", async () => {
    const r = await call("list_invoices", { status: "SENT" });
    expect(r.success).toBe(true);
    const data = r.data as { number: string }[];
    expect(data.some((i) => i.number === invoiceNumber)).toBe(true);
  });

  it("get_invoice — returns full detail", async () => {
    const r = await call("get_invoice", { invoiceNumber });
    expect(r.success).toBe(true);
    const d = r.data as { customer: string; total: number };
    expect(d.customer).toBe("ACME Corp");
    expect(d.total).toBe(2000);
  });

  it("send_invoice — marks SENT (already SENT is idempotent)", async () => {
    const r = await call("send_invoice", { invoiceNumber });
    expect(r.success).toBe(true);
  });

  it("record_invoice_payment — records partial payment", async () => {
    const r = await call("record_invoice_payment", {
      invoiceNumber,
      amount: 1000,
    });
    expect(r.success).toBe(true);
    const d = r.data as { newStatus: string };
    expect(d.newStatus).toBe("PARTIAL");
  });

  it("void_invoice — voids the invoice", async () => {
    const r = await call("void_invoice", { invoiceNumber, reason: "Test void" });
    expect(r.success).toBe(true);
  });
});

// ─── Bills ────────────────────────────────────────────────────────────────────

describe("Bill tools", () => {
  it("create_bill — creates and posts to ledger", async () => {
    const r = await call("create_bill", {
      contactName: "Office Depot",
      lines: [{ description: "Office Supplies", quantity: 1, unitPrice: 500 }],
    });
    expect(r.success).toBe(true);
    const d = r.data as { number: string; total: number };
    expect(d.total).toBe(500);
    billNumber = d.number;
  });

  it("list_bills — returns the created bill", async () => {
    const r = await call("list_bills", { status: "ALL" });
    expect(r.success).toBe(true);
    const data = r.data as { number: string }[];
    expect(data.some((b) => b.number === billNumber)).toBe(true);
  });

  it("get_bill — returns full detail", async () => {
    const r = await call("get_bill", { billNumber });
    expect(r.success).toBe(true);
    const d = r.data as { supplier: string };
    expect(d.supplier).toBe("Office Depot");
  });

  it("record_bill_payment — pays the bill in full", async () => {
    const r = await call("record_bill_payment", { billNumber, amount: 500 });
    expect(r.success).toBe(true);
    const d = r.data as { newStatus: string };
    expect(d.newStatus).toBe("PAID");
  });

  it("approve_bill — moves DRAFT bill to SENT", async () => {
    // Create a fresh bill to approve (the previous one is already PAID/VOID)
    const created = await call("create_bill", {
      contactName: "Office Depot",
      lines: [{ description: "Stationery", quantity: 2, unitPrice: 100 }],
    });
    expect(created.success).toBe(true);
    const { id, number } = created.data as { id: string; number: string };

    // The bill is created as SENT by createBill — need a DRAFT one to approve.
    // Reset it to DRAFT so approve_bill can act on it.
    await db.bill.update({ where: { id }, data: { status: "DRAFT" } });

    const r = await call("approve_bill", { billNumber: number });
    expect(r.success).toBe(true);
    const d = r.data as { status: string };
    expect(d.status).toBe("SENT");
  });

  it("void_bill — voids the bill", async () => {
    const r = await call("void_bill", { billNumber });
    expect(r.success).toBe(true);
  });
});

// ─── Contacts ─────────────────────────────────────────────────────────────────

describe("Contact tools", () => {
  it("list_contacts — returns existing contacts", async () => {
    const r = await call("list_contacts", { type: "CUSTOMER" });
    expect(r.success).toBe(true);
    const data = r.data as { name: string }[];
    expect(data.some((c) => c.name === "ACME Corp")).toBe(true);
  });

  it("create_contact — creates a new customer", async () => {
    const r = await call("create_contact", { name: "Widget World", type: "CUSTOMER" });
    expect(r.success).toBe(true);
    const d = r.data as { name: string; type: string };
    expect(d.name).toBe("Widget World");
    expect(d.type).toBe("CUSTOMER");
  });

  it("create_contact — rejects duplicate", async () => {
    const r = await call("create_contact", { name: "Widget World", type: "CUSTOMER" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/i);
  });

  it("update_contact — updates email", async () => {
    const r = await call("update_contact", { name: "Widget World", email: "info@widget.example" });
    expect(r.success).toBe(true);
  });
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

describe("Account tools", () => {
  it("list_accounts — returns seeded accounts", async () => {
    const r = await call("list_accounts", {});
    expect(r.success).toBe(true);
    const data = r.data as { code: string }[];
    expect(data.some((a) => a.code === "1000")).toBe(true);
  });

  it("get_account_balance — returns balance for Cash account", async () => {
    const r = await call("get_account_balance", { accountCode: "1000" });
    expect(r.success).toBe(true);
    const d = r.data as { code: string; balance: number };
    expect(d.code).toBe("1000");
    expect(typeof d.balance).toBe("number");
  });

  it("create_account — creates a Travel expense account", async () => {
    const r = await call("create_account", { code: "6100", name: "Travel", type: "EXPENSE" });
    expect(r.success).toBe(true);
    const d = r.data as { code: string };
    expect(d.code).toBe("6100");
  });

  it("create_account — rejects duplicate code", async () => {
    const r = await call("create_account", { code: "6100", name: "Travel Dupe", type: "EXPENSE" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/i);
  });
});

// ─── Journal / Transactions ───────────────────────────────────────────────────

describe("Transaction tools", () => {
  let txId: string;

  it("create_journal_entry — balanced entry succeeds", async () => {
    const r = await call("create_journal_entry", {
      description: "Test manual entry",
      lines: [
        { accountCode: "1100", debit: 3000 },
        { accountCode: "4000", credit: 3000 },
      ],
    });
    expect(r.success).toBe(true);
    const d = r.data as { id: string };
    txId = d.id;
  });

  it("create_journal_entry — unbalanced entry fails", async () => {
    const r = await call("create_journal_entry", {
      description: "Bad entry",
      lines: [
        { accountCode: "1100", debit: 5000 },
        { accountCode: "4000", credit: 3000 },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/debit|credit|equal/i);
  });

  it("search_transactions — finds the created entry", async () => {
    const r = await call("search_transactions", { query: "manual entry" });
    expect(r.success).toBe(true);
    const data = r.data as { id: string }[];
    expect(data.some((e) => e.id === txId)).toBe(true);
  });

  it("void_transaction — voids the entry", async () => {
    const r = await call("void_transaction", { transactionId: txId });
    expect(r.success).toBe(true);
  });
});

// ─── Reports ─────────────────────────────────────────────────────────────────

describe("Report tools", () => {
  it("get_profit_and_loss — returns P&L structure", async () => {
    const r = await call("get_profit_and_loss", {});
    expect(r.success).toBe(true);
    const d = r.data as { totalIncome: number; totalExpenses: number; netProfit: number };
    expect(typeof d.totalIncome).toBe("number");
    expect(typeof d.netProfit).toBe("number");
  });

  it("get_balance_sheet — returns asset/liability/equity", async () => {
    const r = await call("get_balance_sheet", {});
    expect(r.success).toBe(true);
    const d = r.data as { totalAssets: number; totalLiabilities: number };
    expect(typeof d.totalAssets).toBe("number");
  });

  it("get_trial_balance — returns debit/credit totals", async () => {
    const r = await call("get_trial_balance", {});
    expect(r.success).toBe(true);
    const d = r.data as { totalDebit: number; totalCredit: number };
    expect(typeof d.totalDebit).toBe("number");
  });

  it("get_ar_aging — returns aging buckets", async () => {
    const r = await call("get_ar_aging", {});
    expect(r.success).toBe(true);
    const d = r.data as { aging: Record<string, number> };
    expect(d.aging).toHaveProperty("current");
  });

  it("get_ap_aging — returns aging buckets", async () => {
    const r = await call("get_ap_aging", {});
    expect(r.success).toBe(true);
    const d = r.data as { aging: Record<string, number> };
    expect(d.aging).toHaveProperty("current");
  });
});

// ─── Budgets ──────────────────────────────────────────────────────────────────

describe("Budget tools", () => {
  it("set_budget — creates a budget", async () => {
    const r = await call("set_budget", { category: "Food", limitAmount: 5000, period: "MONTHLY" });
    expect(r.success).toBe(true);
    const d = r.data as { action: string; limitAmount: number };
    expect(d.action).toBe("created");
    expect(d.limitAmount).toBe(5000);
  });

  it("set_budget — updates existing budget", async () => {
    const r = await call("set_budget", { category: "Food", limitAmount: 6000 });
    expect(r.success).toBe(true);
    const d = r.data as { action: string; limitAmount: number };
    expect(d.action).toBe("updated");
    expect(d.limitAmount).toBe(6000);
  });

  it("set_budgets — creates multiple budgets", async () => {
    const r = await call("set_budgets", {
      budgets: [
        { category: "Transport", limitAmount: 3000 },
        { category: "Entertainment", limitAmount: 2000 },
      ],
    });
    expect(r.success).toBe(true);
    const d = r.data as { saved: number };
    expect(d.saved).toBe(2);
  });

  it("list_budgets — returns all budgets", async () => {
    const r = await call("list_budgets", {});
    expect(r.success).toBe(true);
    const d = r.data as { budgets: { category: string }[] };
    expect(d.budgets.some((b) => b.category === "Food")).toBe(true);
    expect(d.budgets.some((b) => b.category === "Transport")).toBe(true);
  });
});

// ─── CRM — Leads ─────────────────────────────────────────────────────────────

describe("CRM Lead tools", () => {
  it("create_crm_lead — creates a lead", async () => {
    const r = await call("create_crm_lead", {
      firstName: "John",
      lastName: "Smith",
      companyName: "StartupCo",
      source: "WEBSITE",
    });
    expect(r.success).toBe(true);
    const d = r.data as { id: string; name: string; status: string };
    expect(d.name).toBe("John Smith");
    expect(d.status).toBe("NEW");
    crmLeadId = d.id;
  });

  it("list_crm_leads — returns the created lead", async () => {
    const r = await call("list_crm_leads", { status: "NEW" });
    expect(r.success).toBe(true);
    const data = r.data as { id: string }[];
    expect(data.some((l) => l.id === crmLeadId)).toBe(true);
  });

  it("update_crm_lead_status — moves to CONTACTED", async () => {
    const r = await call("update_crm_lead_status", { leadId: crmLeadId, status: "CONTACTED" });
    expect(r.success).toBe(true);
    const d = r.data as { status: string };
    expect(d.status).toBe("CONTACTED");
  });
});

// ─── CRM — Deals ─────────────────────────────────────────────────────────────

describe("CRM Deal tools", () => {
  it("create_crm_deal — creates a deal", async () => {
    const r = await call("create_crm_deal", {
      name: "Enterprise License",
      contactName: "ACME Corp",
      value: 50000,
    });
    expect(r.success).toBe(true);
    const d = r.data as { id: string; name: string; value: number };
    expect(d.name).toBe("Enterprise License");
    expect(d.value).toBe(50000);
    crmDealId = d.id;
  });

  it("list_crm_deals — returns the deal", async () => {
    const r = await call("list_crm_deals", {});
    expect(r.success).toBe(true);
    const data = r.data as { id: string }[];
    expect(data.some((d) => d.id === crmDealId)).toBe(true);
  });

  it("move_crm_deal — moves to Proposal stage", async () => {
    const r = await call("move_crm_deal", { dealId: crmDealId, stageName: "Proposal" });
    expect(r.success).toBe(true);
    const d = r.data as { newStage: string };
    expect(d.newStage).toBe("Proposal");
  });
});

// ─── CRM — Activities ────────────────────────────────────────────────────────

describe("CRM Activity tools", () => {
  it("create_crm_activity (CALL) — creates activity", async () => {
    const r = await call("create_crm_activity", {
      type: "CALL",
      subject: "Follow-up call",
      contactName: "ACME Corp",
    });
    expect(r.success).toBe(true);
    const d = r.data as { type: string; subject: string };
    expect(d.type).toBe("CALL");
    expect(d.subject).toBe("Follow-up call");
  });

  it("create_crm_activity (EMAIL) — creates email activity", async () => {
    const r = await call("create_crm_activity", {
      type: "EMAIL",
      subject: "Quote sent",
      contactName: "ACME Corp",
    });
    expect(r.success).toBe(true);
  });

  it("create_crm_activity (MEETING) — creates meeting", async () => {
    const r = await call("create_crm_activity", {
      type: "MEETING",
      subject: "Product demo",
      dueDate: "2026-07-01",
    });
    expect(r.success).toBe(true);
  });

  it("list_crm_activities — returns activities", async () => {
    const r = await call("list_crm_activities", {});
    expect(r.success).toBe(true);
    const data = r.data as { subject: string }[];
    expect(data.some((a) => a.subject === "Follow-up call")).toBe(true);
  });
});

// ─── CRM — Companies ─────────────────────────────────────────────────────────

describe("CRM Company tools", () => {
  it("create_crm_company — creates a company", async () => {
    const r = await call("create_crm_company", {
      name: "Big Tech Ltd",
      industry: "Technology",
      size: "MEDIUM",
    });
    expect(r.success).toBe(true);
    const d = r.data as { name: string };
    expect(d.name).toBe("Big Tech Ltd");
  });

  it("list_crm_companies — returns the company", async () => {
    const r = await call("list_crm_companies", {});
    expect(r.success).toBe(true);
    const data = r.data as { name: string }[];
    expect(data.some((c) => c.name === "Big Tech Ltd")).toBe(true);
  });
});

// ─── Recurring ────────────────────────────────────────────────────────────────

describe("Recurring tools", () => {
  it("create_recurring — creates a monthly expense", async () => {
    const r = await call("create_recurring", {
      name: "Office Rent",
      amount: 3000,
      type: "EXPENSE",
      frequency: "MONTHLY",
    });
    expect(r.success).toBe(true);
    const d = r.data as { id: string; name: string };
    expect(d.name).toBe("Office Rent");
    recurringId = d.id;
  });

  it("list_recurring — returns recurring items", async () => {
    const r = await call("list_recurring", { type: "EXPENSE" });
    expect(r.success).toBe(true);
    const data = r.data as { name: string }[];
    expect(data.some((i) => i.name === "Office Rent")).toBe(true);
  });

  it("mark_recurring_paid — advances next due date", async () => {
    const r = await call("mark_recurring_paid", { recurringId });
    expect(r.success).toBe(true);
    const d = r.data as { nextDueDate: string };
    expect(d.nextDueDate).toBeTruthy();
  });
});

// ─── Goals ────────────────────────────────────────────────────────────────────

describe("Goal tools", () => {
  it("create_goal — creates a savings goal", async () => {
    const r = await call("create_goal", {
      name: "Emergency Fund",
      targetAmount: 50000,
      targetDate: "2026-12-31",
    });
    expect(r.success).toBe(true);
    const d = r.data as { id: string; name: string };
    expect(d.name).toBe("Emergency Fund");
    goalId = d.id;
  });

  it("list_goals — returns the goal", async () => {
    const r = await call("list_goals", {});
    expect(r.success).toBe(true);
    const data = r.data as { name: string }[];
    expect(data.some((g) => g.name === "Emergency Fund")).toBe(true);
  });

  it("update_goal_progress — records current amount", async () => {
    const r = await call("update_goal_progress", { goalId, currentAmount: 12000 });
    expect(r.success).toBe(true);
    const d = r.data as { currentAmount: number; progress: number };
    expect(d.currentAmount).toBe(12000);
    expect(d.progress).toBeCloseTo(24); // 12000/50000 * 100
  });
});

// ─── Watchlists ───────────────────────────────────────────────────────────────

describe("Watchlist tools", () => {
  it("create_watchlist — creates a spending alert", async () => {
    const r = await call("create_watchlist", {
      name: "Food Alert",
      category: "Food",
      threshold: 8000,
      period: "MONTHLY",
    });
    expect(r.success).toBe(true);
    const d = r.data as { name: string; threshold: number };
    expect(d.name).toBe("Food Alert");
    expect(d.threshold).toBe(8000);
  });

  it("list_watchlists — returns the watchlist", async () => {
    const r = await call("list_watchlists", {});
    expect(r.success).toBe(true);
    const data = r.data as { name: string }[];
    expect(data.some((w) => w.name === "Food Alert")).toBe(true);
  });
});

// ─── Error / validation paths ─────────────────────────────────────────────────

describe("Error handling", () => {
  it("create_invoice — unknown contact returns error", async () => {
    const r = await call("create_invoice", {
      contactName: "Does Not Exist",
      lines: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("create_bill — unknown supplier returns error", async () => {
    const r = await call("create_bill", {
      contactName: "Ghost Supplier",
      lines: [{ description: "Y", quantity: 1, unitPrice: 200 }],
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("get_account_balance — bad code returns error", async () => {
    const r = await call("get_account_balance", { accountCode: "9999" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("executeToolCall — unknown tool returns error", async () => {
    const r = await call("does_not_exist", {});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/unknown tool/i);
  });
});

// ─── buildChatMessages ────────────────────────────────────────────────────────

describe("buildChatMessages", () => {
  let convId: string;

  beforeAll(async () => {
    const conv = await db.chatConversation.create({
      data: { organisationId: orgId, userId, title: "Test conversation" },
    });
    convId = conv.id;
  });

  it("returns system prompt + user message for empty history", async () => {
    const { messages, nonce } = await buildChatMessages(db, {
      organisationId: orgId,
      conversationId: convId,
      userMessage: "hello",
    });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(`TOOL_CALL_${nonce}`);
    expect(messages[messages.length - 1].role).toBe("user");
    expect(messages[messages.length - 1].content).toBe("hello");
  });

  it("generates a unique nonce each call", async () => {
    const a = await buildChatMessages(db, { organisationId: orgId, conversationId: convId, userMessage: "x" });
    const b = await buildChatMessages(db, { organisationId: orgId, conversationId: convId, userMessage: "x" });
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("includes org accounts and contacts in system prompt", async () => {
    const { messages } = await buildChatMessages(db, {
      organisationId: orgId,
      conversationId: convId,
      userMessage: "x",
    });
    const system = messages[0].content;
    expect(system).toContain("1000");   // Cash account code
    expect(system).toContain("ACME Corp");
  });

  it("filters empty assistant messages from history", async () => {
    // Seed an empty assistant message (simulates old bug)
    await db.chatMessage.create({
      data: { conversationId: convId, role: "user", content: "prior question" },
    });
    await db.chatMessage.create({
      data: { conversationId: convId, role: "assistant", content: "" },
    });
    await db.chatMessage.create({
      data: { conversationId: convId, role: "assistant", content: "real reply" },
    });

    const { messages } = await buildChatMessages(db, {
      organisationId: orgId,
      conversationId: convId,
      userMessage: "new question",
    });

    const history = messages.filter((m) => m.role !== "system");
    // Empty assistant message must not appear
    expect(history.every((m) => m.content.trim() !== "")).toBe(true);
    // Real reply must appear
    expect(history.some((m) => m.content === "real reply")).toBe(true);
  });

  it("prefixes user message with attachment note when attachmentId given", async () => {
    const { messages } = await buildChatMessages(db, {
      organisationId: orgId,
      conversationId: convId,
      userMessage: "extract this",
      attachmentId: "att-123",
    });
    const last = messages[messages.length - 1];
    expect(last.content).toContain("att-123");
    expect(last.content).toContain("extract this");
  });
});
