import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeToolCall } from "@/server/services/chat.service";

const mockDb = {
  chartAccount: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  journalEntry: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  journalLine: {
    findMany: vi.fn(),
  },
  contact: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  invoice: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  bill: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
} as unknown as Parameters<typeof executeToolCall>[0];

const ORG_ID = "org-123";
const USER_ID = "user-456";

describe("Chat Tool Execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("create_journal_entry", () => {
    it("rejects entries with fewer than 2 lines", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_journal_entry",
        args: { lines: [{ accountCode: "1000", debit: 100 }] },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("at least 2 lines");
    });

    it("rejects unbalanced entries", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_journal_entry",
        args: {
          lines: [
            { accountCode: "1000", debit: 100 },
            { accountCode: "5000", credit: 50 },
          ],
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("must equal credits");
    });

    it("rejects entries with unknown account codes", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "acc-1", code: "1000" },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_journal_entry",
        args: {
          lines: [
            { accountCode: "1000", debit: 100 },
            { accountCode: "9999", credit: 100 },
          ],
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("9999");
    });

    it("creates a valid journal entry", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "acc-1", code: "1000" },
        { id: "acc-2", code: "5000" },
      ]);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-1",
        date: new Date("2026-05-10"),
        description: "Office supplies",
        lines: [
          { account: { code: "5000", name: "Office Expenses" }, debit: { toNumber: () => 200 }, credit: null },
          { account: { code: "1000", name: "Cash at Bank" }, debit: null, credit: { toNumber: () => 200 } },
        ],
      });

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_journal_entry",
        args: {
          date: "2026-05-10",
          description: "Office supplies",
          lines: [
            { accountCode: "5000", debit: 200 },
            { accountCode: "1000", credit: 200 },
          ],
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("id", "je-1");
    });
  });

  describe("create_invoice", () => {
    it("rejects if no contact name provided", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_invoice",
        args: { lines: [{ description: "Test", quantity: 1, unitPrice: 100 }] },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Contact name is required");
    });

    it("rejects if no line items provided", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_invoice",
        args: { contactName: "Acme Corp", lines: [] },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("At least one line item");
    });

    it("rejects if contact not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_invoice",
        args: {
          contactName: "Unknown Corp",
          lines: [{ description: "Service", quantity: 1, unitPrice: 100 }],
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("creates an invoice successfully", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c-1", name: "Acme Corp" });
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.invoice.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        contact: { name: "Acme Corp" },
        lines: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
      });

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_invoice",
        args: {
          contactName: "Acme Corp",
          lines: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("number", "INV-0001");
      expect(result.data).toHaveProperty("total", 750);
    });
  });

  describe("create_bill", () => {
    it("rejects if contact not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_bill",
        args: {
          contactName: "Unknown Supplier",
          lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("creates a bill successfully", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c-2", name: "Parts Inc" });
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.bill.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        contact: { name: "Parts Inc" },
        lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
      });

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "create_bill",
        args: {
          contactName: "Parts Inc",
          lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("number", "BILL-0001");
      expect(result.data).toHaveProperty("total", 250);
    });
  });

  describe("get_account_balance", () => {
    it("rejects if no accountCode provided", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "get_account_balance",
        args: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("accountCode is required");
    });

    it("rejects if account not found", async () => {
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "get_account_balance",
        args: { accountCode: "9999" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("computes balance for a debit-normal account", async () => {
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acc-1",
        code: "1000",
        name: "Cash at Bank",
        type: "ASSET",
        normalBalance: "DEBIT",
      });
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { debit: { toNumber: () => 1000 }, credit: null },
        { debit: null, credit: { toNumber: () => 200 } },
        { debit: { toNumber: () => 500 }, credit: null },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "get_account_balance",
        args: { accountCode: "1000" },
      });

      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).balance).toBe(1300);
    });
  });

  describe("list_accounts", () => {
    it("returns accounts list", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { code: "1000", name: "Cash", type: "ASSET" },
        { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "list_accounts",
        args: {},
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe("list_contacts", () => {
    it("returns contacts list", async () => {
      (mockDb.contact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "c-1", name: "Acme Corp", type: "CUSTOMER", email: "acme@test.com" },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "list_contacts",
        args: { type: "CUSTOMER" },
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool", async () => {
      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "nonexistent_tool",
        args: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });
  });

  describe("get_profit_and_loss", () => {
    it("computes P&L from journal lines", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { account: { name: "Sales Revenue", type: "INCOME", normalBalance: "CREDIT" }, debit: null, credit: { toNumber: () => 5000 } },
        { account: { name: "Office Expenses", type: "EXPENSE", normalBalance: "DEBIT" }, debit: { toNumber: () => 1200 }, credit: null },
        { account: { name: "Rent", type: "EXPENSE", normalBalance: "DEBIT" }, debit: { toNumber: () => 800 }, credit: null },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "get_profit_and_loss",
        args: { startDate: "2026-01-01", endDate: "2026-05-10" },
      });

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.totalIncome).toBe(5000);
      expect(data.totalExpenses).toBe(2000);
      expect(data.netProfit).toBe(3000);
    });
  });

  describe("get_ar_aging", () => {
    it("computes aging buckets", async () => {
      const now = new Date();
      const overdue45 = new Date(now.getTime() - 45 * 86400000);
      const due5 = new Date(now.getTime() + 5 * 86400000);

      (mockDb.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          contact: { name: "Client A" },
          dueDate: overdue45,
          totalAmount: { toNumber: () => 1000 },
          amountPaid: { toNumber: () => 0 },
        },
        {
          contact: { name: "Client B" },
          dueDate: due5,
          totalAmount: { toNumber: () => 500 },
          amountPaid: { toNumber: () => 200 },
        },
      ]);

      const result = await executeToolCall(mockDb, ORG_ID, USER_ID, {
        tool: "get_ar_aging",
        args: {},
      });

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      const aging = data.aging as Record<string, number>;
      expect(aging["31-60"]).toBe(1000);
      expect(aging.current).toBe(300);
      expect(data.total).toBe(1300);
    });
  });
});
