import { type NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvoicePDF } from "@/server/services/pdf/invoice-pdf";
import { effectiveStatus } from "@/server/services/invoice.service";
import { formatDate } from "@/lib/utils";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { organisationId: true } });
  if (!user?.organisationId) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const invoice = await db.invoice.findFirst({
    where: { id, organisationId: user.organisationId },
    include: { contact: true, lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const org = await db.organisation.findUnique({
    where: { id: user.organisationId },
    select: { name: true, currency: true },
  });

  const pdfData = {
    invoice: {
      number: invoice.number,
      date: formatDate(invoice.date),
      dueDate: formatDate(invoice.dueDate),
      status: effectiveStatus(invoice) as string,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid),
      notes: invoice.notes,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        amount: Number(l.amount),
        taxAmount: Number(l.taxAmount),
        taxRateCode: l.taxRateCode,
      })),
    },
    contact: {
      name: invoice.contact.name,
      email: invoice.contact.email,
      address: invoice.contact.address,
      taxNumber: invoice.contact.taxNumber,
    },
    organisation: { name: org?.name ?? "Organisation", currency: org?.currency ?? "USD" },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(InvoicePDF, { data: pdfData }) as any);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
    },
  });
}
