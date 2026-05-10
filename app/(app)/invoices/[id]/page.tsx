"use client";

import { useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, Send, Ban, CreditCard, Download } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-100 text-blue-800",
  PARTIAL: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  OVERDUE: "bg-red-100 text-red-800",
  VOID: "bg-gray-100 text-gray-500",
};

function PaymentDialog({ invoice, onClose, onSuccess }: {
  invoice: { id: string; amountDue: number; currency: string };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(invoice.amountDue.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cashAccountId, setCashAccountId] = useState("");
  const [reference, setReference] = useState("");

  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  const cashAccounts = accounts.filter((a) => a.type === "ASSET" && !a.isArchived);

  const record = trpc.invoices.recordPayment.useMutation({
    onSuccess: () => { toast({ title: "Payment recorded" }); onSuccess(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const canSave = cashAccountId && parseFloat(amount) > 0 && date;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              max={invoice.amountDue}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Outstanding: {formatCurrency(invoice.amountDue, invoice.currency)}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Deposit To (Account)</Label>
            <Select value={cashAccountId} onValueChange={setCashAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
              <SelectContent>
                {cashAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference (optional)</Label>
            <Input placeholder="Bank transfer ref, cheque #, etc." value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSave || record.isPending}
            onClick={() => record.mutate({
              id: invoice.id,
              amount: parseFloat(amount),
              cashAccountId,
              date: new Date(date),
              reference: reference || undefined,
            })}
          >
            {record.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ invoiceId, onClose, onSuccess }: { invoiceId: string; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("Voided by user");

  const voidMutation = trpc.invoices.void.useMutation({
    onSuccess: () => { toast({ title: "Invoice voided" }); onSuccess(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Void Invoice</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will reverse all journal entries and mark the invoice void. This cannot be undone.</p>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!reason || voidMutation.isPending}
            onClick={() => voidMutation.mutate({ id: invoiceId, reason })}
          >
            {voidMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Void Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [showPayment, setShowPayment] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const { data: invoice, refetch, isLoading } = trpc.invoices.getById.useQuery({ id });
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";

  const sendMutation = trpc.invoices.send.useMutation({
    onSuccess: () => { toast({ title: "Invoice sent and posted to ledger" }); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice) {
    return <div className="p-6">Invoice not found.</div>;
  }

  const canSend = invoice.effectiveStatus === "DRAFT";
  const canPay = ["SENT", "PARTIAL", "OVERDUE"].includes(invoice.effectiveStatus);
  const canVoid = invoice.effectiveStatus !== "VOID" && invoice.effectiveStatus !== "PAID";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {showPayment && (
        <PaymentDialog
          invoice={{ id: invoice.id, amountDue: invoice.amountDue, currency }}
          onClose={() => setShowPayment(false)}
          onSuccess={() => { setShowPayment(false); refetch(); }}
        />
      )}
      {showVoid && (
        <VoidDialog
          invoiceId={invoice.id}
          onClose={() => setShowVoid(false)}
          onSuccess={() => { setShowVoid(false); router.push("/invoices"); }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/invoices"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold font-mono">{invoice.number}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[invoice.effectiveStatus] ?? ""}`}>
                {invoice.effectiveStatus}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{invoice.contact.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
              <Download className="mr-1 h-3.5 w-3.5" /> PDF
            </a>
          </Button>
          {canSend && (
            <Button size="sm" disabled={sendMutation.isPending} onClick={() => sendMutation.mutate({ id: invoice.id, sendEmail: true })}>
              {sendMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              Send Invoice
            </Button>
          )}
          {canPay && (
            <Button size="sm" onClick={() => setShowPayment(true)}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Record Payment
            </Button>
          )}
          {canVoid && (
            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setShowVoid(true)}>
              <Ban className="mr-1 h-3.5 w-3.5" /> Void
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Invoice body */}
        <div className="md:col-span-2 space-y-5">
          {/* Bill-to + dates */}
          <Card>
            <CardContent className="pt-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-semibold mb-1">Bill To</p>
                  <p>{invoice.contact.name}</p>
                  {invoice.contact.email && <p className="text-muted-foreground">{invoice.contact.email}</p>}
                  {invoice.contact.address && <p className="text-muted-foreground">{invoice.contact.address}</p>}
                  {invoice.contact.taxNumber && <p className="text-muted-foreground">Tax: {invoice.contact.taxNumber}</p>}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice Date</span>
                    <span>{formatDate(invoice.date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due Date</span>
                    <span>{formatDate(invoice.dueDate)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line items */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-20">Qty</TableHead>
                    <TableHead className="text-right w-28">Unit Price</TableHead>
                    <TableHead className="text-right w-24">Tax</TableHead>
                    <TableHead className="text-right w-28">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right">{Number(line.quantity)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(line.unitPrice), currency)}</TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {line.taxRateCode ? `${line.taxRateCode} ${formatCurrency(Number(line.taxAmount), currency)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(Number(line.amount), currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {invoice.notes && (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm font-medium mb-1">Notes</p>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Summary */}
        <div>
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(invoice.subtotal), currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(Number(invoice.taxAmount), currency)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatCurrency(Number(invoice.totalAmount), currency)}</span>
              </div>
              {Number(invoice.amountPaid) > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid</span>
                    <span>−{formatCurrency(Number(invoice.amountPaid), currency)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold text-destructive">
                    <span>Amount Due</span>
                    <span>{formatCurrency(invoice.amountDue, currency)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
