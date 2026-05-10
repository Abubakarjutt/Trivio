"use client";

import { useState, useCallback, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, ArrowLeft, Sparkles, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import type { ExtractionResult } from "@/server/services/extraction.service";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateCode: string;
  taxAmount: string;
}

const EMPTY_LINE: LineItem = {
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRateCode: "",
  taxAmount: "0",
};

function toNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  if (value >= 0.8) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2 className="h-2.5 w-2.5" />{label}
      </span>
    );
  }
  if (value >= 0.5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-2.5 w-2.5" />{label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <XCircle className="h-2.5 w-2.5" />{label}
    </span>
  );
}

function NewInvoiceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const extractionId = searchParams.get("extractionId");

  const [contactId, setContactId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [aiPrefilled, setAiPrefilled] = useState(false);

  const { data: contacts = [] } = trpc.contacts.list.useQuery({ type: "CUSTOMER" });
  const { data: orgData } = trpc.org.get.useQuery();
  const taxRates = useMemo(() => orgData?.taxRegime?.rates ?? [], [orgData]);
  const currency = orgData?.currency ?? "USD";

  // Fetch extraction result if extractionId is present
  const { data: attachmentData } = trpc.attachments.getStatus.useQuery(
    { id: extractionId! },
    { enabled: !!extractionId && !aiPrefilled },
  );

  // Pre-fill form from extraction result
  useEffect(() => {
    if (!attachmentData || aiPrefilled) return;
    if (attachmentData.extractionStatus !== "DONE" || !attachmentData.extractionResult) return;

    const result = attachmentData.extractionResult as unknown as ExtractionResult;
    setAiPrefilled(true);

    if (result.invoiceDate) setDate(result.invoiceDate);
    if (result.dueDate) setDueDate(result.dueDate);
    if (result.notes) setNotes(result.notes);

    if (result.lineItems.length > 0) {
      setLines(
        result.lineItems.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          taxRateCode: "",
          taxAmount: "0",
        })),
      );
    }

    // Try to find a matching contact by supplier name
    if (result.supplierName) {
      const match = contacts.find(
        (c) => c.name.toLowerCase() === result.supplierName!.toLowerCase(),
      );
      if (match) setContactId(match.id);
    }
  }, [attachmentData, aiPrefilled, contacts]);

  const create = trpc.invoices.create.useMutation({
    onSuccess: (inv) => {
      toast({ title: "Invoice created" });
      router.push(`/invoices/${inv.id}`);
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const updateLine = useCallback((idx: number, field: keyof LineItem, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx]! };
      line[field] = value;

      if (field === "quantity" || field === "unitPrice" || field === "taxRateCode") {
        const qty = toNum(field === "quantity" ? value : line.quantity);
        const price = toNum(field === "unitPrice" ? value : line.unitPrice);
        const lineAmount = qty * price;
        const rateCode = field === "taxRateCode" ? value : line.taxRateCode;
        const rate = rateCode && rateCode !== "none" ? taxRates.find((r) => r.code === rateCode) : undefined;
        line.taxAmount = rate ? (lineAmount * (Number(rate.rate) / 100)).toFixed(2) : "0";
      }

      next[idx] = line;
      return next;
    });
  }, [taxRates]);

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = lines.reduce((s, l) => s + toNum(l.quantity) * toNum(l.unitPrice), 0);
  const taxTotal = lines.reduce((s, l) => s + toNum(l.taxAmount), 0);
  const total = subtotal + taxTotal;

  const canSave = contactId && date && dueDate && lines.some((l) => l.description && toNum(l.unitPrice) > 0);

  const handleSave = () => {
    create.mutate({
      contactId,
      date: new Date(date),
      dueDate: new Date(dueDate),
      notes: notes || undefined,
      lines: lines
        .filter((l) => l.description && toNum(l.unitPrice) > 0)
        .map((l, i) => ({
          description: l.description,
          quantity: toNum(l.quantity) || 1,
          unitPrice: toNum(l.unitPrice),
          taxRateCode: l.taxRateCode && l.taxRateCode !== "none" ? l.taxRateCode : undefined,
          taxAmount: toNum(l.taxAmount),
          sortOrder: i,
        })),
    });
  };

  const extraction = attachmentData?.extractionResult as unknown as ExtractionResult | undefined;
  const conf = extraction?.confidence ?? {};

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/invoices"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Invoice</h1>
          <p className="text-muted-foreground text-sm">Create a new customer invoice</p>
        </div>
      </div>

      {/* AI extracted banner */}
      {aiPrefilled && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">AI pre-filled from document</p>
            <p className="text-xs text-muted-foreground">Review and adjust before saving</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {conf.invoiceDate != null && <ConfidenceBadge value={conf.invoiceDate} label="Date" />}
            {conf.dueDate != null && <ConfidenceBadge value={conf.dueDate} label="Due date" />}
            {conf.lineItems != null && <ConfidenceBadge value={conf.lineItems} label="Line items" />}
            {conf.totalAmount != null && <ConfidenceBadge value={conf.totalAmount} label="Total" />}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Left: invoice details */}
        <div className="md:col-span-2 space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  Customer *
                  {aiPrefilled && extraction?.supplierName && !contactId && (
                    <Badge variant="outline" className="ml-2 text-[10px] font-normal text-muted-foreground">
                      AI: {extraction.supplierName}
                    </Badge>
                  )}
                </Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2">
                    Invoice Date *
                    {aiPrefilled && conf.invoiceDate != null && (
                      <ConfidenceBadge value={conf.invoiceDate} label="AI" />
                    )}
                  </Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2">
                    Due Date *
                    {aiPrefilled && conf.dueDate != null && (
                      <ConfidenceBadge value={conf.dueDate} label="AI" />
                    )}
                  </Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Line Items</CardTitle>
                  {aiPrefilled && conf.lineItems != null && (
                    <ConfidenceBadge value={conf.lineItems} label="AI" />
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Line
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground pb-1 border-b">
                <span className="col-span-4">Description</span>
                <span className="col-span-2 text-right">Qty</span>
                <span className="col-span-2 text-right">Unit Price</span>
                <span className="col-span-2">Tax</span>
                <span className="col-span-1 text-right">Amount</span>
                <span className="col-span-1" />
              </div>

              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
                    <Input
                      placeholder="Item description"
                      value={line.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="text-right"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="text-right"
                      placeholder="0.00"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Select value={line.taxRateCode} onValueChange={(v) => updateLine(idx, "taxRateCode", v)}>
                      <SelectTrigger className="text-xs"><SelectValue placeholder="No tax" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No tax</SelectItem>
                        {taxRates.map((r) => (
                          <SelectItem key={r.code} value={r.code}>
                            {r.name} ({Number(r.rate)}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex items-center justify-end pt-2 text-sm font-medium">
                    {formatCurrency(toNum(line.quantity) * toNum(line.unitPrice), currency)}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {lines.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeLine(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              <Separator />

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-2">
                  Notes
                  {aiPrefilled && conf.notes != null && (
                    <ConfidenceBadge value={conf.notes} label="AI" />
                  )}
                </Label>
                <Input placeholder="Payment terms, bank details, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: summary */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(taxTotal, currency)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatCurrency(total, currency)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button disabled={!canSave || create.isPending} onClick={handleSave}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save as Draft
            </Button>
            <Button variant="outline" asChild>
              <Link href="/invoices">Cancel</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<div className="p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <NewInvoiceForm />
    </Suspense>
  );
}
