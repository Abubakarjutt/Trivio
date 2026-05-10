import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { deleteFile } from "@/lib/storage";

export const attachmentsRouter = createTRPCRouter({
  /**
   * Poll extraction status for a single attachment.
   */
  getStatus: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const attachment = await ctx.db.attachment.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          extractionStatus: true,
          extractionResult: true,
          invoiceId: true,
          billId: true,
          uploadedAt: true,
        },
      });
      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }
      return attachment;
    }),

  /**
   * List all attachments linked to a specific invoice.
   */
  listForInvoice: orgProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify invoice belongs to org
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      return ctx.db.attachment.findMany({
        where: { invoiceId: input.invoiceId, organisationId: ctx.organisationId },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          extractionStatus: true,
          extractionResult: true,
          uploadedAt: true,
        },
        orderBy: { uploadedAt: "desc" },
      });
    }),

  /**
   * List all attachments linked to a specific bill.
   */
  listForBill: orgProcedure
    .input(z.object({ billId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify bill belongs to org
      const bill = await ctx.db.bill.findFirst({
        where: { id: input.billId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!bill) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found" });
      }

      return ctx.db.attachment.findMany({
        where: { billId: input.billId, organisationId: ctx.organisationId },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          extractionStatus: true,
          extractionResult: true,
          uploadedAt: true,
        },
        orderBy: { uploadedAt: "desc" },
      });
    }),

  /**
   * Delete an attachment record and its file from disk.
   */
  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await ctx.db.attachment.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        select: { id: true, s3Key: true },
      });
      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }

      // Delete file from disk first
      await deleteFile(attachment.s3Key);

      // Delete DB record
      await ctx.db.attachment.delete({ where: { id: input.id } });

      return { success: true };
    }),

  /**
   * Link an existing attachment to an invoice.
   */
  linkToInvoice: orgProcedure
    .input(z.object({ id: z.string(), invoiceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify attachment belongs to org
      const attachment = await ctx.db.attachment.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }

      // Verify invoice belongs to org
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      const updated = await ctx.db.attachment.update({
        where: { id: input.id },
        data: { invoiceId: input.invoiceId, billId: null },
        select: { id: true, invoiceId: true },
      });
      return updated;
    }),

  /**
   * Link an existing attachment to a bill.
   */
  linkToBill: orgProcedure
    .input(z.object({ id: z.string(), billId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify attachment belongs to org
      const attachment = await ctx.db.attachment.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      }

      // Verify bill belongs to org
      const bill = await ctx.db.bill.findFirst({
        where: { id: input.billId, organisationId: ctx.organisationId },
        select: { id: true },
      });
      if (!bill) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found" });
      }

      const updated = await ctx.db.attachment.update({
        where: { id: input.id },
        data: { billId: input.billId, invoiceId: null },
        select: { id: true, billId: true },
      });
      return updated;
    }),
});
