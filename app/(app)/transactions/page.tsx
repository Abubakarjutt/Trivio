"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, MoreHorizontal, XCircle, Upload, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CSVImportDialog } from "./_components/csv-import-dialog";
import { MonthPicker, currentMonth } from "@/app/(app)/_components/month-picker";

function VoidDialog({ entryId, description, onVoided }: { entryId: string; description: string; onVoided: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Entered in error");

  const voidMutation = trpc.transactions.void.useMutation({
    onSuccess: () => { toast({ title: "Transaction voided" }); setOpen(false); onVoided(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <>
      <DropdownMenuItem className="text-destructive" onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
        <XCircle className="mr-2 h-3.5 w-3.5" /> Void
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void transaction?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will create a reversal entry for &quot;{description}&quot;. The original entry is preserved.</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={voidMutation.isPending} onClick={() => voidMutation.mutate({ id: entryId, reason })}>
              {voidMutation.isPending && <Loader2 className="animate-spin" />} Void transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TransactionsPage() {
  const { data: org } = trpc.org.get.useQuery();
  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [month, setMonth] = useState<string | undefined>(() => currentMonth());

  const dateFrom = month ? new Date(Number(month.split("-")[0]), Number(month.split("-")[1]) - 1, 1) : undefined;
  const dateTo = month ? new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0, 23, 59, 59, 999) : undefined;

  const { data, refetch, isFetching } = trpc.transactions.list.useQuery({
    page,
    search: search || undefined,
    accountId: accountId || undefined,
    showVoided,
    dateFrom,
    dateTo,
  });

  const currency = org?.currency ?? "USD";

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm bg-background/95 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Transactions</h1>
            <p className="text-xs text-muted-foreground mt-0.5">All journal entries</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button size="sm" asChild>
              <Link href="/transactions/new"><Plus className="h-4 w-4" /> New Transaction</Link>
            </Button>
          </div>
        </div>
      </div>
      <div className="p-8 space-y-5">

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} onChange={(m) => { setMonth(m); setPage(1); }} />
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={accountId} onValueChange={(v) => { setAccountId(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={showVoided ? "secondary" : "outline"} size="sm" onClick={() => setShowVoided((v) => !v)}>
          {showVoided ? "Hide voided" : "Show voided"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden md:table-cell">Reference</TableHead>
                <TableHead className="hidden lg:table-cell">Accounts</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && !data && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {data?.entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    No transactions found.{" "}
                    <Link href="/transactions/new" className="text-primary hover:underline">Record one</Link>
                  </TableCell>
                </TableRow>
              )}
              {data?.entries.map((entry) => {
                const totalDebits = entry.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
                const totalCredits = entry.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
                const accountNames = [...new Set(entry.lines.map((l) => l.account.name))].join(", ");

                return (
                  <TableRow key={entry.id} className={entry.isVoid ? "opacity-50 line-through" : ""}>
                    <TableCell className="text-sm">{formatDate(entry.date)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{entry.description}</span>
                        {entry.isVoid && <Badge variant="destructive" className="text-xs py-0">Voided</Badge>}
                        {entry.source !== "MANUAL" && (
                          <Badge variant="secondary" className="text-xs py-0 capitalize">{entry.source.toLowerCase().replace("_", " ")}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{entry.reference ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground truncate max-w-xs">{accountNames}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {totalDebits > 0 ? formatCurrency(totalDebits, currency) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {totalCredits > 0 ? formatCurrency(totalCredits, currency) : "—"}
                    </TableCell>
                    <TableCell>
                      {!entry.isVoid && entry.source === "MANUAL" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <VoidDialog entryId={entry.id} description={entry.description} onVoided={() => refetch()} />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.total} transactions</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>Page {page} of {data.pages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <CSVImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); refetch(); }} accounts={accounts} currency={currency} />
      </div>
    </div>
  );
}
