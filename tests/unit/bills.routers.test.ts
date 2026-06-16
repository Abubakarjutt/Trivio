/**
 * bills router unit tests
 *
 * Tests the billsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma and service layer — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Service mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@/server/services/bill.service", () => ({
  createBill: vi.fn().mockResolvedValue({
    id: "bill-1",
    number: "BILL-001",
    status: "DRAFT",
    totalAmount: "1000",
    amountPaid: "0",
  }),
  postBillToLedger: vi.fn().mockResolvedValue(undefined),
  recordBillPayment: vi.fn().mockResolvedValue({ id: "pay-1" }),
  voidBill: vi.fn().mockResolvedValue(undefined),
  calcBillTotals: vi.fn().mockReturnValue({ subtotal: 1000, taxAmount: 0, totalAmount: 1000 }),
  effectiveBillStatus: vi.fn().mockReturnValue("DRAFT"),
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
import { billsRouter } from "@/server/routers/bills";
import {
  createBill,
  postBillToLedger,
  recordBillPayment,
  voidBill,
  effectiveBillStatus,
} from "@/server/services/bill.service";
import { writeAuditLog } from "@/server/services/audit.service";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = "org-1";
const USER_ID = "user-1";

const baseBill = {
  id: "bill-1",
  organisationId: ORG,
  number: "BILL-001",
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
  name: "Supplier Ltd",
  email: "supplier@example.com",
  phone: null,
  address: null,
  taxNumber: null,
  type: "SUPPLIER" as const,
  isArchived: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const lineItem = {
  id: "line-1",
  description: "Office Supplies",
  quantity: "5",
  unitPrice: "200",
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

const createCaller = createCallerFactory(billsRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("bills.list", () => {
  it("returns paginated results with items, total, and pages", async () => {
    const bills = [{ ...baseBill, contact: { id: "contact-1", name: "Supplier", email: null } }];
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue(bills);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.pages).toBe(1);
  });

  it("returns empty list when no bills exist", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.pages).toBe(0);
  });

  it("filters by DRAFT status", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    await caller.list({ page: 1, status: "DRAFT" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "DRAFT" }) })
    );
  });

  it("filters by OVERDUE using dueDate<now and status in SENT/PARTIAL", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    await caller.list({ page: 1, status: "OVERDUE" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.dueDate).toBeDefined();
    expect(whereArg.status?.in).toEqual(["SENT", "PARTIAL"]);
  });

  it("does not apply status filter when status=ALL", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    await caller.list({ page: 1, status: "ALL" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.status).toBeUndefined();
  });

  it("filters by contactId when provided", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    await caller.list({ page: 1, contactId: "contact-1" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.contactId).toBe("contact-1");
  });

  it("adds OR clause for search by number and contact name", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    await caller.list({ page: 1, search: "supplier" });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR).toHaveLength(2);
  });

  it("attaches effectiveStatus and amountDue to each item", async () => {
    const bill = { ...baseBill, totalAmount: "500", amountPaid: "100", contact: { id: "c-1", name: "S", email: null } };
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([bill]);
    (effectiveBillStatus as ReturnType<typeof vi.fn>).mockReturnValue("PARTIAL");
    const caller = createCaller(makeCtx({ bill: { count, findMany } }));
    const result = await caller.list({ page: 1 });
    expect(result.items[0].effectiveStatus).toBe("PARTIAL");
    expect(result.items[0].amountDue).toBe(400);
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("bills.getById", () => {
  it("returns bill with lines and contact when found", async () => {
    const bill = { ...baseBill, contact: baseContact, lines: [lineItem] };
    const findFirst = vi.fn().mockResolvedValue(bill);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    const result = await caller.getById({ id: "bill-1" });
    expect(result.id).toBe("bill-1");
    expect(result.lines).toHaveLength(1);
  });

  it("throws NOT_FOUND when bill does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.getById({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("includes amountDue in result", async () => {
    const bill = { ...baseBill, totalAmount: "800", amountPaid: "300", contact: baseContact, lines: [] };
    const findFirst = vi.fn().mockResolvedValue(bill);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    const result = await caller.getById({ id: "bill-1" });
    expect(result.amountDue).toBe(500);
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("bills.create", () => {
  const validInput = {
    contactId: "contact-1",
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-02-01"),
    lines: [{ description: "Office Supplies", quantity: 5, unitPrice: 200, taxAmount: 0 }],
  };

  it("calls createBill service with organisationId", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    await caller.create(validInput);
    expect(createBill).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organisationId: ORG, contactId: "contact-1" })
    );
  });

  it("returns the created bill", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    const result = await caller.create(validInput);
    expect(result.id).toBe("bill-1");
    expect(result.number).toBe("BILL-001");
  });

  it("calls writeAuditLog with CREATE action", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    await caller.create(validInput);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "CREATE",
        entityType: "Bill",
        entityId: "bill-1",
      })
    );
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe("bills.update", () => {
  it("throws NOT_FOUND when bill does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.update({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when bill is not DRAFT", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseBill, status: "SENT" });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.update({ id: "bill-1", notes: "updated" })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("updates notes on a DRAFT bill", async () => {
    const existing = { ...baseBill, status: "DRAFT" };
    const updated = { ...existing, notes: "new notes", lines: [], contact: baseContact };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ bill: { findFirst, update } }));
    const result = await caller.update({ id: "bill-1", notes: "new notes" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "bill-1" } }));
    expect(result.notes).toBe("new notes");
  });

  it("calls calcBillTotals and updates totals when lines provided", async () => {
    const existing = { ...baseBill, status: "DRAFT" };
    const updated = { ...existing, lines: [], contact: baseContact };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ bill: { findFirst, update } }));
    await caller.update({
      id: "bill-1",
      lines: [{ description: "New item", quantity: 2, unitPrice: 500, taxAmount: 0 }],
    });
    const { calcBillTotals } = await import("@/server/services/bill.service");
    expect(calcBillTotals).toHaveBeenCalled();
  });
});

// ─── approve ──────────────────────────────────────────────────────────────────

describe("bills.approve", () => {
  it("throws NOT_FOUND when bill does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.approve({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when bill is not DRAFT", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseBill, status: "SENT" });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.approve({ id: "bill-1" })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("calls postBillToLedger for a DRAFT bill", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseBill, status: "DRAFT" });
    const update = vi.fn().mockResolvedValue({ ...baseBill, status: "SENT" });
    const caller = createCaller(makeCtx({ bill: { findFirst, update } }));
    await caller.approve({ id: "bill-1" });
    expect(postBillToLedger).toHaveBeenCalledWith(expect.anything(), "bill-1", ORG, USER_ID);
  });

  it("returns { success: true } on success", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseBill, status: "DRAFT" });
    const update = vi.fn().mockResolvedValue({ ...baseBill, status: "SENT" });
    const caller = createCaller(makeCtx({ bill: { findFirst, update } }));
    const result = await caller.approve({ id: "bill-1" });
    expect(result).toEqual({ success: true });
  });
});

// ─── recordPayment ────────────────────────────────────────────────────────────

describe("bills.recordPayment", () => {
  const paymentInput = {
    id: "bill-1",
    amount: 500,
    cashAccountId: "acc-cash",
    date: new Date("2026-03-01"),
  };

  it("throws NOT_FOUND when bill does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.recordPayment(paymentInput)).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });

  it("throws BAD_REQUEST when bill is DRAFT (not yet approved)", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...baseBill, status: "DRAFT" });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.recordPayment(paymentInput)).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("throws BAD_REQUEST when payment exceeds outstanding balance", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseBill,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "900",
    });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(
      caller.recordPayment({ ...paymentInput, amount: 200 }) // outstanding = 100
    ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("calls recordBillPayment service with correct params", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseBill,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "0",
    });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await caller.recordPayment(paymentInput);
    expect(recordBillPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billId: "bill-1",
        organisationId: ORG,
        userId: USER_ID,
        amount: 500,
        cashAccountId: "acc-cash",
      })
    );
  });

  it("allows exact payment equal to outstanding balance", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...baseBill,
      status: "SENT",
      totalAmount: "1000",
      amountPaid: "0",
    });
    const caller = createCaller(makeCtx({ bill: { findFirst } }));
    await expect(caller.recordPayment({ ...paymentInput, amount: 1000 })).resolves.toBeDefined();
  });
});

// ─── void ─────────────────────────────────────────────────────────────────────

describe("bills.void", () => {
  it("calls voidBill service with correct params", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    await caller.void({ id: "bill-1", reason: "Duplicate bill" });
    expect(voidBill).toHaveBeenCalledWith(
      expect.anything(),
      "bill-1",
      ORG,
      USER_ID,
      "Duplicate bill"
    );
  });

  it("returns { success: true } on success", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    const result = await caller.void({ id: "bill-1", reason: "Test reason" });
    expect(result).toEqual({ success: true });
  });

  it("uses default reason when none provided", async () => {
    const caller = createCaller(makeCtx({ bill: {} }));
    await caller.void({ id: "bill-1" });
    expect(voidBill).toHaveBeenCalledWith(
      expect.anything(),
      "bill-1",
      ORG,
      USER_ID,
      "Voided by user"
    );
  });
});
