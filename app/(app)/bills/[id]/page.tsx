"use client";

import { useState, use } from "react";
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
import { ArrowLeft, Loader2, CheckCircle, Ban, CreditCard } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-50 text-blue-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  PAID: "bg-green-50 text-green-700",
  OVERDUE: "bg-red-50 text-red-700",
  VOID: "bg-gray-100 text-gray-400",
};

function PaymentDialog({ bill, currency, onClose, onSuccess }: {
  bill: { id: string; amountDue: number };
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(bill.amountDue.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cashAccountId, setCashAccountId] = useState("");
  const [reference, setReference] = useState("");

  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  const cashAccounts = accounts.filter((a) => a.type === "ASSET" && !a.isArchived);

  const record = trpc.bills.recordPayment.useMutation({
    onSuccess: () => { toast({ title: "Payment recorded" }); onSuccess(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input type="number" min="0.01" step="0.01" max={bill.amountDue} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">Outstanding: {formatCurrency(bill.amountDue, currency)}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Paid From (Account)</Label>
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
            disabled={!cashAccountId || parseFloat(amount) <= 0 || record.isPending}
            onClick={() => record.mutate({ id: bill.id, amount: parseFloat(amount), cashAccountId, date: new Date(date), reference: reference || undefined })}
          >
            {record.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ billId, onClose, onSuccess }: { billId: string; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("Voided by user");
  const voidMutation = trpc.bills.void.useMutation({
    onSuccess: () => { toast({ title: "Bill voided" }); onSuccess(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Void Bill</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will reverse all journal entries and mark the bill void. This cannot be undone.</p>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason || voidMutation.isPending} onClick={() => voidMutation.mutate({ id: billId, reason })}>
            {voidMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Void Bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [showPayment, setShowPayment] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const { data: bill, refetch, isLoading } = trpc.bills.getById.useQuery({ id });
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";

  const approveMutation = trpc.bills.approve.useMutation({
    onSuccess: () => { toast({ title: "Bill approved and posted to ledger" }); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!bill) return <div className="p-6">Bill not found.</div>;

  const canApprove = bill.effectiveStatus === "DRAFT";
  const canPay = ["SENT", "PARTIAL", "OVERDUE"].includes(bill.effectiveStatus);
  const canVoid = bill.effectiveStatus !== "VOID" && bill.effectiveStatus !== "PAID";
  const displayStatus = bill.effectiveStatus === "SENT" ? "APPROVED" : bill.effectiveStatus;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-5">
      {showPayment && (
        <PaymentDialog
          bill={{ id: bill.id, amountDue: bill.amountDue }}
          currency={currency}
          onClose={() => setShowPayment(false)}
          onSuccess={() => { setShowPayment(false); refetch(); }}
        />
      )}
      {showVoid && (
        <VoidDialog
          billId={bill.id}
          onClose={() => setShowVoid(false)}
          onSuccess={() => { setShowVoid(false); router.push("/bills"); }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/bills"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-mono">{bill.number ?? "Draft Bill"}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[bill.effectiveStatus] ?? ""}`}>
                {displayStatus}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{bill.contact.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canApprove && (
            <Button size="sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate({ id: bill.id })}>
              {approveMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1 h-3.5 w-3.5" />}
              Approve & Post
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
        <div className="md:col-span-2 space-y-5">
          <Card>
            <CardContent className="pt-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-semibold mb-1">From</p>
                  <p>{bill.contact.name}</p>
                  {bill.contact.email && <p className="text-muted-foreground">{bill.contact.email}</p>}
                  {bill.contact.address && <p className="text-muted-foreground">{bill.contact.address}</p>}
                  {bill.contact.taxNumber && <p className="text-muted-foreground">Tax: {bill.contact.taxNumber}</p>}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bill Date</span>
                    <span>{formatDate(bill.date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due Date</span>
                    <span>{formatDate(bill.dueDate)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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
                  {bill.lines.map((line) => (
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

          {bill.notes && (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm font-medium mb-1">Notes</p>
                <p className="text-sm text-muted-foreground">{bill.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(bill.subtotal), currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(Number(bill.taxAmount), currency)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatCurrency(Number(bill.totalAmount), currency)}</span>
              </div>
              {Number(bill.amountPaid) > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid</span>
                    <span>−{formatCurrency(Number(bill.amountPaid), currency)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold text-destructive">
                    <span>Amount Due</span>
                    <span>{formatCurrency(bill.amountDue, currency)}</span>
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
