import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32 },
  brandBlock: { flex: 1 },
  brandName: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#1d4ed8", marginBottom: 4 },
  brandAddress: { color: "#6b7280", fontSize: 9, lineHeight: 1.5 },
  invoiceMeta: { alignItems: "flex-end" },
  invoiceTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 8 },
  metaRow: { flexDirection: "row", gap: 8, marginBottom: 3 },
  metaLabel: { color: "#6b7280", width: 80, textAlign: "right" },
  metaValue: { fontFamily: "Helvetica-Bold", color: "#111827" },
  divider: { borderBottom: "1 solid #e5e7eb", marginBottom: 20 },
  billSection: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  billLabel: { color: "#6b7280", marginBottom: 4, fontSize: 9, textTransform: "uppercase" },
  billName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 2 },
  billDetail: { color: "#4b5563", lineHeight: 1.5, fontSize: 9 },
  table: { marginBottom: 20 },
  tableHeader: { flexDirection: "row", backgroundColor: "#1d4ed8", padding: 8 },
  tableHeaderText: { color: "white", fontFamily: "Helvetica-Bold", fontSize: 9 },
  tableRow: { flexDirection: "row", borderBottom: "1 solid #f3f4f6", padding: "6 8" },
  tableRowAlt: { backgroundColor: "#f9fafb" },
  col_desc: { flex: 3 },
  col_qty: { flex: 1, textAlign: "right" },
  col_price: { flex: 1, textAlign: "right" },
  col_tax: { flex: 1, textAlign: "right" },
  col_total: { flex: 1, textAlign: "right" },
  totalsSection: { alignItems: "flex-end", marginTop: 8 },
  totalsTable: { width: 240 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", padding: "4 0" },
  totalsLabel: { color: "#6b7280" },
  totalsValue: { fontFamily: "Helvetica-Bold" },
  totalsDivider: { borderBottom: "1 solid #e5e7eb", marginVertical: 4 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", padding: "6 0" },
  grandTotalLabel: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  grandTotalValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#1d4ed8" },
  notes: { marginTop: 24, padding: 12, backgroundColor: "#f9fafb", borderRadius: 4 },
  notesLabel: { color: "#6b7280", fontSize: 9, marginBottom: 4 },
  notesText: { color: "#374151", lineHeight: 1.5 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, textAlign: "center", color: "#9ca3af", fontSize: 8 },
  statusBadge: { alignSelf: "flex-start", backgroundColor: "#dcfce7", padding: "2 8", borderRadius: 4, marginTop: 8 },
  statusText: { color: "#166534", fontSize: 9, fontFamily: "Helvetica-Bold" },
});

export interface InvoicePDFData {
  invoice: {
    number: string;
    date: string;
    dueDate: string;
    status: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    amountPaid: number;
    notes?: string | null;
    lines: {
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      taxAmount: number;
      taxRateCode?: string | null;
    }[];
  };
  contact: {
    name: string;
    email?: string | null;
    address?: string | null;
    taxNumber?: string | null;
  };
  organisation: {
    name: string;
    currency: string;
  };
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

export function InvoicePDF({ data }: { data: InvoicePDFData }) {
  const { invoice, contact, organisation } = data;
  const amountDue = invoice.totalAmount - invoice.amountPaid;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{organisation.name}</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{invoice.status}</Text>
            </View>
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Number</Text>
              <Text style={styles.metaValue}>{invoice.number}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text style={styles.metaValue}>{invoice.date}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Due</Text>
              <Text style={styles.metaValue}>{invoice.dueDate}</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Bill To */}
        <View style={styles.billSection}>
          <View>
            <Text style={styles.billLabel}>Bill To</Text>
            <Text style={styles.billName}>{contact.name}</Text>
            {contact.email && <Text style={styles.billDetail}>{contact.email}</Text>}
            {contact.address && <Text style={styles.billDetail}>{contact.address}</Text>}
            {contact.taxNumber && <Text style={styles.billDetail}>Tax No: {contact.taxNumber}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.billLabel}>Amount Due</Text>
            <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1d4ed8" }}>
              {fmt(amountDue, organisation.currency)}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.col_desc]}>Description</Text>
            <Text style={[styles.tableHeaderText, styles.col_qty]}>Qty</Text>
            <Text style={[styles.tableHeaderText, styles.col_price]}>Unit Price</Text>
            <Text style={[styles.tableHeaderText, styles.col_tax]}>Tax</Text>
            <Text style={[styles.tableHeaderText, styles.col_total]}>Total</Text>
          </View>
          {invoice.lines.map((line, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[{ color: "#374151" }, styles.col_desc]}>{line.description}</Text>
              <Text style={[{ color: "#374151" }, styles.col_qty]}>{line.quantity}</Text>
              <Text style={[{ color: "#374151" }, styles.col_price]}>{fmt(line.unitPrice, organisation.currency)}</Text>
              <Text style={[{ color: "#374151" }, styles.col_tax]}>
                {line.taxAmount > 0 ? fmt(line.taxAmount, organisation.currency) : "—"}
              </Text>
              <Text style={[{ color: "#374151" }, styles.col_total]}>
                {fmt(line.amount + line.taxAmount, organisation.currency)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsTable}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{fmt(invoice.subtotal, organisation.currency)}</Text>
            </View>
            {invoice.taxAmount > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax</Text>
                <Text style={styles.totalsValue}>{fmt(invoice.taxAmount, organisation.currency)}</Text>
              </View>
            )}
            <View style={styles.totalsDivider} />
            <View style={styles.grandTotal}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{fmt(invoice.totalAmount, organisation.currency)}</Text>
            </View>
            {invoice.amountPaid > 0 && (
              <>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Amount Paid</Text>
                  <Text style={styles.totalsValue}>{fmt(invoice.amountPaid, organisation.currency)}</Text>
                </View>
                <View style={styles.totalsDivider} />
                <View style={styles.grandTotal}>
                  <Text style={styles.grandTotalLabel}>Balance Due</Text>
                  <Text style={styles.grandTotalValue}>{fmt(amountDue, organisation.currency)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>NOTES</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Generated by AutoAccounts · {invoice.number} · {organisation.name}
        </Text>
      </Page>
    </Document>
  );
}
