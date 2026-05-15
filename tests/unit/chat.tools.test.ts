import { describe, it, expect, vi, beforeEach } from "vitest";
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
  },
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
      (mockDb.invoice.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "inv-1",
        number: "INV-0001",
        status: "SENT",
        journalEntryId: "je-orig",
      });
      (mockDb.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-orig",
        description: "Invoice INV-0001",
        isVoid: false,
        lines: [
          { accountId: "acc-ar", debit: dec(1000), credit: null, description: "AR" },
          { accountId: "acc-sales", debit: null, credit: dec(1000), description: "Sales" },
        ],
      });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      (mockDb.journalEntry.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
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
      (mockDb.bill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "bill-1",
        number: "BILL-0001",
        status: "SENT",
        journalEntryId: "je-orig",
      });
      (mockDb.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-orig",
        description: "Bill BILL-0001",
        isVoid: false,
        lines: [
          { accountId: "acc-exp", debit: dec(500), credit: null, description: "Expense" },
          { accountId: "acc-ap", debit: null, credit: dec(500), description: "AP" },
        ],
      });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      (mockDb.journalEntry.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
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
      (mockDb.journalEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "je-1",
        description: "Salary payment",
        isVoid: false,
        lines: [
          { accountId: "acc-salary", debit: dec(3000), credit: null, description: "Salary" },
          { accountId: "acc-cash", debit: null, credit: dec(3000), description: "Cash" },
        ],
      });
      (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "je-rev" });
      (mockDb.journalEntry.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const r = await call("void_transaction", { transactionId: "je-1" });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ id: "je-1", description: "Salary payment" });
      // Reversal entry flips debit/credit
      const createCall = (mockDb.journalEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const reversalLines = createCall.data.lines.create as { debit: unknown; credit: unknown }[];
      expect(reversalLines[0].debit).toBeNull();
      expect(reversalLines[0].credit).not.toBeNull();
      expect(mockDb.journalEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isVoid: true } }),
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
});
