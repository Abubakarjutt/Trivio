/**
 * invoices router unit tests
 *
 * Tests the invoicesRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma and service layer — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Service mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@/server/services/invoice.service", () => ({
  createInvoice: vi.fn().mockResolvedValue({
    id: "inv-1",
    number: "INV-001",
    status: "DRAFT",
    totalAmount: "1000",
    amountPaid: "0",
  }),
  postInvoiceToLedger: vi.fn().mockResolvedValue(undefined),
  recordInvoicePayment: vi.fn().mockResolvedValue({ id: "pay-1" }),
  voidInvoice: vi.fn().mockResolvedValue(undefined),
  calcInvoiceTotals: vi.fn().mockReturnValue({ subtotal: 1000, taxAmount: 0, totalAmount: 1000 }),
  effectiveStatus: vi.fn().mockReturnValue("DRAFT"),
}));

vi.mock("@/server/services/email.service", () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/accounting-sample-data", () => ({
  loadAccountingSampleData: vi.fn().mockResolvedValue(0),
  clearAccountingSampleData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createCallerFactory } from "@/server/trpc";
import { invoicesRouter } from "@/server/routers/invoices";
import {
  createInvoice,
  postInvoiceToLedger,
  recordInvoicePayment,
  voidInvoice,
  effectiveStatus,
} from "@/server/services/invoice.service";
import { sendInvoiceEmail } from "@/server/services/email.service";
import { writeAuditLog } from "@/server/services/audit.service";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = "org-1";
const USER_ID = "user-1";

const baseInvoice = {
  id: "inv-1",
  organisationId: ORG,
  number: "INV-001",
  contactId: "contact-1",
  date: new Date("2026-01-01"),
  dueDate: new Date("2026-02-01"),
  status: "DRAFT" as const,
  subtotal: "1000",
  taxAmount: "0",
  totalAmount: "1000",
  amountPaid: "0",
  notes: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const baseContact = {
  id: "contact-1",
  organisationId: ORG,
  name: "Acme Corp",
  email: "acme@example.com",
  phone: null,
  address: null,
  taxNumber: null,
  type: "CUSTOMER" as const,
  isArchived: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const lineItem = {
  id: "line-1",
  description: "Consulting",
  quantity: "10",
  unitPrice: "100",
  amount: "1000",
  taxRateCode: null,
  taxAmount: "0",
  sortOrder: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  const defaultOrg = { organisation: { findUnique: vi.fn().mockResolvedValue({ hasSampleData: false }) } };
  return {
    session: { user: { id: USER_ID, email: "u@test.com" } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db: { ...defaultOrg, ...db },
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(invoicesRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("invoices.list", () => {
  it("returns paginated results with items, total, and pages", async () => {
    const invoices = [{ ...baseInvoice, contact: { id: "contact-1", name: "Acme", email: "a@a.com" } }];
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue(invoices);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.pages).toBe(1);
  });

  it("returns empty list when no invoices exist", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.pages).toBe(0);
  });

  it("filters by DRAFT status", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    await caller.list({ page: 1, status: "DRAFT" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "DRAFT" }) })
    );
  });

  it("filters by OVERDUE using dueDate<now and status in SENT/PARTIAL", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    await caller.list({ page: 1, status: "OVERDUE" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.dueDate).toBeDefined();
    expect(whereArg.status?.in).toEqual(["SENT", "PARTIAL"]);
  });

  it("filters by contactId when provided", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    await caller.list({ page: 1, contactId: "contact-1" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.contactId).toBe("contact-1");
  });

  it("adds OR clause for search by number and contact name", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    await caller.list({ page: 1, search: "acme" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR).toHaveLength(2);
  });

  it("calculates correct pages for multiple pages", async () => {
    const count = vi.fn().mockResolvedValue(101); // PAGE_SIZE=50 → 3 pages
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.pages).toBe(3);
  });

  it("attaches effectiveStatus and amountDue to each item", async () => {
    const inv = { ...baseInvoice, contact: { id: "contact-1", name: "Acme", email: null } };
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([inv]);
    (effectiveStatus as ReturnType<typeof vi.fn>).mockReturnValue("SENT");
    const caller = createCaller(makeCtx({ invoice: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items[0].effectiveStatus).toBe("SENT");
    expect(result.items[0].amountDue).toBe(1000);
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("invoices.getById", () => {
  it("returns invoice with lines and contact when found", async () => {
    const invoice = { ...baseInvoice, contact: baseContact, lines: [lineItem] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    const result = await caller.getById({ id: "inv-1" });
    expect(result.id).toBe("inv-1");
    expect(result.lines).toHaveLength(1);
  });

  it("throws NOT_FOUND when invoice does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.getById({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("includes amountDue in getById result", async () => {
    const invoice = { ...baseInvoice, totalAmount: "500", amountPaid: "200", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    const result = await caller.getById({ id: "inv-1" });
    expect(result.amountDue).toBe(300);
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("invoices.create", () => {
  const validInput = {
    contactId: "contact-1",
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-02-01"),
    lines: [{ description: "Consulting", quantity: 10, unitPrice: 100, taxAmount: 0 }],
  };

  it("calls createInvoice service with organisationId", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    await caller.create(validInput);
    expect(createInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organisationId: ORG, contactId: "contact-1" })
    );
  });

  it("returns the created invoice", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    const result = await caller.create(validInput);
    expect(result.id).toBe("inv-1");
    expect(result.number).toBe("INV-001");
  });

  it("calls writeAuditLog with CREATE action", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    await caller.create(validInput);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "CREATE",
        entityType: "Invoice",
        entityId: "inv-1",
      })
    );
  });

  it("rejects when lines array is empty", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    await expect(
      caller.create({ ...validInput, lines: [] })
    ).rejects.toThrow();
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe("invoices.update", () => {
  it("throws NOT_FOUND when invoice does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(
      caller.update({ id: "missing" })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("throws BAD_REQUEST when invoice is not DRAFT", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseInvoice, status: "SENT" });
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(
      caller.update({ id: "inv-1", notes: "updated" })
    ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("updates notes on a DRAFT invoice", async () => {
    const existing = { ...baseInvoice, status: "DRAFT" };
    const updated = { ...existing, notes: "updated notes", lines: [], contact: baseContact };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ invoice: { findFirst, update } }));
    const result = await caller.update({ id: "inv-1", notes: "updated notes" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv-1" } }));
    expect(result.notes).toBe("updated notes");
  });

  it("calls calcInvoiceTotals and updates totals when lines provided", async () => {
    const existing = { ...baseInvoice, status: "DRAFT" };
    const updated = { ...existing, lines: [], contact: baseContact };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ invoice: { findFirst, update } }));
    await caller.update({
      id: "inv-1",
      lines: [{ description: "New item", quantity: 5, unitPrice: 200, taxAmount: 0 }],
    });
    const { calcInvoiceTotals } = await import("@/server/services/invoice.service");
    expect(calcInvoiceTotals).toHaveBeenCalled();
  });
});

// ─── send ─────────────────────────────────────────────────────────────────────

describe("invoices.send", () => {
  it("throws NOT_FOUND when invoice does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.send({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when invoice is not DRAFT", async () => {
    const invoice = { ...baseInvoice, status: "SENT", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.send({ id: "inv-1" })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("calls postInvoiceToLedger for a DRAFT invoice", async () => {
    const invoice = { ...baseInvoice, status: "DRAFT", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const update = vi.fn().mockResolvedValue({ ...invoice, status: "SENT" });
    const findUnique = vi.fn().mockResolvedValue({ name: "Test Org", currency: "USD" });
    const caller = createCaller(makeCtx({ invoice: { findFirst, update }, organisation: { findUnique } }));
    await caller.send({ id: "inv-1", sendEmail: false });
    expect(postInvoiceToLedger).toHaveBeenCalledWith(expect.anything(), "inv-1", ORG, USER_ID);
  });

  it("updates invoice status to SENT after posting", async () => {
    const invoice = { ...baseInvoice, status: "DRAFT", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const update = vi.fn().mockResolvedValue({ ...invoice, status: "SENT" });
    const findUnique = vi.fn().mockResolvedValue({ name: "Test Org", currency: "USD" });
    const caller = createCaller(makeCtx({ invoice: { findFirst, update }, organisation: { findUnique } }));
    await caller.send({ id: "inv-1", sendEmail: false });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SENT" } })
    );
  });

  it("calls sendInvoiceEmail when sendEmail=true and contact has email", async () => {
    const invoice = { ...baseInvoice, status: "DRAFT", contact: { ...baseContact, email: "acme@example.com" }, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const update = vi.fn().mockResolvedValue({ ...invoice, status: "SENT" });
    const findUnique = vi.fn().mockResolvedValue({ name: "Test Org", currency: "USD" });
    const caller = createCaller(makeCtx({ invoice: { findFirst, update }, organisation: { findUnique } }));
    await caller.send({ id: "inv-1", sendEmail: true });
    expect(sendInvoiceEmail).toHaveBeenCalled();
  });

  it("does not call sendInvoiceEmail when contact has no email", async () => {
    const invoice = { ...baseInvoice, status: "DRAFT", contact: { ...baseContact, email: null }, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const update = vi.fn().mockResolvedValue({ ...invoice, status: "SENT" });
    const findUnique = vi.fn().mockResolvedValue({ name: "Test Org", currency: "USD" });
    const caller = createCaller(makeCtx({ invoice: { findFirst, update }, organisation: { findUnique } }));
    await caller.send({ id: "inv-1", sendEmail: true });
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("returns { success: true } on success", async () => {
    const invoice = { ...baseInvoice, status: "DRAFT", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(invoice);
    const update = vi.fn().mockResolvedValue({ ...invoice, status: "SENT" });
    const findUnique = vi.fn().mockResolvedValue({ name: "Test Org", currency: "USD" });
    const caller = createCaller(makeCtx({ invoice: { findFirst, update }, organisation: { findUnique } }));
    const result = await caller.send({ id: "inv-1", sendEmail: false });
    expect(result).toEqual({ success: true });
  });
});

// ─── recordPayment ────────────────────────────────────────────────────────────

describe("invoices.recordPayment", () => {
  const paymentInput = {
    id: "inv-1",
    amount: 500,
    cashAccountId: "acc-cash",
    date: new Date("2026-03-01"),
  };

  it("throws NOT_FOUND when invoice does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.recordPayment(paymentInput)).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when invoice is DRAFT (not yet posted)", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseInvoice, status: "DRAFT" });
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.recordPayment(paymentInput)).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("throws BAD_REQUEST when payment exceeds outstanding balance", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseInvoice,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "800",
    });
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(
      caller.recordPayment({ ...paymentInput, amount: 300 }) // outstanding = 200
    ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("calls recordInvoicePayment service with correct params", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseInvoice,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "0",
    });
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await caller.recordPayment(paymentInput);
    expect(recordInvoicePayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        invoiceId: "inv-1",
        organisationId: ORG,
        userId: USER_ID,
        amount: 500,
        cashAccountId: "acc-cash",
      })
    );
  });

  it("allows exact payment of outstanding balance", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseInvoice,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "0",
    });
    const caller = createCaller(makeCtx({ invoice: { findFirst } }));
    await expect(caller.recordPayment({ ...paymentInput, amount: 1000 })).resolves.toBeDefined();
  });
});

// ─── void ─────────────────────────────────────────────────────────────────────

describe("invoices.void", () => {
  it("calls voidInvoice service with correct params", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    await caller.void({ id: "inv-1", reason: "Customer cancelled" });
    expect(voidInvoice).toHaveBeenCalledWith(
      expect.anything(),
      "inv-1",
      ORG,
      USER_ID,
      "Customer cancelled"
    );
  });

  it("returns { success: true } on success", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    const result = await caller.void({ id: "inv-1", reason: "Test reason" });
    expect(result).toEqual({ success: true });
  });

  it("uses default reason when none provided", async () => {
    const caller = createCaller(makeCtx({ invoice: {} }));
    await caller.void({ id: "inv-1" });
    expect(voidInvoice).toHaveBeenCalledWith(
      expect.anything(),
      "inv-1",
      ORG,
      USER_ID,
      "Voided by user"
    );
  });
});
