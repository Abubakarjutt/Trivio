import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
    organisation: { findUnique: vi.fn() },
  },
}));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("PDF")),
}));
vi.mock("@/server/services/pdf/invoice-pdf", () => ({ InvoicePDF: vi.fn() }));
vi.mock("@/server/services/invoice.service", () => ({
  effectiveStatus: vi.fn().mockReturnValue("PAID"),
}));
vi.mock("@/lib/utils", () => ({
  formatDate: vi.fn().mockImplementation((d: Date) => d.toISOString().slice(0, 10)),
}));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(db.user.findUnique);
const mockInvoiceFindFirst = vi.mocked(db.invoice.findFirst);
const mockOrgFindUnique = vi.mocked(db.organisation.findUnique);
const mockRenderToBuffer = vi.mocked(renderToBuffer);

const VALID_SESSION = { user: { id: "user-1" } };
const VALID_USER = { organisationId: "org-1" };
const VALID_ORG = { name: "Acme Corp", currency: "USD" };

const makeDecimal = (n: number) => ({
  valueOf: () => n,
  toNumber: () => n,
  toString: () => String(n),
});

const VALID_INVOICE = {
  id: "inv-1",
  number: "INV-001",
  date: new Date("2024-01-15"),
  dueDate: new Date("2024-02-15"),
  organisationId: "org-1",
  notes: null,
  contact: {
    name: "Acme",
    email: "acme@example.com",
    address: null,
    taxNumber: null,
  },
  lines: [
    {
      description: "Service",
      quantity: makeDecimal(1),
      unitPrice: makeDecimal(100),
      amount: makeDecimal(100),
      taxAmount: makeDecimal(0),
      taxRateCode: null,
      sortOrder: 0,
    },
  ],
  subtotal: makeDecimal(100),
  taxAmount: makeDecimal(0),
  totalAmount: makeDecimal(100),
  amountPaid: makeDecimal(100),
};

function makeReq() {
  return new NextRequest("http://localhost/api/invoices/inv-1/pdf");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderToBuffer.mockResolvedValue(Buffer.from("PDF") as any);
  mockOrgFindUnique.mockResolvedValue(VALID_ORG as any);
});

describe("GET /api/invoices/[id]/pdf", () => {
  it("returns 401 if no session", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 if no org", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue({ organisationId: null } as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 if invoice not found", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockInvoiceFindFirst.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 200 with Content-Type: application/pdf", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockInvoiceFindFirst.mockResolvedValue(VALID_INVOICE as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("returns 200 with Content-Disposition attachment filename", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockInvoiceFindFirst.mockResolvedValue(VALID_INVOICE as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="INV-001.pdf"');
  });

  it("calls renderToBuffer to generate the PDF", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockInvoiceFindFirst.mockResolvedValue(VALID_INVOICE as any);
    await GET(makeReq(), { params: Promise.resolve({ id: "inv-1" }) });
    expect(mockRenderToBuffer).toHaveBeenCalledOnce();
  });
});
