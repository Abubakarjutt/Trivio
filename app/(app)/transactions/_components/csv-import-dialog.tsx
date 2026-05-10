"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type CsvRow = {
  date: string;
  description: string;
  amount: string;
  rawType: string;
};

type MappedRow = {
  date: Date;
  description: string;
  amount: number;
  type: "income" | "expense";
  accountId: string;
  cashAccountId: string;
  valid: boolean;
  error?: string;
};

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    return {
      date: row.date ?? row.Date ?? "",
      description: row.description ?? row.Description ?? row.memo ?? row.Memo ?? "",
      amount: row.amount ?? row.Amount ?? row.debit ?? row.credit ?? "",
      rawType: row.type ?? row.Type ?? (parseFloat(row.amount ?? "0") > 0 ? "income" : "expense"),
    };
  }).filter((r) => r.date && r.description);
}

function mapRow(row: CsvRow, defaultCashId: string, defaultIncomeId: string, defaultExpenseId: string): MappedRow {
  const amount = Math.abs(parseFloat(row.amount));
  const type = row.rawType?.toLowerCase().includes("income") || parseFloat(row.amount) > 0
    ? "income" as const
    : "expense" as const;

  if (isNaN(amount) || amount <= 0) {
    return { date: new Date(), description: row.description, amount: 0, type, accountId: "", cashAccountId: "", valid: false, error: "Invalid amount" };
  }

  const date = new Date(row.date);
  if (isNaN(date.getTime())) {
    return { date: new Date(), description: row.description, amount, type, accountId: "", cashAccountId: "", valid: false, error: "Invalid date" };
  }

  return {
    date,
    description: row.description,
    amount,
    type,
    accountId: type === "income" ? defaultIncomeId : defaultExpenseId,
    cashAccountId: defaultCashId,
    valid: true,
  };
}

export function CSVImportDialog({
  open, onClose, onImported, accounts, currency,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  accounts: { id: string; code: string; name: string; type: string }[];
  currency: string;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<MappedRow[]>([]);
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const [defaultCashId, setDefaultCashId] = useState(() => accounts.find((a) => a.code === "1100")?.id ?? "");
  const [defaultIncomeId, setDefaultIncomeId] = useState(() => accounts.find((a) => a.code === "4100")?.id ?? "");
  const [defaultExpenseId, setDefaultExpenseId] = useState(() => accounts.find((a) => a.code === "5950")?.id ?? "");

  const importMutation = trpc.transactions.importCSV.useMutation({
    onSuccess: (res) => {
      setResult(res);
      setStep("done");
      if (res.failed === 0) toast({ title: `Imported ${res.created} transactions` });
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    const mapped = parsed.map((r) => mapRow(r, defaultCashId, defaultIncomeId, defaultExpenseId));
    setRows(mapped);
    setStep("preview");
  };

  const handleImport = () => {
    const validRows = rows.filter((r) => r.valid && r.accountId && r.cashAccountId);
    importMutation.mutate({ rows: validRows });
  };

  const handleClose = () => {
    setStep("upload");
    setRows([]);
    setResult(null);
    onClose();
  };

  const validCount = rows.filter((r) => r.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Transactions from CSV</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Default bank / cash account</Label>
                <Select value={defaultCashId} onValueChange={setDefaultCashId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.type === "ASSET").map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default income account</Label>
                <Select value={defaultIncomeId} onValueChange={setDefaultIncomeId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.type === "INCOME").map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default expense account</Label>
                <Select value={defaultExpenseId} onValueChange={setDefaultExpenseId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.type === "EXPENSE").map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="font-medium text-sm">Click or drag a CSV file here</p>
              <p className="text-xs text-muted-foreground mt-1">Expected columns: date, description, amount (positive=income, negative=expense)</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant="success">{validCount} valid</Badge>
              {rows.length - validCount > 0 && <Badge variant="destructive">{rows.length - validCount} errors</Badge>}
              <span className="text-sm text-muted-foreground">{rows.length} rows parsed</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 20).map((row, i) => (
                  <TableRow key={i} className={!row.valid ? "bg-red-50" : ""}>
                    <TableCell className="text-sm">{row.date.toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm truncate max-w-xs">{row.description}</TableCell>
                    <TableCell>
                      <Badge variant={row.type === "income" ? "success" : "warning"} className="text-xs">
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatCurrency(row.amount, currency)}
                    </TableCell>
                    <TableCell>
                      {row.valid
                        ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                        : <span title={row.error}><XCircle className="h-4 w-4 text-red-500" /></span>}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length > 20 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      …and {rows.length - 20} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {step === "done" && result && (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <p className="font-semibold text-lg">Import complete</p>
            <p className="text-muted-foreground text-sm">
              {result.created} transaction{result.created !== 1 ? "s" : ""} imported
              {result.failed > 0 && `, ${result.failed} failed`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && <Button variant="outline" onClick={handleClose}>Cancel</Button>}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
              <Button disabled={validCount === 0 || importMutation.isPending} onClick={handleImport}>
                {importMutation.isPending && <Loader2 className="animate-spin" />}
                Import {validCount} transactions
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={() => { onImported(); handleClose(); }}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
