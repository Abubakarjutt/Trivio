/**
 * attachmentsRouter unit tests
 *
 * Tests all 6 procedures of the attachmentsRouter via createCallerFactory
 * with fully mocked Prisma and storage layer — no DB or S3 connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Storage mock (hoisted) ────────────────────────────────────────────────────

vi.mock("@/lib/storage", () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

// ── DB mock (hoisted) — orgProcedure calls db.user.findUnique ────────────────

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
import { attachmentsRouter } from "@/server/routers/attachments";
import { deleteFile } from "@/lib/storage";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = "org-1";
const USER_ID = "user-1";

const baseAttachment = {
  id: "att-1",
  originalFilename: "receipt.pdf",
  mimeType: "application/pdf",
  sizeBytes: 12345,
  extractionStatus: "PENDING" as const,
  extractionResult: null,
  invoiceId: null,
  billId: null,
  uploadedAt: new Date("2026-01-01"),
  s3Key: "uploads/org-1/receipt.pdf",
};

const baseAttachmentList = [
  {
    id: "att-1",
    originalFilename: "receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12345,
    extractionStatus: "PENDING" as const,
    extractionResult: null,
    uploadedAt: new Date("2026-01-01"),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const createCaller = createCallerFactory(attachmentsRouter);

function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db: overrides,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("attachmentsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getStatus ──────────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns attachment when found", async () => {
      const mockFindFirst = vi.fn().mockResolvedValue(baseAttachment);
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: mockFindFirst,
          },
        })
      );

      const result = await caller.getStatus({ id: "att-1" });
      expect(result).toMatchObject({ id: "att-1", originalFilename: "receipt.pdf" });
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND when attachment does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        })
      );

      await expect(caller.getStatus({ id: "missing" })).rejects.toThrow(
        new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" })
      );
    });
  });

  // ── listForInvoice ─────────────────────────────────────────────────────────

  describe("listForInvoice", () => {
    it("returns attachments for a valid invoice", async () => {
      const mockInvoiceFindFirst = vi.fn().mockResolvedValue({ id: "inv-1" });
      const mockAttachmentFindMany = vi.fn().mockResolvedValue(baseAttachmentList);
      const caller = createCaller(
        makeCtx({
          invoice: {
            findFirst: mockInvoiceFindFirst,
          },
          attachment: {
            findMany: mockAttachmentFindMany,
          },
        })
      );

      const result = await caller.listForInvoice({ invoiceId: "inv-1" });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "att-1" });
      expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
      expect(mockAttachmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND when invoice does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          invoice: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          attachment: {
            findMany: vi.fn(),
          },
        })
      );

      await expect(caller.listForInvoice({ invoiceId: "missing" })).rejects.toThrow(
        new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" })
      );
    });
  });

  // ── listForBill ────────────────────────────────────────────────────────────

  describe("listForBill", () => {
    it("returns attachments for a valid bill", async () => {
      const mockBillFindFirst = vi.fn().mockResolvedValue({ id: "bill-1" });
      const mockAttachmentFindMany = vi.fn().mockResolvedValue(baseAttachmentList);
      const caller = createCaller(
        makeCtx({
          bill: {
            findFirst: mockBillFindFirst,
          },
          attachment: {
            findMany: mockAttachmentFindMany,
          },
        })
      );

      const result = await caller.listForBill({ billId: "bill-1" });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "att-1" });
      expect(mockBillFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
      expect(mockAttachmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND when bill does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          bill: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          attachment: {
            findMany: vi.fn(),
          },
        })
      );

      await expect(caller.listForBill({ billId: "missing" })).rejects.toThrow(
        new TRPCError({ code: "NOT_FOUND", message: "Bill not found" })
      );
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes attachment and calls deleteFile with s3Key", async () => {
      const mockFindFirst = vi.fn().mockResolvedValue({ id: "att-1", s3Key: "uploads/org-1/receipt.pdf" });
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: mockFindFirst,
            delete: mockDelete,
          },
        })
      );

      const result = await caller.delete({ id: "att-1" });

      expect(result).toEqual({ success: true });
      expect(deleteFile).toHaveBeenCalledWith("uploads/org-1/receipt.pdf");
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: "att-1" } });
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND and does NOT call deleteFile when attachment missing", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue(null),
            delete: vi.fn(),
          },
        })
      );

      await expect(caller.delete({ id: "missing" })).rejects.toThrow(
        new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" })
      );
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  // ── linkToInvoice ──────────────────────────────────────────────────────────

  describe("linkToInvoice", () => {
    it("links attachment to invoice and clears billId", async () => {
      const mockAttachmentFindFirst = vi.fn().mockResolvedValue({ id: "att-1" });
      const mockInvoiceFindFirst = vi.fn().mockResolvedValue({ id: "inv-1" });
      const mockUpdate = vi.fn().mockResolvedValue({ id: "att-1", invoiceId: "inv-1" });
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: mockAttachmentFindFirst,
            update: mockUpdate,
          },
          invoice: {
            findFirst: mockInvoiceFindFirst,
          },
        })
      );

      const result = await caller.linkToInvoice({ id: "att-1", invoiceId: "inv-1" });

      expect(result).toEqual({ id: "att-1", invoiceId: "inv-1" });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invoiceId: "inv-1", billId: null }),
        })
      );
      expect(mockAttachmentFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
      expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND when attachment does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          invoice: {
            findFirst: vi.fn().mockResolvedValue({ id: "inv-1" }),
          },
        })
      );

      await expect(
        caller.linkToInvoice({ id: "missing", invoiceId: "inv-1" })
      ).rejects.toThrow(new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" }));
    });

    it("throws NOT_FOUND when invoice does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue({ id: "att-1" }),
          },
          invoice: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        })
      );

      await expect(
        caller.linkToInvoice({ id: "att-1", invoiceId: "missing" })
      ).rejects.toThrow(new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" }));
    });
  });

  // ── linkToBill ─────────────────────────────────────────────────────────────

  describe("linkToBill", () => {
    it("links attachment to bill and clears invoiceId", async () => {
      const mockAttachmentFindFirst = vi.fn().mockResolvedValue({ id: "att-1" });
      const mockBillFindFirst = vi.fn().mockResolvedValue({ id: "bill-1" });
      const mockUpdate = vi.fn().mockResolvedValue({ id: "att-1", billId: "bill-1" });
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: mockAttachmentFindFirst,
            update: mockUpdate,
          },
          bill: {
            findFirst: mockBillFindFirst,
          },
        })
      );

      const result = await caller.linkToBill({ id: "att-1", billId: "bill-1" });

      expect(result).toEqual({ id: "att-1", billId: "bill-1" });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ billId: "bill-1", invoiceId: null }),
        })
      );
      expect(mockAttachmentFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
      expect(mockBillFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: ORG }),
        })
      );
    });

    it("throws NOT_FOUND when attachment does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          bill: {
            findFirst: vi.fn().mockResolvedValue({ id: "bill-1" }),
          },
        })
      );

      await expect(
        caller.linkToBill({ id: "missing", billId: "bill-1" })
      ).rejects.toThrow(new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" }));
    });

    it("throws NOT_FOUND when bill does not exist", async () => {
      const caller = createCaller(
        makeCtx({
          attachment: {
            findFirst: vi.fn().mockResolvedValue({ id: "att-1" }),
          },
          bill: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        })
      );

      await expect(
        caller.linkToBill({ id: "att-1", billId: "missing" })
      ).rejects.toThrow(new TRPCError({ code: "NOT_FOUND", message: "Bill not found" }));
    });
  });
});
