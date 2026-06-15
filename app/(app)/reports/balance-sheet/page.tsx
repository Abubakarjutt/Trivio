"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

interface AccountBalance {
  code: string;
  name: string;
  total: string;
}

function SectionTable({ title, accounts, subtotal, currency }: {
  title: string;
  accounts: AccountBalance[];
  subtotal: string;
  currency: string;
}) {
  const fmt = (n: string) => formatCurrency(parseFloat(n), currency);
  return (
    <Card className="rounded-2xl border border-border/40 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] w-24">Code</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Account</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-36">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">No accounts with activity</TableCell>
              </TableRow>
            ) : (
              accounts.map((acct) => (
                <TableRow key={acct.code}>
                  <TableCell className="font-mono text-sm text-muted-foreground">{acct.code}</TableCell>
                  <TableCell className="text-sm">{acct.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(acct.total)}</TableCell>
                </TableRow>
              ))
            )}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell />
              <TableCell className="text-sm">Total {title}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(subtotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(todayISO);

  const { data, isLoading, refetch } = trpc.reports.balanceSheet.useQuery(
    { asOf },
    { enabled: !!asOf }
  );
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: string) => formatCurrency(parseFloat(n), currency);

  const totalAssets = parseFloat(data?.totalAssets ?? "0");
  const totalLiabilitiesAndEquity = parseFloat(data?.totalLiabilities ?? "0") + parseFloat(data?.totalEquity ?? "0");
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm px-8 py-4" style={{ background: "rgba(244,243,239,0.95)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Balance Sheet</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Financial position as of a date</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">As of</span>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-36 text-sm" />
            <Button size="sm" variant="outline" onClick={() => refetch()}>Apply</Button>
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
            {/* Balance check warning */}
            {!isBalanced && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Balance sheet is not balanced — Assets ({fmt(data.totalAssets)}) do not equal Liabilities + Equity ({fmt((parseFloat(data.totalLiabilities) + parseFloat(data.totalEquity)).toFixed(4))}).</span>
              </div>
            )}

            {/* Summary KPI cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Assets</p>
                  <p className="text-2xl font-mono font-semibold text-blue-600 mt-1">{fmt(data.totalAssets)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Liabilities</p>
                  <p className="text-2xl font-mono font-semibold text-red-600 mt-1">{fmt(data.totalLiabilities)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Equity</p>
                  <p className="text-2xl font-mono font-semibold text-violet-600 mt-1">{fmt(data.totalEquity)}</p>
                </CardContent>
              </Card>
            </div>

            <SectionTable title="Assets" accounts={data.assets} subtotal={data.totalAssets} currency={currency} />
            <SectionTable title="Liabilities" accounts={data.liabilities} subtotal={data.totalLiabilities} currency={currency} />
            <SectionTable title="Equity" accounts={data.equity} subtotal={data.totalEquity} currency={currency} />

            {/* Grand total */}
            <Card className="rounded-2xl border border-border/40 shadow-sm">
              <CardContent className="py-4 flex items-center justify-between">
                <span className="font-semibold text-base">Liabilities + Equity</span>
                <span className={`font-mono text-xl font-bold tabular-nums ${isBalanced ? "text-blue-600" : "text-red-600"}`}>
                  {fmt((parseFloat(data.totalLiabilities) + parseFloat(data.totalEquity)).toFixed(4))}
                </span>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
