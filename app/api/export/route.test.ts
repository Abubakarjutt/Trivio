// app/api/export/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn() },
    bill: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    journalEntry: { findMany: vi.fn() },
  },
}));

vi.mock("jszip", () => {
  const mockFiles: Record<string, string> = {};
  const JSZip = vi.fn().mockImplementation(() => ({
    file: vi.fn((name: string, content: string) => {
      mockFiles[name] = content;
      return { file: vi.fn() }; // Return chainable object
    }),
    generateAsync: vi.fn().mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), // ZIP magic bytes
  }));
  return { default: JSZip };
});

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from "@/app/api/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = "user-1";
const ORG_ID = "org-1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(): NextRequest {
  return new NextRequest("http://localhost/api/export", {
    method: "GET",
  });
}

// ── Default mock setup ────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as any);
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: USER_ID,
    organisationId: ORG_ID,
  } as any);
  vi.mocked(db.invoice.findMany).mockResolvedValue([]);
  vi.mocked(db.bill.findMany).mockResolvedValue([]);
  vi.mocked(db.contact.findMany).mockResolvedValue([]);
  vi.mocked(db.journalEntry.findMany).mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when there is no auth session", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when session has no user id", async () => {
    vi.mocked(auth).mockResolvedValue({ user: {} } as any);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  // ── Organisation ──────────────────────────────────────────────────────────

  it("returns 403 when user has no organisationId", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: USER_ID,
      organisationId: null,
    } as any);
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("No organisation");
  });

  it("returns 403 when user is not found", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as any);
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  // ── Response headers ──────────────────────────────────────────────────────

  it("returns Content-Type: application/zip", async () => {
    const res = await GET(makeReq());
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  it("returns Content-Disposition with attachment and trivio-export prefix", async () => {
    const res = await GET(makeReq());
    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toBeTruthy();
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("trivio-export-");
    expect(disposition).toContain(".zip");
  });

  it("includes today's date (YYYY-MM-DD) in the Content-Disposition filename", async () => {
    const res = await GET(makeReq());
    const disposition = res.headers.get("Content-Disposition");
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    expect(disposition).toMatch(dateRegex);
  });

  // ── Database queries scoped to org ────────────────────────────────────────

  it("fetches invoices scoped to the organisation", async () => {
    await GET(makeReq());
    expect(vi.mocked(db.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG_ID },
      })
    );
  });

  it("fetches bills scoped to the organisation", async () => {
    await GET(makeReq());
    expect(vi.mocked(db.bill.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG_ID },
      })
    );
  });

  it("fetches contacts scoped to the organisation", async () => {
    await GET(makeReq());
    expect(vi.mocked(db.contact.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG_ID },
      })
    );
  });

  it("fetches journal entries scoped to the organisation", async () => {
    await GET(makeReq());
    expect(vi.mocked(db.journalEntry.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG_ID },
      })
    );
  });

  // ── Parallel fetching ─────────────────────────────────────────────────────

  it("calls all four db queries (Promise.all)", async () => {
    await GET(makeReq());
    expect(vi.mocked(db.invoice.findMany)).toHaveBeenCalled();
    expect(vi.mocked(db.bill.findMany)).toHaveBeenCalled();
    expect(vi.mocked(db.contact.findMany)).toHaveBeenCalled();
    expect(vi.mocked(db.journalEntry.findMany)).toHaveBeenCalled();
  });

  // ── Empty data ────────────────────────────────────────────────────────────

  it("returns 200 with ZIP even when all data arrays are empty", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  // ── CSV generation with invoices ──────────────────────────────────────────

  it("generates invoice CSV with correct headers", async () => {
    const mockInvoice = {
      id: "inv-1",
      number: "INV-001",
      date: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      contact: { name: "Acme Corp" },
      status: "PAID",
      subtotal: { toFixed: (digits: number) => "100.00" },
      taxAmount: { toFixed: (digits: number) => "10.00" },
      totalAmount: { toFixed: (digits: number) => "110.00" },
      amountPaid: { toFixed: (digits: number) => "110.00" },
      notes: "Test invoice",
    };
    vi.mocked(db.invoice.findMany).mockResolvedValue([mockInvoice] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    expect(vi.mocked(mockZipInstance.file)).toHaveBeenCalledWith(
      "invoices.csv",
      expect.stringContaining("id,number,date,due_date,contact,status,subtotal,tax_amount,total_amount,amount_paid,notes")
    );
  });

  it("formats invoice data correctly in CSV", async () => {
    const mockInvoice = {
      id: "inv-1",
      number: "INV-001",
      date: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      contact: { name: "Acme Corp" },
      status: "PAID",
      subtotal: { toFixed: (digits: number) => "100.00" },
      taxAmount: { toFixed: (digits: number) => "10.00" },
      totalAmount: { toFixed: (digits: number) => "110.00" },
      amountPaid: { toFixed: (digits: number) => "110.00" },
      notes: "Test invoice",
    };
    vi.mocked(db.invoice.findMany).mockResolvedValue([mockInvoice] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "invoices.csv"
    )?.[1];
    expect(csvContent).toContain("2024-01-15"); // date formatted
    expect(csvContent).toContain("2024-02-15"); // dueDate formatted
    expect(csvContent).toContain("Acme Corp");
    expect(csvContent).toContain("100.00");
    expect(csvContent).toContain("110.00");
  });

  // ── CSV generation with bills ────────────────────────────────────────────

  it("generates bill CSV with correct headers", async () => {
    const mockBill = {
      id: "bill-1",
      number: "BILL-001",
      date: new Date("2024-01-20"),
      dueDate: new Date("2024-02-20"),
      contact: { name: "Vendor Inc" },
      status: "UNPAID",
      subtotal: { toFixed: (digits: number) => "500.00" },
      taxAmount: { toFixed: (digits: number) => "50.00" },
      totalAmount: { toFixed: (digits: number) => "550.00" },
      amountPaid: { toFixed: (digits: number) => "0.00" },
    };
    vi.mocked(db.bill.findMany).mockResolvedValue([mockBill] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    expect(vi.mocked(mockZipInstance.file)).toHaveBeenCalledWith(
      "bills.csv",
      expect.stringContaining("id,number,date,due_date,contact,status,subtotal,tax_amount,total_amount,amount_paid")
    );
  });

  // ── CSV generation with contacts ─────────────────────────────────────────

  it("generates contact CSV with correct headers", async () => {
    const mockContact = {
      id: "contact-1",
      name: "Alice Smith",
      type: "CUSTOMER",
      email: "alice@example.com",
      phone: "+1234567890",
      address: "123 Main St",
      taxNumber: "TAX-12345",
    };
    vi.mocked(db.contact.findMany).mockResolvedValue([mockContact] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    expect(vi.mocked(mockZipInstance.file)).toHaveBeenCalledWith(
      "contacts.csv",
      expect.stringContaining("id,name,type,email,phone,address,tax_number")
    );
  });

  // ── CSV generation with journal entries ──────────────────────────────────

  it("generates journal entries CSV with correct headers", async () => {
    const mockJournalEntry = {
      id: "je-1",
      date: new Date("2024-01-10"),
      description: "Monthly rent",
      source: "MANUAL",
      isVoid: false,
      lines: [
        {
          id: "line-1",
          debit: { toFixed: (digits: number) => "1000.00" },
          credit: null,
          description: "Rent expense",
          account: { code: "6100", name: "Rent Expense" },
        },
        {
          id: "line-2",
          debit: null,
          credit: { toFixed: (digits: number) => "1000.00" },
          description: "Cash paid",
          account: { code: "1000", name: "Cash" },
        },
      ],
    };
    vi.mocked(db.journalEntry.findMany).mockResolvedValue([mockJournalEntry] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    expect(vi.mocked(mockZipInstance.file)).toHaveBeenCalledWith(
      "journal_entries.csv",
      expect.stringContaining(
        "entry_id,date,description,source,is_void,line_id,account_code,account_name,debit,credit,line_description"
      )
    );
  });

  it("flattens journal entry lines in CSV", async () => {
    const mockJournalEntry = {
      id: "je-1",
      date: new Date("2024-01-10"),
      description: "Monthly rent",
      source: "MANUAL",
      isVoid: false,
      lines: [
        {
          id: "line-1",
          debit: { toFixed: (digits: number) => "1000.00" },
          credit: null,
          description: "Rent expense",
          account: { code: "6100", name: "Rent Expense" },
        },
        {
          id: "line-2",
          debit: null,
          credit: { toFixed: (digits: number) => "1000.00" },
          description: "Cash paid",
          account: { code: "1000", name: "Cash" },
        },
      ],
    };
    vi.mocked(db.journalEntry.findMany).mockResolvedValue([mockJournalEntry] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "journal_entries.csv"
    )?.[1];
    // Should have two data rows (one per line)
    const lines = csvContent?.split("\n");
    expect(lines?.length).toBeGreaterThan(2); // header + 2 data rows
    expect(csvContent).toContain("je-1"); // entry_id appears twice
    expect(csvContent).toContain("1000.00");
  });

  // ── ZIP file generation ───────────────────────────────────────────────────

  it("calls JSZip constructor", async () => {
    const { default: JSZip } = await import("jszip");
    await GET(makeReq());
    expect(vi.mocked(JSZip)).toHaveBeenCalled();
  });

  it("adds all four CSV files to the ZIP", async () => {
    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const fileNames = vi.mocked(mockZipInstance.file).mock.calls.map((call) => call[0]);
    expect(fileNames).toContain("invoices.csv");
    expect(fileNames).toContain("bills.csv");
    expect(fileNames).toContain("contacts.csv");
    expect(fileNames).toContain("journal_entries.csv");
  });

  it("calls generateAsync with DEFLATE compression", async () => {
    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    expect(vi.mocked(mockZipInstance.generateAsync)).toHaveBeenCalledWith({
      type: "uint8array",
      compression: "DEFLATE",
    });
  });

  // ── Response body ─────────────────────────────────────────────────────────

  it("returns a buffer response with the ZIP data", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  // ── CSV escaping and special characters ────────────────────────────────────

  it("escapes commas in CSV fields", async () => {
    const mockContact = {
      id: "contact-1",
      name: "Smith, John",
      type: "CUSTOMER",
      email: "john@example.com",
      phone: "+1234567890",
      address: "123 Main St, Suite 100",
      taxNumber: "TAX-12345",
    };
    vi.mocked(db.contact.findMany).mockResolvedValue([mockContact] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "contacts.csv"
    )?.[1];
    // Fields with commas should be quoted
    expect(csvContent).toContain('"Smith, John"');
    expect(csvContent).toContain('"123 Main St, Suite 100"');
  });

  it("escapes double quotes in CSV fields", async () => {
    const mockInvoice = {
      id: "inv-1",
      number: "INV-001",
      date: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      contact: { name: 'Acme "Corp"' },
      status: "PAID",
      subtotal: { toFixed: (digits: number) => "100.00" },
      taxAmount: { toFixed: (digits: number) => "10.00" },
      totalAmount: { toFixed: (digits: number) => "110.00" },
      amountPaid: { toFixed: (digits: number) => "110.00" },
      notes: "Invoice with 'quote' marks",
    };
    vi.mocked(db.invoice.findMany).mockResolvedValue([mockInvoice] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "invoices.csv"
    )?.[1];
    // Double quotes should be escaped
    expect(csvContent).toContain('Acme ""Corp""');
  });

  // ── Null and undefined handling ───────────────────────────────────────────

  it("handles null invoice notes as empty string", async () => {
    const mockInvoice = {
      id: "inv-1",
      number: "INV-001",
      date: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      contact: { name: "Acme Corp" },
      status: "PAID",
      subtotal: { toFixed: (digits: number) => "100.00" },
      taxAmount: { toFixed: (digits: number) => "10.00" },
      totalAmount: { toFixed: (digits: number) => "110.00" },
      amountPaid: { toFixed: (digits: number) => "110.00" },
      notes: null,
    };
    vi.mocked(db.invoice.findMany).mockResolvedValue([mockInvoice] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "invoices.csv"
    )?.[1];
    // Should not have null or undefined, should be empty
    expect(csvContent).not.toContain("null");
    expect(csvContent).not.toContain("undefined");
  });

  it("handles null contact optional fields as empty strings", async () => {
    const mockContact = {
      id: "contact-1",
      name: "Alice Smith",
      type: "CUSTOMER",
      email: null,
      phone: null,
      address: null,
      taxNumber: null,
    };
    vi.mocked(db.contact.findMany).mockResolvedValue([mockContact] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "contacts.csv"
    )?.[1];
    expect(csvContent).not.toContain("null");
    expect(csvContent).not.toContain("undefined");
  });

  it("handles null journal entry debits and credits as empty strings", async () => {
    const mockJournalEntry = {
      id: "je-1",
      date: new Date("2024-01-10"),
      description: "Monthly rent",
      source: "MANUAL",
      isVoid: false,
      lines: [
        {
          id: "line-1",
          debit: { toFixed: (digits: number) => "1000.00" },
          credit: null,
          description: null,
          account: { code: "6100", name: "Rent Expense" },
        },
      ],
    };
    vi.mocked(db.journalEntry.findMany).mockResolvedValue([mockJournalEntry] as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "journal_entries.csv"
    )?.[1];
    expect(csvContent).not.toContain("null");
    expect(csvContent).not.toContain("undefined");
  });

  // ── Multiple records ──────────────────────────────────────────────────────

  it("exports multiple invoices", async () => {
    const mockInvoices = [
      {
        id: "inv-1",
        number: "INV-001",
        date: new Date("2024-01-15"),
        dueDate: new Date("2024-02-15"),
        contact: { name: "Acme Corp" },
        status: "PAID",
        subtotal: { toFixed: (digits: number) => "100.00" },
        taxAmount: { toFixed: (digits: number) => "10.00" },
        totalAmount: { toFixed: (digits: number) => "110.00" },
        amountPaid: { toFixed: (digits: number) => "110.00" },
        notes: "Invoice 1",
      },
      {
        id: "inv-2",
        number: "INV-002",
        date: new Date("2024-01-20"),
        dueDate: new Date("2024-02-20"),
        contact: { name: "Beta Ltd" },
        status: "UNPAID",
        subtotal: { toFixed: (digits: number) => "200.00" },
        taxAmount: { toFixed: (digits: number) => "20.00" },
        totalAmount: { toFixed: (digits: number) => "220.00" },
        amountPaid: { toFixed: (digits: number) => "0.00" },
        notes: "Invoice 2",
      },
    ];
    vi.mocked(db.invoice.findMany).mockResolvedValue(mockInvoices as any);

    const { default: JSZip } = await import("jszip");
    await GET(makeReq());

    const mockZipInstance = vi.mocked(JSZip).mock.results[0]?.value;
    const csvContent = vi.mocked(mockZipInstance.file).mock.calls.find(
      (call) => call[0] === "invoices.csv"
    )?.[1];
    // Should have header + 2 data rows
    const lines = csvContent?.split("\n");
    expect(lines?.length).toBeGreaterThanOrEqual(3);
    expect(csvContent).toContain("INV-001");
    expect(csvContent).toContain("INV-002");
  });
});
