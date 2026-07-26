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
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm bg-background/95 px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Profit &amp; Loss</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Income and expenses for a period</p>
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
              {[
                { label: "Total Income",   value: fmt(data.totalIncome),   color: "#1A6644" },
                { label: "Total Expenses", value: fmt(data.totalExpenses), color: "#C05151" },
                { label: "Net Profit",     value: fmt(data.netProfit),     color: netProfit >= 0 ? "#1A6644" : "#C05151" },
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-2xl bg-white p-5"
                  style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{k.label}</p>
                  <p className="font-serif text-2xl font-medium num mt-2" style={{ color: k.color }}>{k.value}</p>
                </div>
              ))}
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
            <div
              className="rounded-2xl p-5 flex items-center justify-between"
              style={{
                background: netProfit >= 0 ? "rgba(26,102,68,0.05)" : "rgba(192,81,81,0.05)",
                border: `1px solid ${netProfit >= 0 ? "rgba(26,102,68,0.15)" : "rgba(192,81,81,0.15)"}`,
              }}
            >
              <span className="font-serif text-base font-medium text-foreground">Net Profit / (Loss)</span>
              <span className="num text-2xl font-semibold tabular-nums" style={{ color: netProfit >= 0 ? "#1A6644" : "#C05151" }}>
                {fmt(data.netProfit)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
