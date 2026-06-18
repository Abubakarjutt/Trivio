import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock postInvoiceToLedger / postBillToLedger so createInvoice/createBill
// don't trigger a second db.invoice.findFirst inside the ledger posting step.
vi.mock("@/server/services/invoice.service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/invoice.service")>();
  return { ...mod, postInvoiceToLedger: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/server/services/bill.service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/bill.service")>();
  return { ...mod, postBillToLedger: vi.fn().mockResolvedValue(undefined) };
});

import { executeToolCall } from "@/server/services/chat.service";

/** Mimics Prisma Decimal so both .toNumber() and Number() work in tests */
function dec(n: number) {
  return {
    toNumber: () => n,
    valueOf: () => n,
    toString: () => String(n),
  };
}

const mockDb = {
  chartAccount: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  journalEntry: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
  journalLine: {
    findMany: vi.fn(),
  },
  contact: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  invoice: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  bill: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  budget: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  statementTransaction: {
    findMany: vi.fn(),
  },
  crmLead: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  crmDeal: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  crmActivity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  crmPipeline: {
    findFirst: vi.fn(),
  },
  crmCompany: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  recurringItem: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  goal: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  watchlist: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
} as unknown as Parameters<typeof executeToolCall>[0];

const ORG = "org-123";
const USR = "user-456";
const call = (tool: string, args: Record<string, unknown> = {}) =>
  executeToolCall(mockDb, ORG, USR, { tool, args });

describe("Chat Tool Execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── unknown tool ─────────────────────────────────────────────────────────────

  describe("unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const r = await call("nonexistent_tool");
      expect(r.success).toBe(false);
      expect(r.error).toContain("Unknown tool");
    });
  });

  // ── create_journal_entry ──────────────────────────────────────────────────────

  describe("create_journal_entry", () => {
    it("rejects entries with fewer than 2 lines", async () => {
      const r = await call("create_journal_entry", {
        lines: [{ accountCode: "1000", debit: 100 }],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("at least 2 lines");
    });

    it("rejects unbalanced entries", async () => {
      const r = await call("create_journal_entry", {
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "5000", credit: 50 },
        ],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("must equal credits");
    });

    it("rejects entries with unknown account codes", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "acc-1", code: "1000" },
      ]);
      const r = await call("create_journal_entry", {
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "9999", credit: 100 },
        ],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("9999");
    });

    it("creates a valid balanced journal entry", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "acc-1", code: "1000" },
        { id: "acc-2", code: "5000" },
      ]);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-1",
        date: new Date("2026-05-10"),
        description: "Office supplies",
        lines: [
          { account: { code: "5000", name: "Office Expenses" }, debit: dec(200), credit: null },
          { account: { code: "1000", name: "Cash" }, debit: null, credit: dec(200) },
        ],
      });
      const r = await call("create_journal_entry", {
        date: "2026-05-10",
        description: "Office supplies",
        lines: [
          { accountCode: "5000", debit: 200 },
          { accountCode: "1000", credit: 200 },
        ],
      });
      expect(r.success).toBe(true);
      expect(r.data).toHaveProperty("id", "je-1");
    });

    it("uses today's date when date is omitted", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "acc-1", code: "1000" },
        { id: "acc-2", code: "4000" },
      ]);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-2",
        date: new Date(),
        description: "Revenue",
        lines: [],
      });
      const r = await call("create_journal_entry", {
        description: "Revenue",
        lines: [
          { accountCode: "1000", debit: 500 },
          { accountCode: "4000", credit: 500 },
        ],
      });
      expect(r.success).toBe(true);
      const createArgs = (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.date).toBeInstanceOf(Date);
    });
  });

  // ── create_invoice ────────────────────────────────────────────────────────────

  describe("create_invoice", () => {
    it("rejects missing contact name", async () => {
      const r = await call("create_invoice", {
        lines: [{ description: "Test", quantity: 1, unitPrice: 100 }],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("Contact name is required");
    });

    it("rejects empty line items", async () => {
      const r = await call("create_invoice", { contactName: "Acme", lines: [] });
      expect(r.success).toBe(false);
      expect(r.error).toContain("At least one line item");
    });

    it("rejects when contact not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("create_invoice", {
        contactName: "Ghost Corp",
        lines: [{ description: "Service", quantity: 1, unitPrice: 100 }],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not found");
    });

    it("creates an invoice and computes the correct total", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c-1", name: "Acme Corp" });
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null); // no existing invoice for number
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "acc-ar", code: "1200", name: "Accounts Receivable" })
        .mockResolvedValueOnce({ id: "acc-sales", code: "4000", name: "Sales" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-1" });
      (mockDb.invoice.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        contact: { name: "Acme Corp" },
        lines: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
      });
      const r = await call("create_invoice", {
        contactName: "Acme Corp",
        lines: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
      });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "INV-0001", total: 750, status: "SENT" });
    });
  });

  // ── list_invoices ─────────────────────────────────────────────────────────────

  describe("list_invoices", () => {
    it("returns a list of invoices with mapped fields", async () => {
      (mockDb.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "inv-1",
          number: "INV-0001",
          contact: { name: "Acme Corp" },
          date: new Date("2026-01-15"),
          dueDate: new Date("2026-02-15"),
          totalAmount: dec(1000),
          amountPaid: dec(0),
          status: "SENT",
        },
        {
          id: "inv-2",
          number: "INV-0002",
          contact: { name: "Beta Ltd" },
          date: new Date("2026-02-01"),
          dueDate: new Date("2026-03-01"),
          totalAmount: dec(500),
          amountPaid: dec(500),
          status: "PAID",
        },
      ]);
      const r = await call("list_invoices", { status: "ALL" });
      expect(r.success).toBe(true);
      const data = r.data as unknown[];
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        number: "INV-0001",
        customer: "Acme Corp",
        total: 1000,
        outstanding: 1000,
        status: "SENT",
      });
      expect(data[1]).toMatchObject({ outstanding: 0, status: "PAID" });
    });

    it("returns empty array when no invoices match", async () => {
      (mockDb.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const r = await call("list_invoices", { status: "PAID" });
      expect(r.success).toBe(true);
      expect(r.data).toHaveLength(0);
    });
  });

  // ── get_invoice ───────────────────────────────────────────────────────────────

  describe("get_invoice", () => {
    it("rejects missing invoiceNumber", async () => {
      const r = await call("get_invoice", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("invoiceNumber is required");
    });

    it("returns error when invoice not found", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("get_invoice", { invoiceNumber: "INV-9999" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not found");
    });

    it("returns full invoice detail including line items", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        contact: { name: "Acme Corp" },
        date: new Date("2026-01-15"),
        dueDate: new Date("2026-02-15"),
        status: "SENT",
        subtotal: dec(1000),
        totalAmount: dec(1000),
        amountPaid: dec(200),
        notes: "Net 30",
        lines: [
          {
            description: "Consulting",
            quantity: dec(5),
            unitPrice: dec(200),
            amount: dec(1000),
          },
        ],
      });
      const r = await call("get_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      expect(d).toMatchObject({
        number: "INV-0001",
        customer: "Acme Corp",
        total: 1000,
        amountPaid: 200,
        outstanding: 800,
        status: "SENT",
      });
      const lines = d.lines as unknown[];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ description: "Consulting", quantity: 5, unitPrice: 200 });
    });
  });

  // ── send_invoice ──────────────────────────────────────────────────────────────

  describe("send_invoice", () => {
    it("rejects missing invoiceNumber", async () => {
      const r = await call("send_invoice", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("invoiceNumber is required");
    });

    it("rejects sending a voided invoice", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "VOID",
      });
      const r = await call("send_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("voided");
    });

    it("marks invoice as SENT and returns updated status", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "DRAFT",
      });
      (mockDb.invoice.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("send_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "INV-0001", status: "SENT" });
      expect(mockDb.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "SENT" } }),
      );
    });
  });

  // ── record_invoice_payment ────────────────────────────────────────────────────

  describe("record_invoice_payment", () => {
    it("rejects missing invoiceNumber", async () => {
      const r = await call("record_invoice_payment", { amount: 100 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("invoiceNumber is required");
    });

    it("rejects zero or negative amount", async () => {
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: -50 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("positive number");
    });

    it("rejects payment on voided invoice", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "VOID",
        totalAmount: dec(1000),
        amountPaid: dec(0),
      });
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: 500 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("voided");
    });

    it("rejects payment on already-paid invoice", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "PAID",
        totalAmount: dec(1000),
        amountPaid: dec(1000),
      });
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: 100 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already fully paid");
    });

    it("rejects payment exceeding outstanding balance", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "SENT",
        totalAmount: dec(500),
        amountPaid: dec(0),
      });
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "cash", name: "Cash" })
        .mockResolvedValueOnce({ id: "ar", name: "Accounts Receivable" });
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: 600 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("exceeds outstanding");
    });

    it("records full payment and sets status to PAID", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "SENT",
        totalAmount: dec(1000),
        amountPaid: dec(0),
      });
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "cash", name: "Cash at Bank" })
        .mockResolvedValueOnce({ id: "ar", name: "Accounts Receivable" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-pay" });
      (mockDb.invoice.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: 1000 });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({
        number: "INV-0001",
        amountPaid: 1000,
        newStatus: "PAID",
        cashAccount: "Cash at Bank",
      });
      expect(mockDb.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
      );
    });

    it("records partial payment and sets status to PARTIAL", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "SENT",
        totalAmount: dec(1000),
        amountPaid: dec(0),
      });
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "cash", name: "Cash" })
        .mockResolvedValueOnce({ id: "ar", name: "Accounts Receivable" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-pay" });
      (mockDb.invoice.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("record_invoice_payment", { invoiceNumber: "INV-0001", amount: 400 });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ newStatus: "PARTIAL", amountPaid: 400 });
    });
  });

  // ── void_invoice ──────────────────────────────────────────────────────────────

  describe("void_invoice", () => {
    it("rejects missing invoiceNumber", async () => {
      const r = await call("void_invoice", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("invoiceNumber is required");
    });

    it("rejects voiding an already-voided invoice", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "VOID",
        journalEntryId: null,
      });
      const r = await call("void_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already voided");
    });

    it("voids invoice and creates reversal journal entry", async () => {
      (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "SENT",
        journalEntryId: "je-orig",
      });
      (mockDb.journalEntry.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (mockDb.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-orig",
        description: "Invoice INV-0001",
        source: "INVOICE",
        reference: null,
        sourceId: "inv-1",
        isVoid: false,
        lines: [
          { accountId: "acc-ar", debit: dec(1000), credit: null, description: "AR" },
          { accountId: "acc-sales", debit: null, credit: dec(1000), description: "Sales" },
        ],
      });
      (mockDb.journalEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      (mockDb.invoice.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("void_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "INV-0001", status: "VOID" });
      expect(mockDb.journalEntry.create).toHaveBeenCalledOnce();
      expect(mockDb.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "VOID" } }),
      );
    });

    it("voids invoice with no linked journal entry (no reversal needed)", async () => {
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "DRAFT",
        journalEntryId: null,
      });
      (mockDb.journalEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockDb.invoice.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("void_invoice", { invoiceNumber: "INV-0001" });
      expect(r.success).toBe(true);
      expect(mockDb.journalEntry.create).not.toHaveBeenCalled();
    });
  });

  // ── create_bill ───────────────────────────────────────────────────────────────

  describe("create_bill", () => {
    it("rejects missing contact name", async () => {
      const r = await call("create_bill", {
        lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("Contact name is required");
    });

    it("rejects when supplier not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("create_bill", {
        contactName: "Unknown Supplier",
        lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not found");
    });

    it("creates a bill and computes the correct total", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c-2", name: "Parts Inc" });
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "acc-ap", code: "2100", name: "Accounts Payable" })
        .mockResolvedValueOnce({ id: "acc-exp", code: "5000", name: "Purchases" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-2" });
      (mockDb.bill.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        contact: { name: "Parts Inc" },
        lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
      });
      const r = await call("create_bill", {
        contactName: "Parts Inc",
        lines: [{ description: "Parts", quantity: 10, unitPrice: 25 }],
      });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "BILL-0001", total: 250 });
    });
  });

  // ── list_bills ────────────────────────────────────────────────────────────────

  describe("list_bills", () => {
    it("returns a list of bills with computed outstanding", async () => {
      (mockDb.bill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "bill-1",
          number: "BILL-0001",
          contact: { name: "Parts Inc" },
          date: new Date("2026-03-01"),
          dueDate: new Date("2026-04-01"),
          totalAmount: dec(250),
          amountPaid: dec(0),
          status: "SENT",
        },
      ]);
      const r = await call("list_bills", {});
      expect(r.success).toBe(true);
      const data = r.data as unknown[];
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        number: "BILL-0001",
        supplier: "Parts Inc",
        total: 250,
        outstanding: 250,
        status: "SENT",
      });
    });
  });

  // ── get_bill ──────────────────────────────────────────────────────────────────

  describe("get_bill", () => {
    it("rejects missing billNumber", async () => {
      const r = await call("get_bill", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("billNumber is required");
    });

    it("returns full bill detail with lines", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        contact: { name: "Parts Inc" },
        date: new Date("2026-03-01"),
        dueDate: new Date("2026-04-01"),
        status: "SENT",
        totalAmount: dec(250),
        amountPaid: dec(0),
        notes: null,
        lines: [{ description: "Parts", quantity: dec(10), unitPrice: dec(25), amount: dec(250) }],
      });
      const r = await call("get_bill", { billNumber: "BILL-0001" });
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      expect(d).toMatchObject({
        number: "BILL-0001",
        supplier: "Parts Inc",
        total: 250,
        outstanding: 250,
      });
      expect(d.lines as unknown[]).toHaveLength(1);
    });
  });

  // ── approve_bill ──────────────────────────────────────────────────────────────

  describe("approve_bill", () => {
    it("rejects approving a non-draft bill", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "SENT",
      });
      const r = await call("approve_bill", { billNumber: "BILL-0001" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not a draft");
    });

    it("approves a draft bill", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "DRAFT",
      });
      (mockDb.bill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("approve_bill", { billNumber: "BILL-0001" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "BILL-0001", status: "SENT" });
    });
  });

  // ── record_bill_payment ───────────────────────────────────────────────────────

  describe("record_bill_payment", () => {
    it("rejects payment on voided bill", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "VOID",
        totalAmount: dec(500),
        amountPaid: dec(0),
      });
      const r = await call("record_bill_payment", { billNumber: "BILL-0001", amount: 500 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("voided");
    });

    it("records full payment and sets status to PAID", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "SENT",
        totalAmount: dec(500),
        amountPaid: dec(0),
      });
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "cash", name: "Cash" })
        .mockResolvedValueOnce({ id: "ap", name: "Accounts Payable" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-bill-pay" });
      (mockDb.bill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("record_bill_payment", { billNumber: "BILL-0001", amount: 500 });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ newStatus: "PAID", amountPaid: 500 });
    });

    it("records partial payment", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "SENT",
        totalAmount: dec(500),
        amountPaid: dec(0),
      });
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "cash", name: "Cash" })
        .mockResolvedValueOnce({ id: "ap", name: "Accounts Payable" });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-partial" });
      (mockDb.bill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("record_bill_payment", { billNumber: "BILL-0001", amount: 200 });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ newStatus: "PARTIAL", amountPaid: 200 });
    });
  });

  // ── void_bill ─────────────────────────────────────────────────────────────────

  describe("void_bill", () => {
    it("rejects voiding an already-voided bill", async () => {
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "VOID",
        journalEntryId: null,
      });
      const r = await call("void_bill", { billNumber: "BILL-0001" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already voided");
    });

    it("voids bill and creates reversal entry", async () => {
      (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "SENT",
        journalEntryId: "je-orig",
      });
      (mockDb.journalEntry.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (mockDb.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-orig",
        description: "Bill BILL-0001",
        source: "BILL",
        reference: null,
        sourceId: "bill-1",
        isVoid: false,
        lines: [
          { accountId: "acc-exp", debit: dec(500), credit: null, description: "Expense" },
          { accountId: "acc-ap", debit: null, credit: dec(500), description: "AP" },
        ],
      });
      (mockDb.journalEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      (mockDb.bill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("void_bill", { billNumber: "BILL-0001" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ number: "BILL-0001", status: "VOID" });
      expect(mockDb.journalEntry.create).toHaveBeenCalledOnce();
    });
  });

  // ── void_transaction ──────────────────────────────────────────────────────────

  describe("void_transaction", () => {
    it("rejects missing transactionId", async () => {
      const r = await call("void_transaction", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("transactionId is required");
    });

    it("rejects voiding an already-voided transaction", async () => {
      (mockDb.journalEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-1",
        description: "Old entry",
        isVoid: true,
        lines: [],
      });
      const r = await call("void_transaction", { transactionId: "je-1" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already voided");
    });

    it("creates reversal entry and marks original as void", async () => {
      (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
      const originalEntry = {
        id: "je-1",
        description: "Salary payment",
        source: "MANUAL" as const,
        reference: null,
        sourceId: null,
        isVoid: false,
        lines: [
          { accountId: "acc-salary", debit: dec(3000), credit: null, description: "Salary" },
          { accountId: "acc-cash", debit: null, credit: dec(3000), description: "Cash" },
        ],
      };
      (mockDb.journalEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(originalEntry);
      (mockDb.journalEntry.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (mockDb.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(originalEntry);
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      const r = await call("void_transaction", { transactionId: "je-1" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ id: "je-1", description: "Salary payment" });
      // Reversal entry flips debit/credit
      const createCall = (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const reversalLines = createCall.data.lines.create as { debit: unknown; credit: unknown }[];
      expect(reversalLines[0].debit).toBeNull();
      expect(reversalLines[0].credit).not.toBeNull();
      expect(mockDb.journalEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isVoid: true }) }),
      );
    });
  });

  // ── create_contact ────────────────────────────────────────────────────────────

  describe("create_contact", () => {
    it("rejects missing name", async () => {
      const r = await call("create_contact", { type: "CUSTOMER" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("name is required");
    });

    it("rejects invalid type", async () => {
      const r = await call("create_contact", { name: "Acme", type: "VENDOR" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("type must be");
    });

    it("rejects duplicate contact name", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "existing",
        name: "Acme Corp",
      });
      const r = await call("create_contact", { name: "Acme Corp", type: "CUSTOMER" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already exists");
    });

    it("creates a new contact", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.contact.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "c-new",
        name: "New Customer",
        type: "CUSTOMER",
      });
      const r = await call("create_contact", {
        name: "New Customer",
        type: "CUSTOMER",
        email: "new@example.com",
      });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ id: "c-new", name: "New Customer", type: "CUSTOMER" });
    });
  });

  // ── update_contact ────────────────────────────────────────────────────────────

  describe("update_contact", () => {
    it("rejects missing current name", async () => {
      const r = await call("update_contact", { newName: "New Name" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("name (current name) is required");
    });

    it("rejects when contact not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("update_contact", { name: "Ghost Corp" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not found");
    });

    it("updates contact fields", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "c-1",
        name: "Old Name",
        type: "CUSTOMER",
      });
      (mockDb.contact.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "c-1",
        name: "New Name",
        type: "CUSTOMER",
      });
      const r = await call("update_contact", { name: "Old Name", newName: "New Name" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ name: "New Name" });
    });
  });

  // ── create_account ────────────────────────────────────────────────────────────

  describe("create_account", () => {
    it("rejects missing code", async () => {
      const r = await call("create_account", { name: "New Account", type: "ASSET" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("code is required");
    });

    it("rejects invalid account type", async () => {
      const r = await call("create_account", { code: "9999", name: "Bad Type", type: "INVALID" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("type must be");
    });

    it("rejects duplicate account code", async () => {
      (mockDb.chartAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acc-existing",
        code: "1000",
      });
      const r = await call("create_account", { code: "1000", name: "Duplicate", type: "ASSET" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("already exists");
    });

    it("infers DEBIT normal balance for ASSET accounts", async () => {
      (mockDb.chartAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.chartAccount.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: "1500",
        name: "Equipment",
        type: "ASSET",
      });
      await call("create_account", { code: "1500", name: "Equipment", type: "ASSET" });
      const createCall = (mockDb.chartAccount.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.data.normalBalance).toBe("DEBIT");
    });

    it("infers CREDIT normal balance for INCOME accounts", async () => {
      (mockDb.chartAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.chartAccount.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: "4100",
        name: "Service Revenue",
        type: "INCOME",
      });
      await call("create_account", { code: "4100", name: "Service Revenue", type: "INCOME" });
      const createCall = (mockDb.chartAccount.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.data.normalBalance).toBe("CREDIT");
    });

    it("creates account and returns it", async () => {
      (mockDb.chartAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.chartAccount.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: "5500",
        name: "Advertising",
        type: "EXPENSE",
      });
      const r = await call("create_account", { code: "5500", name: "Advertising", type: "EXPENSE" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ code: "5500", name: "Advertising", type: "EXPENSE" });
    });
  });

  // ── list_accounts ─────────────────────────────────────────────────────────────

  describe("list_accounts", () => {
    it("returns all accounts", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { code: "1000", name: "Cash", type: "ASSET" },
        { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
      ]);
      const r = await call("list_accounts", {});
      expect(r.success).toBe(true);
      expect(r.data).toHaveLength(2);
    });

    it("passes type filter to query", async () => {
      (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("list_accounts", { type: "ASSET" });
      const whereArg = (mockDb.chartAccount.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
      expect(whereArg.type).toBe("ASSET");
    });
  });

  // ── list_contacts ─────────────────────────────────────────────────────────────

  describe("list_contacts", () => {
    it("returns contacts list", async () => {
      (mockDb.contact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "c-1", name: "Acme Corp", type: "CUSTOMER", email: "acme@test.com" },
      ]);
      const r = await call("list_contacts", { type: "CUSTOMER" });
      expect(r.success).toBe(true);
      expect(r.data).toHaveLength(1);
    });
  });

  // ── get_account_balance ───────────────────────────────────────────────────────

  describe("get_account_balance", () => {
    it("rejects missing accountCode", async () => {
      const r = await call("get_account_balance", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("accountCode is required");
    });

    it("rejects unknown account", async () => {
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("get_account_balance", { accountCode: "9999" });
      expect(r.success).toBe(false);
      expect(r.error).toContain("not found");
    });

    it("computes balance correctly for a DEBIT-normal account", async () => {
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acc-1",
        code: "1000",
        name: "Cash at Bank",
        type: "ASSET",
        normalBalance: "DEBIT",
      });
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { debit: dec(1000), credit: null },
        { debit: null, credit: dec(200) },
        { debit: dec(500), credit: null },
      ]);
      const r = await call("get_account_balance", { accountCode: "1000" });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).balance).toBe(1300); // 1500 - 200
    });

    it("computes balance correctly for a CREDIT-normal account", async () => {
      (mockDb.chartAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acc-ap",
        code: "2100",
        name: "Accounts Payable",
        type: "LIABILITY",
        normalBalance: "CREDIT",
      });
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { debit: null, credit: dec(800) },
        { debit: dec(300), credit: null },
      ]);
      const r = await call("get_account_balance", { accountCode: "2100" });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).balance).toBe(500); // 800 - 300
    });
  });

  // ── search_transactions ───────────────────────────────────────────────────────

  describe("search_transactions", () => {
    it("returns matching journal entries with lines", async () => {
      (mockDb.journalEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "je-1",
          date: new Date("2026-04-10"),
          description: "Salary payment",
          lines: [
            { account: { code: "6000", name: "Salaries" }, debit: dec(3000), credit: null },
            { account: { code: "1000", name: "Cash" }, debit: null, credit: dec(3000) },
          ],
        },
      ]);
      const r = await call("search_transactions", { query: "salary" });
      expect(r.success).toBe(true);
      const data = r.data as unknown[];
      expect(data).toHaveLength(1);
      expect((data[0] as Record<string, unknown>).description).toBe("Salary payment");
      const lines = (data[0] as Record<string, unknown>).lines as unknown[];
      expect(lines).toHaveLength(2);
    });

    it("returns empty array when no matches", async () => {
      (mockDb.journalEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const r = await call("search_transactions", { query: "xyz_no_match" });
      expect(r.success).toBe(true);
      expect(r.data).toHaveLength(0);
    });
  });

  // ── get_profit_and_loss ───────────────────────────────────────────────────────

  describe("get_profit_and_loss", () => {
    it("computes income, expenses, and net profit", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          account: { name: "Sales Revenue", type: "INCOME" },
          debit: null,
          credit: dec(5000),
        },
        {
          account: { name: "Office Expenses", type: "EXPENSE" },
          debit: dec(1200),
          credit: null,
        },
        {
          account: { name: "Rent", type: "EXPENSE" },
          debit: dec(800),
          credit: null,
        },
      ]);
      const r = await call("get_profit_and_loss", {
        startDate: "2026-01-01",
        endDate: "2026-05-10",
      });
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      expect(d.totalIncome).toBe(5000);
      expect(d.totalExpenses).toBe(2000);
      expect(d.netProfit).toBe(3000);
    });

    it("reports a net loss when expenses exceed income", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { account: { name: "Sales", type: "INCOME" }, debit: null, credit: dec(1000) },
        { account: { name: "Salaries", type: "EXPENSE" }, debit: dec(3000), credit: null },
      ]);
      const r = await call("get_profit_and_loss", {});
      const d = r.data as Record<string, unknown>;
      expect(d.netProfit).toBe(-2000);
    });
  });

  // ── get_balance_sheet ─────────────────────────────────────────────────────────

  describe("get_balance_sheet", () => {
    it("groups accounts by type and computes totals", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          account: { name: "Cash", type: "ASSET", normalBalance: "DEBIT" },
          debit: dec(5000),
          credit: null,
        },
        {
          account: { name: "Accounts Payable", type: "LIABILITY", normalBalance: "CREDIT" },
          debit: null,
          credit: dec(2000),
        },
        {
          account: { name: "Owner Equity", type: "EQUITY", normalBalance: "CREDIT" },
          debit: null,
          credit: dec(3000),
        },
      ]);
      const r = await call("get_balance_sheet", { asOfDate: "2026-05-10" });
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      expect(d.totalAssets).toBe(5000);
      expect(d.totalLiabilities).toBe(2000);
      expect(d.totalEquity).toBe(3000);
    });

    it("uses today's date when asOfDate is omitted", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("get_balance_sheet", {});
      expect(mockDb.journalLine.findMany).toHaveBeenCalledOnce();
    });
  });

  // ── get_trial_balance ─────────────────────────────────────────────────────────

  describe("get_trial_balance", () => {
    it("accumulates debits and credits per account and balances", async () => {
      (mockDb.journalLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { account: { code: "1000", name: "Cash" }, debit: dec(3000), credit: null },
        { account: { code: "4000", name: "Revenue" }, debit: null, credit: dec(3000) },
        { account: { code: "1000", name: "Cash" }, debit: dec(500), credit: null },
      ]);
      const r = await call("get_trial_balance", {});
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      expect(d.totalDebit).toBe(3500);
      expect(d.totalCredit).toBe(3000);
      const accounts = d.accounts as Record<string, { debit: number; credit: number }>;
      expect(accounts["1000 - Cash"].debit).toBe(3500);
    });
  });

  // ── get_ar_aging ──────────────────────────────────────────────────────────────

  describe("get_ar_aging", () => {
    it("places invoices in correct aging buckets", async () => {
      const now = new Date();
      const overdue45 = new Date(now.getTime() - 45 * 86_400_000);
      const dueFuture = new Date(now.getTime() + 5 * 86_400_000);

      (mockDb.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          contact: { name: "Client A" },
          dueDate: overdue45,
          totalAmount: dec(1000),
          amountPaid: dec(0),
        },
        {
          contact: { name: "Client B" },
          dueDate: dueFuture,
          totalAmount: dec(500),
          amountPaid: dec(200),
        },
      ]);

      const r = await call("get_ar_aging", {});
      expect(r.success).toBe(true);
      const d = r.data as Record<string, unknown>;
      const aging = d.aging as Record<string, number>;
      expect(aging["31-60"]).toBe(1000); // 45 days overdue → 31-60 bucket
      expect(aging.current).toBe(300);   // due in future → current, outstanding = 300
      expect(d.total).toBe(1300);
    });

    it("places invoices overdue 90+ days in the correct bucket", async () => {
      const now = new Date();
      const overdue100 = new Date(now.getTime() - 100 * 86_400_000);
      (mockDb.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          contact: { name: "Client C" },
          dueDate: overdue100,
          totalAmount: dec(750),
          amountPaid: dec(0),
        },
      ]);
      const r = await call("get_ar_aging", {});
      const aging = (r.data as Record<string, unknown>).aging as Record<string, number>;
      expect(aging["90+"]).toBe(750);
    });
  });

  // ── get_ap_aging ──────────────────────────────────────────────────────────────

  describe("get_ap_aging", () => {
    it("buckets overdue bills correctly", async () => {
      const now = new Date();
      const overdue20 = new Date(now.getTime() - 20 * 86_400_000);
      (mockDb.bill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          contact: { name: "Supplier X" },
          dueDate: overdue20,
          totalAmount: dec(400),
          amountPaid: dec(100),
        },
      ]);
      const r = await call("get_ap_aging", {});
      expect(r.success).toBe(true);
      const aging = (r.data as Record<string, unknown>).aging as Record<string, number>;
      expect(aging["1-30"]).toBe(300); // outstanding = 300, overdue 20 days
    });
  });

  // ── set_budget ───────────────────────────────────────────────────────────────

  describe("set_budget", () => {
    it("creates a new budget when none exists", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.budget.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "Food & Dining",
        limitAmount: dec(5000),
        period: "MONTHLY",
      });

      const r = await call("set_budget", { category: "Food & Dining", limitAmount: 5000 });

      expect(r.success).toBe(true);
      expect(mockDb.budget.create).toHaveBeenCalledTimes(1);
      expect(mockDb.budget.update).not.toHaveBeenCalled();
      const data = r.data as Record<string, unknown>;
      expect(data.category).toBe("Food & Dining");
      expect(data.limitAmount).toBe(5000);
      expect(data.action).toBe("created");
    });

    it("updates an existing budget", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "bud-1" });
      (mockDb.budget.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "Transport",
        limitAmount: dec(3000),
        period: "MONTHLY",
      });

      const r = await call("set_budget", { category: "Transport", limitAmount: 3000 });

      expect(r.success).toBe(true);
      expect(mockDb.budget.update).toHaveBeenCalledTimes(1);
      expect(mockDb.budget.create).not.toHaveBeenCalled();
      const data = r.data as Record<string, unknown>;
      expect(data.action).toBe("updated");
    });

    it("uses custom period when provided", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.budget.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "Shopping",
        limitAmount: dec(10000),
        period: "QUARTERLY",
      });

      const r = await call("set_budget", { category: "Shopping", limitAmount: 10000, period: "QUARTERLY" });

      expect(r.success).toBe(true);
      const createArgs = (mockDb.budget.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.period).toBe("QUARTERLY");
    });

    it("defaults to MONTHLY period for unknown period values", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.budget.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "Other",
        limitAmount: dec(1000),
        period: "MONTHLY",
      });

      const r = await call("set_budget", { category: "Other", limitAmount: 1000, period: "INVALID" });

      expect(r.success).toBe(true);
      const createArgs = (mockDb.budget.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.period).toBe("MONTHLY");
    });

    it("rejects missing category", async () => {
      const r = await call("set_budget", { limitAmount: 5000 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("category");
    });

    it("rejects zero limitAmount", async () => {
      const r = await call("set_budget", { category: "Food & Dining", limitAmount: 0 });
      expect(r.success).toBe(false);
      expect(r.error).toContain("limitAmount");
    });

    it("rejects negative limitAmount", async () => {
      const r = await call("set_budget", { category: "Food & Dining", limitAmount: -500 });
      expect(r.success).toBe(false);
    });
  });

  // ── set_budgets ──────────────────────────────────────────────────────────────

  describe("set_budgets", () => {
    it("saves multiple budgets and returns count", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.budget.create as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ category: "Food & Dining", limitAmount: dec(5000), period: "MONTHLY" })
        .mockResolvedValueOnce({ category: "Transport",     limitAmount: dec(2000), period: "MONTHLY" })
        .mockResolvedValueOnce({ category: "Shopping",      limitAmount: dec(3000), period: "MONTHLY" });

      const r = await call("set_budgets", {
        budgets: [
          { category: "Food & Dining", limitAmount: 5000 },
          { category: "Transport",     limitAmount: 2000 },
          { category: "Shopping",      limitAmount: 3000 },
        ],
      });

      expect(r.success).toBe(true);
      const data = r.data as Record<string, unknown>;
      expect(data.saved).toBe(3);
      const budgets = data.budgets as Array<{ category: string; limitAmount: number }>;
      expect(budgets).toHaveLength(3);
      expect(budgets[0].category).toBe("Food & Dining");
      expect(budgets[1].category).toBe("Transport");
      expect(budgets[2].category).toBe("Shopping");
    });

    it("updates existing budgets during a readjustment", async () => {
      (mockDb.budget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "bud-1" });
      (mockDb.budget.update as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ category: "Food & Dining", limitAmount: dec(4500), period: "MONTHLY" })
        .mockResolvedValueOnce({ category: "Transport",     limitAmount: dec(1800), period: "MONTHLY" });

      const r = await call("set_budgets", {
        budgets: [
          { category: "Food & Dining", limitAmount: 4500 },
          { category: "Transport",     limitAmount: 1800 },
        ],
      });

      expect(r.success).toBe(true);
      expect(mockDb.budget.update).toHaveBeenCalledTimes(2);
      expect(mockDb.budget.create).not.toHaveBeenCalled();
    });

    it("rejects missing budgets array", async () => {
      const r = await call("set_budgets", {});
      expect(r.success).toBe(false);
      expect(r.error).toContain("budgets array");
    });

    it("rejects empty budgets array", async () => {
      const r = await call("set_budgets", { budgets: [] });
      expect(r.success).toBe(false);
    });
  });

  // ── list_budgets ─────────────────────────────────────────────────────────────

  describe("list_budgets", () => {
    it("returns all budgets with spent and remaining amounts", async () => {
      (mockDb.budget.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "b1", category: "Food & Dining", limitAmount: dec(5000), period: "MONTHLY" },
        { id: "b2", category: "Transport",     limitAmount: dec(2000), period: "MONTHLY" },
      ]);
      (mockDb.statementTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { category: "Food & Dining", amount: dec(1200) },
        { category: "Food & Dining", amount: dec(800) },
        { category: "Transport",     amount: dec(500) },
      ]);

      const r = await call("list_budgets", {});

      expect(r.success).toBe(true);
      const data = r.data as { budgets: Array<{ category: string; limit: number; spent: number; remaining: number; period: string }> };
      expect(data.budgets).toHaveLength(2);

      const food = data.budgets.find((b) => b.category === "Food & Dining")!;
      expect(food.limit).toBe(5000);
      expect(food.spent).toBe(2000);
      expect(food.remaining).toBe(3000);

      const transport = data.budgets.find((b) => b.category === "Transport")!;
      expect(transport.spent).toBe(500);
      expect(transport.remaining).toBe(1500);
    });

    it("returns empty list when no budgets are set", async () => {
      (mockDb.budget.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockDb.statementTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const r = await call("list_budgets", {});

      expect(r.success).toBe(true);
      const data = r.data as { budgets: unknown[] };
      expect(data.budgets).toHaveLength(0);
    });

    it("clamps remaining to 0 when spending exceeds limit", async () => {
      (mockDb.budget.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "b1", category: "Entertainment", limitAmount: dec(1000), period: "MONTHLY" },
      ]);
      (mockDb.statementTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { category: "Entertainment", amount: dec(1500) },
      ]);

      const r = await call("list_budgets", {});

      const data = r.data as { budgets: Array<{ remaining: number }> };
      expect(data.budgets[0].remaining).toBe(0);
    });

    it("categories with no transactions show zero spent", async () => {
      (mockDb.budget.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "b1", category: "Travel", limitAmount: dec(8000), period: "MONTHLY" },
      ]);
      (mockDb.statementTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const r = await call("list_budgets", {});

      const data = r.data as { budgets: Array<{ category: string; spent: number; remaining: number }> };
      expect(data.budgets[0].spent).toBe(0);
      expect(data.budgets[0].remaining).toBe(8000);
    });
  });

  // ── CRM — Leads ──────────────────────────────────────────────────────────────

  describe("create_crm_lead", () => {
    it("rejects missing firstName", async () => {
      const r = await call("create_crm_lead", { lastName: "Smith" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/firstName/i);
    });

    it("rejects missing lastName", async () => {
      const r = await call("create_crm_lead", { firstName: "John" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/lastName/i);
    });

    it("creates a lead with defaults", async () => {
      (mockDb.crmLead.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "lead-1", firstName: "John", lastName: "Smith", status: "NEW", source: "OTHER",
      });
      const r = await call("create_crm_lead", { firstName: "John", lastName: "Smith" });
      expect(r.success).toBe(true);
      const d = r.data as { name: string; status: string; source: string };
      expect(d.name).toBe("John Smith");
      expect(d.status).toBe("NEW");
      expect(d.source).toBe("OTHER");
    });

    it("maps a valid source enum", async () => {
      (mockDb.crmLead.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "lead-2", firstName: "Jane", lastName: "Doe", status: "NEW", source: "REFERRAL",
      });
      const r = await call("create_crm_lead", { firstName: "Jane", lastName: "Doe", source: "REFERRAL" });
      expect(r.success).toBe(true);
      const d = r.data as { source: string };
      expect(d.source).toBe("REFERRAL");
    });

    it("falls back to OTHER for unknown source", async () => {
      (mockDb.crmLead.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "lead-3", firstName: "X", lastName: "Y", status: "NEW", source: "OTHER",
      });
      const r = await call("create_crm_lead", { firstName: "X", lastName: "Y", source: "INVALID_SOURCE" });
      expect(r.success).toBe(true);
      expect((mockDb.crmLead.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.source).toBe("OTHER");
    });
  });

  describe("list_crm_leads", () => {
    it("returns mapped lead list", async () => {
      (mockDb.crmLead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "l1", firstName: "Alice", lastName: "Wang", companyName: "Acme", email: "a@acme.com", status: "NEW", source: "WEBSITE", estimatedValue: dec(5000) },
      ]);
      const r = await call("list_crm_leads", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ name: string; estimatedValue: number }>;
      expect(data[0].name).toBe("Alice Wang");
      expect(data[0].estimatedValue).toBe(5000);
    });

    it("passes status filter", async () => {
      (mockDb.crmLead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("list_crm_leads", { status: "QUALIFIED" });
      expect((mockDb.crmLead.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where.status).toBe("QUALIFIED");
    });

    it("ignores invalid status filter", async () => {
      (mockDb.crmLead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("list_crm_leads", { status: "BOGUS" });
      expect((mockDb.crmLead.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where.status).toBeUndefined();
    });
  });

  describe("update_crm_lead_status", () => {
    it("rejects missing leadId", async () => {
      const r = await call("update_crm_lead_status", { status: "CONTACTED" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/leadId/i);
    });

    it("rejects invalid status", async () => {
      const r = await call("update_crm_lead_status", { leadId: "l1", status: "FLYING" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/status/i);
    });

    it("returns error when lead not found", async () => {
      (mockDb.crmLead.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("update_crm_lead_status", { leadId: "missing", status: "CONTACTED" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("updates lead status and sets convertedAt when CONVERTED", async () => {
      (mockDb.crmLead.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "l1", firstName: "J", lastName: "D" });
      (mockDb.crmLead.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "l1", firstName: "J", lastName: "D", status: "CONVERTED" });
      const r = await call("update_crm_lead_status", { leadId: "l1", status: "CONVERTED" });
      expect(r.success).toBe(true);
      const updateArgs = (mockDb.crmLead.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateArgs.data.convertedAt).toBeInstanceOf(Date);
    });

    it("does not set convertedAt for non-CONVERTED status", async () => {
      (mockDb.crmLead.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "l1", firstName: "J", lastName: "D" });
      (mockDb.crmLead.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "l1", firstName: "J", lastName: "D", status: "CONTACTED" });
      await call("update_crm_lead_status", { leadId: "l1", status: "CONTACTED" });
      const updateArgs = (mockDb.crmLead.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateArgs.data.convertedAt).toBeUndefined();
    });
  });

  // ── CRM — Deals ──────────────────────────────────────────────────────────────

  describe("create_crm_deal", () => {
    it("rejects missing name", async () => {
      const r = await call("create_crm_deal", { contactName: "Alice" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/name/i);
    });

    it("rejects missing contactName", async () => {
      const r = await call("create_crm_deal", { name: "Big Deal" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/contactName/i);
    });

    it("returns error when contact not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("create_crm_deal", { name: "Deal", contactName: "Nobody" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("returns error when no pipeline exists", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1", name: "Alice" });
      (mockDb.crmPipeline.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("create_crm_deal", { name: "Deal", contactName: "Alice" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/pipeline/i);
    });

    it("creates deal using first pipeline stage", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1", name: "Alice" });
      (mockDb.crmPipeline.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pipe-1", name: "Sales", stages: [
          { id: "s1", name: "Prospect", order: 1, probability: 10 },
          { id: "s2", name: "Proposal", order: 2, probability: 50 },
        ],
      });
      (mockDb.crmDeal.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "d1", name: "Deal", value: dec(1000),
      });
      const r = await call("create_crm_deal", { name: "Deal", contactName: "Alice", value: 1000 });
      expect(r.success).toBe(true);
      const createArgs = (mockDb.crmDeal.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.stageId).toBe("s1");
    });

    it("picks named stage when stageName matches", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1", name: "Alice" });
      (mockDb.crmPipeline.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pipe-1", name: "Sales", stages: [
          { id: "s1", name: "Prospect", order: 1, probability: 10 },
          { id: "s2", name: "Proposal", order: 2, probability: 50 },
        ],
      });
      (mockDb.crmDeal.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", name: "Deal", value: dec(0) });
      await call("create_crm_deal", { name: "Deal", contactName: "Alice", stageName: "Proposal" });
      const createArgs = (mockDb.crmDeal.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.stageId).toBe("s2");
    });
  });

  describe("list_crm_deals", () => {
    it("returns mapped deal list", async () => {
      (mockDb.crmDeal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "d1", name: "Big Deal", value: dec(5000), contact: { name: "Alice" }, stage: { name: "Proposal" }, expectedCloseDate: null, probability: 50 },
      ]);
      const r = await call("list_crm_deals", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ name: string; value: number; stage: string }>;
      expect(data[0].name).toBe("Big Deal");
      expect(data[0].value).toBe(5000);
      expect(data[0].stage).toBe("Proposal");
    });
  });

  describe("move_crm_deal", () => {
    it("rejects missing dealId", async () => {
      const r = await call("move_crm_deal", { stageName: "Won" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/dealId/i);
    });

    it("rejects missing stageName", async () => {
      const r = await call("move_crm_deal", { dealId: "d1" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/stageName/i);
    });

    it("returns error when deal not found", async () => {
      (mockDb.crmDeal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("move_crm_deal", { dealId: "missing", stageName: "Won" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("returns error when stage name not in pipeline", async () => {
      (mockDb.crmDeal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "d1", name: "Deal", pipeline: { name: "Sales", stages: [{ id: "s1", name: "Prospect", probability: 10 }] },
      });
      const r = await call("move_crm_deal", { dealId: "d1", stageName: "Nonexistent" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("moves deal to matching stage", async () => {
      (mockDb.crmDeal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "d1", name: "Deal", pipeline: { name: "Sales", stages: [
          { id: "s1", name: "Prospect", probability: 10 },
          { id: "s2", name: "Won", probability: 100 },
        ]},
      });
      (mockDb.crmDeal.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", name: "Deal" });
      const r = await call("move_crm_deal", { dealId: "d1", stageName: "Won" });
      expect(r.success).toBe(true);
      const updateArgs = (mockDb.crmDeal.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateArgs.data.stageId).toBe("s2");
      expect(updateArgs.data.probability).toBe(100);
    });
  });

  // ── CRM — Activities ─────────────────────────────────────────────────────────

  describe("create_crm_activity", () => {
    it("rejects invalid type", async () => {
      const r = await call("create_crm_activity", { type: "SHOUT", subject: "hello" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/type/i);
    });

    it("rejects missing subject", async () => {
      const r = await call("create_crm_activity", { type: "CALL" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/subject/i);
    });

    it("creates activity without contact or deal", async () => {
      (mockDb.crmActivity.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "a1", type: "NOTE", subject: "Follow up", dueDate: null,
      });
      const r = await call("create_crm_activity", { type: "NOTE", subject: "Follow up" });
      expect(r.success).toBe(true);
      const d = r.data as { type: string; subject: string };
      expect(d.type).toBe("NOTE");
      expect(d.subject).toBe("Follow up");
    });

    it("resolves contactName to contactId when found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1", name: "Bob" });
      (mockDb.crmActivity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1", type: "CALL", subject: "Call Bob", dueDate: null });
      await call("create_crm_activity", { type: "CALL", subject: "Call Bob", contactName: "Bob" });
      const createArgs = (mockDb.crmActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.contactId).toBe("c1");
    });

    it("sets contactId to null when contactName not found", async () => {
      (mockDb.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockDb.crmActivity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1", type: "EMAIL", subject: "Email", dueDate: null });
      await call("create_crm_activity", { type: "EMAIL", subject: "Email", contactName: "Ghost" });
      const createArgs = (mockDb.crmActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArgs.data.contactId).toBeNull();
    });
  });

  describe("list_crm_activities", () => {
    it("returns mapped activity list", async () => {
      (mockDb.crmActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "a1", type: "CALL", subject: "Discovery call", contact: { name: "Alice" }, deal: null, dueDate: new Date("2026-07-01"), completedAt: null },
      ]);
      const r = await call("list_crm_activities", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ type: string; completed: boolean }>;
      expect(data[0].type).toBe("CALL");
      expect(data[0].completed).toBe(false);
    });

    it("marks completed activities correctly", async () => {
      (mockDb.crmActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "a2", type: "MEETING", subject: "Done", contact: null, deal: null, dueDate: null, completedAt: new Date() },
      ]);
      const r = await call("list_crm_activities", {});
      const data = r.data as Array<{ completed: boolean }>;
      expect(data[0].completed).toBe(true);
    });
  });

  // ── Recurring Items ───────────────────────────────────────────────────────────

  describe("create_recurring", () => {
    it("rejects missing name", async () => {
      const r = await call("create_recurring", { amount: 500, type: "EXPENSE", frequency: "MONTHLY" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/name/i);
    });

    it("rejects missing or zero amount", async () => {
      const r = await call("create_recurring", { name: "Rent", amount: 0, type: "EXPENSE" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/amount/i);
    });

    it("rejects invalid type", async () => {
      const r = await call("create_recurring", { name: "Rent", amount: 500, type: "MISC" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/type/i);
    });

    it("creates a recurring expense with MONTHLY frequency default", async () => {
      (mockDb.recurringItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "r1", name: "Rent", amount: dec(1500), type: "EXPENSE", frequency: "MONTHLY",
        nextDueDate: new Date("2026-07-01"),
      });
      const r = await call("create_recurring", { name: "Rent", amount: 1500, type: "EXPENSE" });
      expect(r.success).toBe(true);
      const d = r.data as { name: string; type: string; frequency: string };
      expect(d.name).toBe("Rent");
      expect(d.type).toBe("EXPENSE");
    });

    it("creates a recurring income item", async () => {
      (mockDb.recurringItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "r2", name: "Salary", amount: dec(5000), type: "INCOME", frequency: "MONTHLY",
        nextDueDate: new Date("2026-07-01"),
      });
      const r = await call("create_recurring", { name: "Salary", amount: 5000, type: "INCOME" });
      expect(r.success).toBe(true);
      const d = r.data as { type: string };
      expect(d.type).toBe("INCOME");
    });
  });

  describe("list_recurring", () => {
    it("returns all active recurring items", async () => {
      (mockDb.recurringItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "r1", name: "Rent", amount: dec(1500), type: "EXPENSE", frequency: "MONTHLY", category: "Housing", nextDueDate: new Date("2026-07-01"), lastPaidAt: null },
      ]);
      const r = await call("list_recurring", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ name: string; amount: number }>;
      expect(data[0].name).toBe("Rent");
      expect(data[0].amount).toBe(1500);
    });

    it("passes type filter", async () => {
      (mockDb.recurringItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("list_recurring", { type: "INCOME" });
      expect((mockDb.recurringItem.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where.type).toBe("INCOME");
    });
  });

  describe("mark_recurring_paid", () => {
    it("rejects missing recurringId", async () => {
      const r = await call("mark_recurring_paid", {});
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/recurringId/i);
    });

    it("returns error when item not found", async () => {
      (mockDb.recurringItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("mark_recurring_paid", { recurringId: "missing" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("advances nextDueDate by one month for MONTHLY frequency", async () => {
      (mockDb.recurringItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "r1", name: "Rent", frequency: "MONTHLY", nextDueDate: new Date("2026-06-01"),
      });
      (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Rent", lastPaidAt: new Date(), nextDueDate: new Date("2026-07-01"),
      });
      const r = await call("mark_recurring_paid", { recurringId: "r1" });
      expect(r.success).toBe(true);
      const updateArgs = (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const newDate = updateArgs.data.nextDueDate as Date;
      expect(newDate.getMonth()).toBe(6); // July = month index 6
    });

    it("advances nextDueDate by one year for YEARLY frequency", async () => {
      (mockDb.recurringItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "r2", name: "Insurance", frequency: "YEARLY", nextDueDate: new Date("2026-01-15"),
      });
      (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Insurance", lastPaidAt: new Date(), nextDueDate: new Date("2027-01-15"),
      });
      await call("mark_recurring_paid", { recurringId: "r2" });
      const updateArgs = (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const newDate = updateArgs.data.nextDueDate as Date;
      expect(newDate.getFullYear()).toBe(2027);
    });

    it("advances by 7 days for WEEKLY frequency", async () => {
      const base = new Date("2026-06-01");
      (mockDb.recurringItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "r3", name: "Weekly", frequency: "WEEKLY", nextDueDate: base,
      });
      (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Weekly", lastPaidAt: new Date(), nextDueDate: new Date(base.getTime() + 7 * 86400_000),
      });
      await call("mark_recurring_paid", { recurringId: "r3" });
      const updateArgs = (mockDb.recurringItem.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const diffDays = (updateArgs.data.nextDueDate.getTime() - base.getTime()) / 86400_000;
      expect(diffDays).toBe(7);
    });
  });

  // ── Goals ─────────────────────────────────────────────────────────────────────

  describe("create_goal", () => {
    it("rejects missing name", async () => {
      const r = await call("create_goal", { targetAmount: 10000 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/name/i);
    });

    it("rejects missing or zero targetAmount", async () => {
      const r = await call("create_goal", { name: "Emergency Fund", targetAmount: 0 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/targetAmount/i);
    });

    it("creates a goal with targetDate", async () => {
      (mockDb.goal.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "g1", name: "Emergency Fund", targetAmount: dec(10000), targetDate: new Date("2026-12-31"),
      });
      const r = await call("create_goal", { name: "Emergency Fund", targetAmount: 10000, targetDate: "2026-12-31" });
      expect(r.success).toBe(true);
      const d = r.data as { name: string; targetAmount: number; targetDate: string };
      expect(d.name).toBe("Emergency Fund");
      expect(d.targetAmount).toBe(10000);
      expect(d.targetDate).toBe("2026-12-31");
    });

    it("creates a goal without targetDate", async () => {
      (mockDb.goal.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "g2", name: "New Car", targetAmount: dec(25000), targetDate: null,
      });
      const r = await call("create_goal", { name: "New Car", targetAmount: 25000 });
      expect(r.success).toBe(true);
      const d = r.data as { targetDate: string | null };
      expect(d.targetDate).toBeNull();
    });
  });

  describe("list_goals", () => {
    it("returns goals with computed progress percentage", async () => {
      (mockDb.goal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "g1", name: "Emergency Fund", targetAmount: dec(10000), currentAmount: dec(2500), targetDate: null, status: "ACTIVE" },
      ]);
      const r = await call("list_goals", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ progress: number }>;
      expect(data[0].progress).toBe(25);
    });

    it("caps progress at 100% when currentAmount exceeds target", async () => {
      (mockDb.goal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "g2", name: "Overfunded", targetAmount: dec(1000), currentAmount: dec(1500), targetDate: null, status: "COMPLETED" },
      ]);
      const r = await call("list_goals", {});
      const data = r.data as Array<{ progress: number }>;
      expect(data[0].progress).toBe(100);
    });
  });

  describe("update_goal_progress", () => {
    it("rejects missing goalId", async () => {
      const r = await call("update_goal_progress", { currentAmount: 5000 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/goalId/i);
    });

    it("rejects negative currentAmount", async () => {
      const r = await call("update_goal_progress", { goalId: "g1", currentAmount: -100 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/currentAmount/i);
    });

    it("returns error when goal not found", async () => {
      (mockDb.goal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const r = await call("update_goal_progress", { goalId: "missing", currentAmount: 500 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
    });

    it("sets status to COMPLETED when currentAmount reaches targetAmount", async () => {
      (mockDb.goal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g1", name: "Fund", targetAmount: dec(10000) });
      (mockDb.goal.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Fund", currentAmount: dec(10000), targetAmount: dec(10000), status: "COMPLETED",
      });
      const r = await call("update_goal_progress", { goalId: "g1", currentAmount: 10000 });
      expect(r.success).toBe(true);
      const updateArgs = (mockDb.goal.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateArgs.data.status).toBe("COMPLETED");
    });

    it("keeps status ACTIVE when currentAmount is below target", async () => {
      (mockDb.goal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g1", name: "Fund", targetAmount: dec(10000) });
      (mockDb.goal.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Fund", currentAmount: dec(3000), targetAmount: dec(10000), status: "ACTIVE",
      });
      await call("update_goal_progress", { goalId: "g1", currentAmount: 3000 });
      const updateArgs = (mockDb.goal.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateArgs.data.status).toBe("ACTIVE");
    });

    it("returns correct progress percentage", async () => {
      (mockDb.goal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g1", name: "Fund", targetAmount: dec(10000) });
      (mockDb.goal.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: "Fund", currentAmount: dec(4000), targetAmount: dec(10000), status: "ACTIVE",
      });
      const r = await call("update_goal_progress", { goalId: "g1", currentAmount: 4000 });
      const d = r.data as { progress: number };
      expect(d.progress).toBe(40);
    });
  });

  // ── CRM — Companies ───────────────────────────────────────────────────────────

  describe("create_crm_company", () => {
    it("rejects missing name", async () => {
      const r = await call("create_crm_company", {});
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/name/i);
    });

    it("creates company with defaults", async () => {
      (mockDb.crmCompany.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "co1", name: "Acme Corp", industry: null, size: "SMALL",
      });
      const r = await call("create_crm_company", { name: "Acme Corp" });
      expect(r.success).toBe(true);
      const d = r.data as { name: string; size: string };
      expect(d.name).toBe("Acme Corp");
      expect(d.size).toBe("SMALL");
    });

    it("accepts valid size enum", async () => {
      (mockDb.crmCompany.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "co2", name: "BigCo", industry: "Finance", size: "ENTERPRISE",
      });
      const r = await call("create_crm_company", { name: "BigCo", industry: "Finance", size: "ENTERPRISE" });
      expect(r.success).toBe(true);
      expect((mockDb.crmCompany.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.size).toBe("ENTERPRISE");
    });

    it("falls back to SMALL for invalid size", async () => {
      (mockDb.crmCompany.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "co3", name: "WeirdCo", industry: null, size: "SMALL",
      });
      await call("create_crm_company", { name: "WeirdCo", size: "GIGANTIC" });
      expect((mockDb.crmCompany.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.size).toBe("SMALL");
    });
  });

  describe("list_crm_companies", () => {
    it("returns mapped company list with deal count", async () => {
      (mockDb.crmCompany.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "co1", name: "Acme Corp", industry: "Tech", size: "MEDIUM", phone: null, website: "acme.com", _count: { deals: 3 } },
      ]);
      const r = await call("list_crm_companies", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ name: string; dealCount: number }>;
      expect(data[0].name).toBe("Acme Corp");
      expect(data[0].dealCount).toBe(3);
    });

    it("passes search filter", async () => {
      (mockDb.crmCompany.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await call("list_crm_companies", { search: "Acme" });
      const whereArg = (mockDb.crmCompany.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
      expect(whereArg.name.contains).toBe("Acme");
    });
  });

  // ── Watchlists ────────────────────────────────────────────────────────────────

  describe("create_watchlist", () => {
    it("rejects missing name", async () => {
      const r = await call("create_watchlist", { category: "Food", threshold: 500 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/name/i);
    });

    it("rejects missing category", async () => {
      const r = await call("create_watchlist", { name: "Food watch", threshold: 500 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/category/i);
    });

    it("rejects missing or zero threshold", async () => {
      const r = await call("create_watchlist", { name: "Food watch", category: "Food", threshold: 0 });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/threshold/i);
    });

    it("creates watchlist with MONTHLY period default", async () => {
      (mockDb.watchlist.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "w1", name: "Food watch", category: "Food", threshold: dec(500), period: "MONTHLY",
      });
      const r = await call("create_watchlist", { name: "Food watch", category: "Food", threshold: 500 });
      expect(r.success).toBe(true);
      const d = r.data as { name: string; threshold: number; period: string };
      expect(d.name).toBe("Food watch");
      expect(d.threshold).toBe(500);
      expect(d.period).toBe("MONTHLY");
    });

    it("accepts valid period enum", async () => {
      (mockDb.watchlist.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "w2", name: "Quarterly watch", category: "Travel", threshold: dec(2000), period: "QUARTERLY",
      });
      await call("create_watchlist", { name: "Quarterly watch", category: "Travel", threshold: 2000, period: "QUARTERLY" });
      expect((mockDb.watchlist.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.period).toBe("QUARTERLY");
    });

    it("falls back to MONTHLY for invalid period", async () => {
      (mockDb.watchlist.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "w3", name: "Watch", category: "X", threshold: dec(100), period: "MONTHLY",
      });
      await call("create_watchlist", { name: "Watch", category: "X", threshold: 100, period: "DAILY" });
      expect((mockDb.watchlist.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.period).toBe("MONTHLY");
    });
  });

  describe("list_watchlists", () => {
    it("returns all active watchlists", async () => {
      (mockDb.watchlist.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "w1", name: "Food watch", category: "Food", threshold: dec(500), period: "MONTHLY" },
        { id: "w2", name: "Travel watch", category: "Travel", threshold: dec(2000), period: "QUARTERLY" },
      ]);
      const r = await call("list_watchlists", {});
      expect(r.success).toBe(true);
      const data = r.data as Array<{ name: string; threshold: number }>;
      expect(data).toHaveLength(2);
      expect(data[0].threshold).toBe(500);
    });

    it("returns empty list when no watchlists exist", async () => {
      (mockDb.watchlist.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const r = await call("list_watchlists", {});
      expect(r.success).toBe(true);
      expect(r.data).toHaveLength(0);
    });
  });
});
