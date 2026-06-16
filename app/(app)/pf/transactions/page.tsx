"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, CreditCard, TrendingDown, TrendingUp, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImportDialog } from "./_components/import-dialog";
import { TransactionCard } from "./_components/transaction-card";
import { CATEGORY_DEFINITIONS } from "@/server/services/statement-categorization.service";
import { MonthPicker, currentMonth } from "@/app/(app)/pf/_components/month-picker";
import { formatCurrency } from "@/lib/utils";

type PendingBatch = { batchId: string; items: { date: string | Date; description: string; amount: number }[] };

function BatchAutoOpen({ onBatchReady }: { onBatchReady: (b: PendingBatch) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const batchParam = searchParams.get("batch");
  const { data } = trpc.statementTransactions.pendingBatch.useQuery(
    { batchId: batchParam! },
    { enabled: !!batchParam, staleTime: Infinity }
  );
  useEffect(() => {
    if (data) {
      onBatchReady(data);
      router.replace(window.location.pathname);
    }
  }, [data, onBatchReady, router]);
  return null;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining":     "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Transport":         "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "Shopping":          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Entertainment":     "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  "Health & Fitness":  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Utilities":         "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Travel":            "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Housing":           "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Education":         "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Personal Care":     "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  "Business Services": "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  "Financial":         "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Income":            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "Transfer":          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Other":             "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
};

export default function PfTransactionsPage() {
  const utils = trpc.useUtils();
  const [importOpen, setImportOpen] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<PendingBatch | null>(null);
  const [month, setMonth]           = useState<string | undefined>(() => currentMonth());
  const [category, setCategory]     = useState<string>("__all__");
  const [type, setType]             = useState<string>("__all__");
  const [search, setSearch]         = useState("");
  const [cursor, setCursor]         = useState<string | undefined>(undefined);

  const { data: org } = trpc.org.get.useQuery();
  const currency = org?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);

  const { data: summary } = trpc.statementTransactions.summary.useQuery({ month });

  const { data, isLoading } = trpc.statementTransactions.list.useQuery({
    month,
    category: category === "__all__" ? undefined : category,
    type:     type     === "__all__" ? undefined : (type as "DEBIT" | "CREDIT"),
    search:   search || undefined,
    cursor,
    limit: 50,
  });

  const updateCategory = trpc.statementTransactions.updateCategory.useMutation({
    onSuccess: () => {
      utils.statementTransactions.list.invalidate();
      utils.statementTransactions.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteTransaction = trpc.statementTransactions.deleteTransaction.useMutation({
    onSuccess: () => {
      utils.statementTransactions.list.invalidate();
      utils.statementTransactions.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const categories = CATEGORY_DEFINITIONS.map((c) => c.name);

  function handleMonthChange(m: string | undefined) {
    setMonth(m);
    setCursor(undefined);
    setSearch("");
    setCategory("__all__");
    setType("__all__");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Suspense fallback={null}>
        <BatchAutoOpen onBatchReady={(b) => { setPendingBatch(b); setImportOpen(true); }} />
      </Suspense>
      <PageHeader
        title="Transactions"
        description="Import bank and credit card statements, then track and categorize your spending."
        action={
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <CreditCard className="h-4 w-4 mr-2" />
            Import Statement
          </Button>
        }
      />

      {/* Month picker */}
      <div className="flex items-center justify-between">
        <MonthPicker month={month} onChange={handleMonthChange} />
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Debits",  value: summary ? fmt(summary.totalDebits)  : "—", icon: TrendingDown, color: "text-red-500" },
          { label: "Total Credits", value: summary ? fmt(summary.totalCredits) : "—", icon: TrendingUp,   color: "text-emerald-500" },
          {
            label: "Net",
            value: summary ? fmt(summary.totalCredits - summary.totalDebits) : "—",
            icon:  RefreshCw,
            color: "text-foreground",
          },
          { label: "Count", value: summary?.totalCount?.toLocaleString() ?? "—", icon: CreditCard, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input
          placeholder="Search merchants..."
          className="h-8 w-full sm:w-48 text-sm"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setCursor(undefined); }}
        />
        <Select value={category} onValueChange={(v) => { setCategory(v); setCursor(undefined); }}>
          <SelectTrigger className="h-8 w-full sm:w-44 text-sm">
            <SelectValue placeholder="Category: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => { setType(v); setCursor(undefined); }}>
          <SelectTrigger className="h-8 w-full sm:w-36 text-sm">
            <SelectValue placeholder="Type: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All types</SelectItem>
            <SelectItem value="DEBIT">Debits</SelectItem>
            <SelectItem value="CREDIT">Credits</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.items.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <CreditCard className="h-10 w-10 text-muted-foreground/40 mb-3" />
          {month ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">No transactions in this month</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Your data may be in a different year — use &laquo; to jump back</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => setMonth(undefined)}>
                View all transactions
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-muted-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Import a bank statement to get started</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => setImportOpen(true)}>
                Import Statement
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
        {/* Desktop table */}
        <div className="hidden md:block rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Merchant</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((txn) => (
                <tr key={txn.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{txn.merchantName}</div>
                    <div className="text-xs text-muted-foreground/60 truncate max-w-xs">{txn.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={txn.category}
                      onValueChange={(newCat) => updateCategory.mutate({ id: txn.id, category: newCat })}
                    >
                      <SelectTrigger className={`h-6 px-2 text-xs border-0 rounded-full w-auto ${CATEGORY_COLORS[txn.category] ?? CATEGORY_COLORS["Other"]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${txn.type === "DEBIT" ? "text-red-500" : "text-emerald-500"}`}>
                    {txn.type === "DEBIT" ? "−" : "+"}{fmt(Number(txn.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        if (confirm("Delete this transaction? This cannot be undone.")) {
                          deleteTransaction.mutate({ id: txn.id });
                        }
                      }}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Delete transaction"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.nextCursor && (
            <div className="flex justify-center py-3 border-t">
              <Button variant="ghost" size="sm" onClick={() => setCursor(data.nextCursor)}>
                Load more
              </Button>
            </div>
          )}
        </div>

        {/* Mobile card list */}
        <div className="md:hidden flex flex-col divide-y rounded-lg border overflow-hidden bg-card">
          {data.items.map((txn) => (
            <TransactionCard
              key={txn.id}
              txn={{ ...txn, amount: Number(txn.amount) }}
              onCategoryChange={(id, cat) => updateCategory.mutate({ id, category: cat })}
              onDelete={(id) => deleteTransaction.mutate({ id })}
              fmt={fmt}
            />
          ))}
          {data.nextCursor && (
            <div className="flex justify-center py-3">
              <Button variant="ghost" size="sm" onClick={() => setCursor(data.nextCursor)}>
                Load more
              </Button>
            </div>
          )}
        </div>
        </>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={(open) => { setImportOpen(open); if (!open) setPendingBatch(null); }}
        emailImportToken={org?.emailImportToken}
        pendingBatch={pendingBatch}
        onComplete={() => {
          setPendingBatch(null);
          setMonth(undefined); // show All time so imported transactions are visible
          setCursor(undefined);
          utils.statementTransactions.list.invalidate();
          utils.statementTransactions.summary.invalidate();
        }}
      />
    </div>
  );
}
