"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { AccountType } from "@prisma/client";

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function startOfYearISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProfitLossPage() {
  const [from, setFrom] = useState(startOfYearISO);
  const [to, setTo] = useState(todayISO);

  const { data, isLoading, refetch } = trpc.reports.profitAndLoss.useQuery(
    { from, to },
    { enabled: !!from && !!to }
  );
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: string | number) => formatCurrency(typeof n === "string" ? parseFloat(n) : n, currency);

  const incomeAccounts = data?.accounts.filter((a) => a.type === ("INCOME" as AccountType)) ?? [];
  const expenseAccounts = data?.accounts.filter((a) => a.type === ("EXPENSE" as AccountType)) ?? [];
  const netProfit = parseFloat(data?.netProfit ?? "0");

  function handleExport() {
    if (!data) return;
    const rows: string[][] = [
      ["Profit & Loss", `${from} to ${to}`],
      [],
      ["INCOME"],
      ["Code", "Account", "Amount"],
      ...incomeAccounts.map((a) => [a.code, a.name, parseFloat(a.total).toFixed(2)]),
      ["", "Total Income", parseFloat(data.totalIncome).toFixed(2)],
      [],
      ["EXPENSES"],
      ["Code", "Account", "Amount"],
      ...expenseAccounts.map((a) => [a.code, a.name, parseFloat(a.total).toFixed(2)]),
      ["", "Total Expenses", parseFloat(data.totalExpenses).toFixed(2)],
      [],
      ["Net Profit", "", parseFloat(data.netProfit).toFixed(2)],
    ];
    downloadCSV(rows, `profit-loss-${from}-${to}.csv`);
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur px-8 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif text-foreground">Profit &amp; Loss</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Income and expenses for a period</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 text-sm" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 text-sm" />
            <Button size="sm" variant="outline" onClick={() => refetch()}>Apply</Button>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={!data}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-6">
        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && (
          <>
            {/* Summary KPI cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Income</p>
                  <p className="text-2xl font-mono font-semibold text-emerald-600 mt-1">{fmt(data.totalIncome)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Expenses</p>
                  <p className="text-2xl font-mono font-semibold text-red-600 mt-1">{fmt(data.totalExpenses)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Net Profit</p>
                  <p className={`text-2xl font-mono font-semibold mt-1 ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(data.netProfit)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Income section */}
            <Card className="rounded-2xl border border-border/40 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Income</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] w-24">Code</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Account</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-36">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incomeAccounts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No income accounts with activity</TableCell>
                      </TableRow>
                    ) : (
                      incomeAccounts.map((acct) => (
                        <TableRow key={acct.code}>
                          <TableCell className="font-mono text-sm text-muted-foreground">{acct.code}</TableCell>
                          <TableCell className="text-sm">{acct.name}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(acct.total)}</TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell />
                      <TableCell className="text-sm">Total Income</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm text-emerald-600">{fmt(data.totalIncome)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Expenses section */}
            <Card className="rounded-2xl border border-border/40 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Expenses</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] w-24">Code</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Account</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-36">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenseAccounts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No expense accounts with activity</TableCell>
                      </TableRow>
                    ) : (
                      expenseAccounts.map((acct) => (
                        <TableRow key={acct.code}>
                          <TableCell className="font-mono text-sm text-muted-foreground">{acct.code}</TableCell>
                          <TableCell className="text-sm">{acct.name}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(acct.total)}</TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell />
                      <TableCell className="text-sm">Total Expenses</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm text-red-600">{fmt(data.totalExpenses)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Net Profit row */}
            <Card className={`rounded-2xl border shadow-sm ${netProfit >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}>
              <CardContent className="py-4 flex items-center justify-between">
                <span className="font-semibold text-base">Net Profit / (Loss)</span>
                <span className={`font-mono text-2xl font-bold tabular-nums ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmt(data.netProfit)}
                </span>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
