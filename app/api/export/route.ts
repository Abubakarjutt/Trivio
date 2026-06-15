import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  void request;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { organisationId: true },
  });
  if (!user?.organisationId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }
  const organisationId = user.organisationId;

  // Fetch all data in parallel
  const [invoices, bills, contacts, journalEntries] = await Promise.all([
    db.invoice.findMany({
      where: { organisationId },
      include: { contact: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    db.bill.findMany({
      where: { organisationId },
      include: { contact: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    db.contact.findMany({
      where: { organisationId },
      orderBy: { name: "asc" },
    }),
    db.journalEntry.findMany({
      where: { organisationId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: { date: "desc" },
    }),
  ]);

  const invoiceCsv = toCsv(
    invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      date: inv.date.toISOString().slice(0, 10),
      due_date: inv.dueDate.toISOString().slice(0, 10),
      contact: inv.contact.name,
      status: inv.status,
      subtotal: inv.subtotal.toFixed(2),
      tax_amount: inv.taxAmount.toFixed(2),
      total_amount: inv.totalAmount.toFixed(2),
      amount_paid: inv.amountPaid.toFixed(2),
      notes: inv.notes ?? "",
    }))
  );

  const billCsv = toCsv(
    bills.map((b) => ({
      id: b.id,
      number: b.number ?? "",
      date: b.date.toISOString().slice(0, 10),
      due_date: b.dueDate.toISOString().slice(0, 10),
      contact: b.contact.name,
      status: b.status,
      subtotal: b.subtotal.toFixed(2),
      tax_amount: b.taxAmount.toFixed(2),
      total_amount: b.totalAmount.toFixed(2),
      amount_paid: b.amountPaid.toFixed(2),
    }))
  );

  const contactCsv = toCsv(
    contacts.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      tax_number: c.taxNumber ?? "",
    }))
  );

  // Flatten journal entries with lines
  const journalRows: Record<string, unknown>[] = [];
  for (const entry of journalEntries) {
    for (const line of entry.lines) {
      journalRows.push({
        entry_id: entry.id,
        date: entry.date.toISOString().slice(0, 10),
        description: entry.description,
        source: entry.source,
        is_void: entry.isVoid,
        line_id: line.id,
        account_code: line.account.code,
        account_name: line.account.name,
        debit: line.debit?.toFixed(2) ?? "",
        credit: line.credit?.toFixed(2) ?? "",
        line_description: line.description ?? "",
      });
    }
  }
  const journalCsv = toCsv(journalRows);

  const zip = new JSZip();
  zip.file("invoices.csv", invoiceCsv);
  zip.file("bills.csv", billCsv);
  zip.file("contacts.csv", contactCsv);
  zip.file("journal_entries.csv", journalCsv);

  const zipUint8 = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const zipBuffer = Buffer.from(zipUint8).buffer;

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="trivio-export-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}
