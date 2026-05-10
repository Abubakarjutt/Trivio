"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  Zap,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type StatementLineStatus = "UNMATCHED" | "MATCHED" | "EXCLUDED" | "CREATED";

// ── CSV Parsing ───────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  const s = raw.trim();
  // ISO 8601
  const iso = Date.parse(s);
  if (!isNaN(iso) && s.includes("-")) return new Date(iso);
  // DD/MM/YYYY
  const dmY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmY) {
    const d = new Date(`${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  // MM/DD/YYYY
  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdY) {
    const d = new Date(`${mdY[3]}-${mdY[1].padStart(2, "0")}-${mdY[2].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseCSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((row) =>
      row.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim())
    )
    .filter((row) => row.some((c) => c !== ""));
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatementLineStatus }) {
  const map: Record<StatementLineStatus, string> = {
    UNMATCHED: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
    MATCHED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    EXCLUDED: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200",
    CREATED: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  };
  const label: Record<StatementLineStatus, string> = {
    UNMATCHED: "Unmatched",
    MATCHED: "Matched",
    EXCLUDED: "Excluded",
    CREATED: "Created",
  };
  return (
    <span
      className={cn(
        "inline-flex text-xs font-medium px-2 py-0.5 rounded-full",
        map[status]
      )}
    >
      {label[status]}
    </span>
  );
}

// ── CSV Import Dialog ─────────────────────────────────────────────────────────

function CSVImportDialog({
  bankAccountId,
  open,
  onClose,
  onImported,
}: {
  bankAccountId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [csvText, setCsvText] = useState("");
  const [dateCol, setDateCol] = useState("0");
  const [descCol, setDescCol] = useState("1");
  const [amountCol, setAmountCol] = useState("2");
  const [hasHeader, setHasHeader] = useState(true);

  const importMutation = trpc.bankAccounts.importStatementLines.useMutation({
    onSuccess: (data) => {
      toast({ title: `Imported ${data.count} statement lines` });
      setCsvText("");
      onImported();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const allRows = csvText.trim() ? parseCSV(csvText) : [];
  const dataRows = hasHeader ? allRows.slice(1) : allRows;
  const headers =
    hasHeader && allRows.length > 0
      ? allRows[0]
      : Array.from({ length: Math.max(allRows[0]?.length ?? 3, 3) }, (_, i) =>
          `Column ${i + 1}`
        );
  const previewRows = dataRows.slice(0, 5);

  const handleImport = () => {
    const lines: { date: Date; description: string; amount: string }[] = [];
    for (const row of dataRows) {
      const rawDate = row[Number(dateCol)] ?? "";
      const desc = row[Number(descCol)] ?? "";
      const rawAmount = (row[Number(amountCol)] ?? "").replace(/[^0-9.\-]/g, "");
      const date = parseDate(rawDate);
      if (!date || !desc || !rawAmount) continue;
      lines.push({ date, description: desc, amount: rawAmount });
    }
    if (lines.length === 0) {
      toast({ variant: "destructive", title: "No valid rows found to import" });
      return;
    }
    importMutation.mutate({ bankAccountId, lines });
  };

  const colOptions = headers.map((h, i) => ({ value: String(i), label: `${i + 1}: ${h}` }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import CSV Statement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Paste CSV content</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y min-h-[120px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={"date,description,amount\n2026-01-15,Coffee shop,-12.50\n2026-01-16,Client payment,500.00"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasHeader"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="hasHeader" className="text-sm text-muted-foreground select-none">
              First row is a header
            </label>
          </div>

          {allRows.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Date column</Label>
                <Select value={dateCol} onValueChange={setDateCol}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {colOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Description column</Label>
                <Select value={descCol} onValueChange={setDescCol}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {colOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount column</Label>
                <Select value={amountCol} onValueChange={setAmountCol}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {colOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {previewRows.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Preview (first 5 rows)
              </p>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-semibold">Date</th>
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-semibold">Description</th>
                      <th className="px-3 py-1.5 text-right text-muted-foreground font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-mono">{row[Number(dateCol)]}</td>
                        <td className="px-3 py-1.5 truncate max-w-[200px]">{row[Number(descCol)]}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{row[Number(amountCol)]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={dataRows.length === 0 || importMutation.isPending}
            onClick={handleImport}
          >
            {importMutation.isPending && <Loader2 className="animate-spin" />}
            Import {dataRows.length} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Match Picker Dialog ───────────────────────────────────────────────────────

function MatchPickerDialog({
  bankAccountId,
  statementLineId,
  open,
  onClose,
  onMatched,
}: {
  bankAccountId: string;
  statementLineId: string;
  open: boolean;
  onClose: () => void;
  onMatched: () => void;
}) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");

  const { data, isFetching } = trpc.bankAccounts.getUnmatchedJournalLines.useQuery(
    { bankAccountId, page },
    { enabled: open }
  );

  const matchMutation = trpc.bankAccounts.matchLine.useMutation({
    onSuccess: () => {
      toast({ title: "Line matched" });
      onMatched();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select a journal line to match</DialogTitle>
        </DialogHeader>

        {isFetching && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isFetching && data && (
          <>
            <div className="rounded-md border border-border overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground w-8" />
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Debit</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-sm">
                        No unmatched journal lines for this account
                      </td>
                    </tr>
                  )}
                  {data.lines.map((line) => (
                    <tr
                      key={line.id}
                      onClick={() => setSelectedId(line.id)}
                      className={cn(
                        "border-t border-border/40 cursor-pointer transition-colors",
                        selectedId === line.id ? "bg-primary/5" : "hover:bg-muted/30"
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className={cn(
                          "h-4 w-4 rounded-full border-2 transition-colors",
                          selectedId === line.id ? "border-primary bg-primary" : "border-border"
                        )} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatDate(line.journalEntry.date)}</td>
                      <td className="px-3 py-2 truncate max-w-[200px]">
                        {line.journalEntry.description}
                        {line.description && (
                          <span className="text-muted-foreground ml-1">· {line.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                        {line.debit ? String(line.debit) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                        {line.credit ? String(line.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.pages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{data.total} lines</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span>Page {page} / {data.pages}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selectedId || matchMutation.isPending}
            onClick={() => matchMutation.mutate({ bankStatementLineId: statementLineId, journalLineId: selectedId })}
          >
            {matchMutation.isPending && <Loader2 className="animate-spin" />}
            Match selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Journal Dialog ─────────────────────────────────────────────────────

function CreateJournalDialog({
  bankAccountId,
  statementLineId,
  statementAmount,
  open,
  onClose,
  onCreated,
}: {
  bankAccountId: string;
  statementLineId: string;
  statementAmount: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [contraAccountId, setContraAccountId] = useState("");
  const [description, setDescription] = useState("");

  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  // Contra can be any non-bank account (income/expense/liability etc.)
  const contraAccounts = accounts.filter((a) => a.type !== "ASSET" || true); // show all

  const createMutation = trpc.bankAccounts.createJournalForLine.useMutation({
    onSuccess: () => {
      toast({ title: "Journal entry created" });
      onCreated();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const amt = Number(statementAmount);
  const isPositive = amt >= 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Journal Entry</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isPositive
            ? `Money in: ${statementAmount} — will debit the bank account and credit your chosen account.`
            : `Money out: ${statementAmount} — will debit your chosen account and credit the bank account.`}
        </p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Contra account</Label>
            <Select value={contraAccountId} onValueChange={setContraAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {contraAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              placeholder="e.g. Bank fee — January"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!contraAccountId || !description || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                bankStatementLineId: statementLineId,
                accountId: contraAccountId,
                description,
              })
            }
          >
            {createMutation.isPending && <Loader2 className="animate-spin" />}
            Create journal entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BankAccountWorkspacePage() {
  const params = useParams();
  const bankAccountId = params.bankAccountId as string;

  const { toast } = useToast();
  const { data: org } = trpc.org.get.useQuery();
  const currency = org?.currency ?? "USD";

  const [showImport, setShowImport] = useState(false);
  const [linesPage, setLinesPage] = useState(1);
  const [journalPage, setJournalPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatementLineStatus | "ALL">("ALL");

  // Dialogs for per-line actions
  const [matchDialogLineId, setMatchDialogLineId] = useState<string | null>(null);
  const [createJournalLineId, setCreateJournalLineId] = useState<string | null>(null);
  const [createJournalAmount, setCreateJournalAmount] = useState<string>("0");

  const { data: bankAccount, refetch: refetchAccount } = trpc.bankAccounts.getById.useQuery(
    { id: bankAccountId },
    { enabled: !!bankAccountId }
  );

  const { data: linesData, refetch: refetchLines } = trpc.bankAccounts.getStatementLines.useQuery(
    {
      bankAccountId,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      page: linesPage,
    },
    { enabled: !!bankAccountId }
  );

  const { data: journalData, refetch: refetchJournal } = trpc.bankAccounts.getUnmatchedJournalLines.useQuery(
    { bankAccountId, page: journalPage },
    { enabled: !!bankAccountId }
  );

  const { data: summary, refetch: refetchSummary } = trpc.bankAccounts.getReconciliationSummary.useQuery(
    { bankAccountId },
    { enabled: !!bankAccountId }
  );

  const refetchAll = useCallback(() => {
    refetchAccount();
    refetchLines();
    refetchJournal();
    refetchSummary();
  }, [refetchAccount, refetchLines, refetchJournal, refetchSummary]);

  const autoMatch = trpc.bankAccounts.autoMatch.useMutation({
    onSuccess: (data) => {
      toast({ title: `Auto-matched ${data.matched} line${data.matched === 1 ? "" : "s"}` });
      refetchAll();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const unmatch = trpc.bankAccounts.unmatchLine.useMutation({
    onSuccess: () => { toast({ title: "Line unmatched" }); refetchAll(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const exclude = trpc.bankAccounts.excludeLine.useMutation({
    onSuccess: () => { toast({ title: "Line excluded" }); refetchAll(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const restore = trpc.bankAccounts.restoreLine.useMutation({
    onSuccess: () => { toast({ title: "Line restored" }); refetchAll(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  if (!bankAccount) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusCounts: Record<string, number> = {
    UNMATCHED: summary?.summary.UNMATCHED.count ?? 0,
    MATCHED: summary?.summary.MATCHED.count ?? 0,
    EXCLUDED: summary?.summary.EXCLUDED.count ?? 0,
    CREATED: summary?.summary.CREATED.count ?? 0,
  };

  const bookBalance = summary?.bookBalance ?? 0;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/reconciliation">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-serif text-foreground leading-tight">{bankAccount.name}</h1>
              <p className="text-xs text-muted-foreground">
                {bankAccount.chartAccount.code} — {bankAccount.chartAccount.name}
                <span className="mx-2 text-border">·</span>
                Book balance:{" "}
                <span className="font-mono font-medium text-foreground">
                  {formatCurrency(bookBalance, currency)}
                </span>
                {statusCounts.UNMATCHED > 0 && (
                  <>
                    <span className="mx-2 text-border">·</span>
                    <span className="text-amber-600 font-medium">{statusCounts.UNMATCHED} unmatched</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={autoMatch.isPending}
              onClick={() => autoMatch.mutate({ bankAccountId })}
            >
              {autoMatch.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Auto-Match
            </Button>
            <Button size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Status summary strip */}
        <div className="flex flex-wrap gap-2">
          {(["ALL", "UNMATCHED", "MATCHED", "EXCLUDED", "CREATED"] as const).map((s) => {
            const count = s === "ALL"
              ? Object.values(statusCounts).reduce((a, b) => a + b, 0)
              : statusCounts[s] ?? 0;
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setLinesPage(1); }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                )}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                <span className={cn(
                  "rounded-full text-[10px] px-1.5 py-0.5 font-bold",
                  active ? "bg-white/20" : "bg-muted"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Left — Statement Lines */}
          <Card className="rounded-2xl border border-border/40 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-sm font-semibold text-foreground">
                Statement Lines
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Date</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Description</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right">Amount</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!linesData?.lines.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                        No statement lines. Import a CSV to get started.
                      </TableCell>
                    </TableRow>
                  )}
                  {linesData?.lines.map((line) => {
                    const amt = Number(line.amount);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(line.date)}
                        </TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate">
                          <span title={line.description}>{line.description}</span>
                          {line.journalLine && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              ↳ {line.journalLine.journalEntry.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-mono tabular-nums text-xs font-medium",
                          amt >= 0 ? "text-emerald-700" : "text-destructive"
                        )}>
                          {amt >= 0 ? "+" : ""}{formatCurrency(amt, currency)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={line.status as StatementLineStatus} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {line.status === "UNMATCHED" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setMatchDialogLineId(line.id)}
                                >
                                  Match
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={() => exclude.mutate({ bankStatementLineId: line.id })}
                                >
                                  Exclude
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-primary"
                                  onClick={() => {
                                    setCreateJournalLineId(line.id);
                                    setCreateJournalAmount(String(line.amount));
                                  }}
                                >
                                  Create
                                </Button>
                              </>
                            )}
                            {line.status === "MATCHED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-muted-foreground"
                                onClick={() => unmatch.mutate({ bankStatementLineId: line.id })}
                              >
                                Unmatch
                              </Button>
                            )}
                            {(line.status === "EXCLUDED" || line.status === "CREATED") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-muted-foreground"
                                onClick={() => restore.mutate({ bankStatementLineId: line.id })}
                              >
                                Restore
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {linesData && linesData.pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
                  <span>{linesData.total} lines</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={linesPage === 1} onClick={() => setLinesPage((p) => p - 1)}>
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span>{linesPage} / {linesData.pages}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={linesPage >= linesData.pages} onClick={() => setLinesPage((p) => p + 1)}>
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right — Unmatched Journal Lines */}
          <Card className="rounded-2xl border border-border/40 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-sm font-semibold text-foreground">
                Unmatched Journal Lines
                <span className="ml-2 text-muted-foreground font-normal text-xs">
                  (for {bankAccount.chartAccount.name})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Date</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Description</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right">Debit</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!journalData?.lines.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                        No unmatched journal lines for this account.
                      </TableCell>
                    </TableRow>
                  )}
                  {journalData?.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(line.journalEntry.date)}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        <span className="truncate block" title={line.journalEntry.description}>
                          {line.journalEntry.description}
                        </span>
                        {line.description && (
                          <span className="text-[10px] text-muted-foreground">{line.description}</span>
                        )}
                        {line.journalEntry.reference && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1 ml-1">
                            {line.journalEntry.reference}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-xs">
                        {line.debit ? formatCurrency(Number(line.debit), currency) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-xs">
                        {line.credit ? formatCurrency(Number(line.credit), currency) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {journalData && journalData.pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
                  <span>{journalData.total} lines</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={journalPage === 1} onClick={() => setJournalPage((p) => p - 1)}>
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span>{journalPage} / {journalData.pages}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={journalPage >= journalData.pages} onClick={() => setJournalPage((p) => p + 1)}>
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <CSVImportDialog
        bankAccountId={bankAccountId}
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => { setShowImport(false); refetchAll(); }}
      />

      {matchDialogLineId && (
        <MatchPickerDialog
          bankAccountId={bankAccountId}
          statementLineId={matchDialogLineId}
          open={!!matchDialogLineId}
          onClose={() => setMatchDialogLineId(null)}
          onMatched={() => { setMatchDialogLineId(null); refetchAll(); }}
        />
      )}

      {createJournalLineId && (
        <CreateJournalDialog
          bankAccountId={bankAccountId}
          statementLineId={createJournalLineId}
          statementAmount={createJournalAmount}
          open={!!createJournalLineId}
          onClose={() => setCreateJournalLineId(null)}
          onCreated={() => { setCreateJournalLineId(null); refetchAll(); }}
        />
      )}
    </div>
  );
}
