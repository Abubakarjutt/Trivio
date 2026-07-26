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

function startOfYearISO() {
  return `${new Date().getFullYear()}-01-01`;
}

// Accounts that are debit-normal: positive balance = debit balance is expected
const DEBIT_NORMAL_TYPES = new Set(["ASSET", "EXPENSE"]);

export default function TrialBalancePage() {
  const [from, setFrom] = useState(startOfYearISO);
  const [to, setTo] = useState(todayISO);

  const { data, isLoading, refetch } = trpc.reports.trialBalance.useQuery(
    { from, to },
    { enabled: !!from && !!to }
  );
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: string) => formatCurrency(parseFloat(n), currency);

  const totalDebits = parseFloat(data?.totalDebits ?? "0");
  const totalCredits = parseFloat(data?.totalCredits ?? "0");
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  function isUnexpectedBalance(type: string, balance: string): boolean {
    const bal = parseFloat(balance);
    const debitNormal = DEBIT_NORMAL_TYPES.has(type);
    // Unexpected: debit-normal account has negative balance (credit balance), or credit-normal has positive (debit balance)
    return debitNormal ? bal < -0.005 : bal > 0.005;
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm bg-background/95 px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Trial Balance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">All account debit and credit totals for a period</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 text-sm" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 text-sm" />
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
            {!isBalanced && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Trial balance is out of balance — total debits ({fmt(data.totalDebits)}) do not equal total credits ({fmt(data.totalCredits)}).</span>
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Debits</p>
                  <p className="text-2xl font-mono font-semibold mt-1">{fmt(data.totalDebits)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border border-border/40 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.08em]">Total Credits</p>
                  <p className="text-2xl font-mono font-semibold mt-1">{fmt(data.totalCredits)}</p>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl border border-border/40 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Account Balances</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] w-20">Code</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Account</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] w-24">Type</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-32">Debit</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-32">Credit</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-32">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No accounts with activity in this period</TableCell>
                      </TableRow>
                    ) : (
                      data.accounts.map((acct) => {
                        const unexpected = isUnexpectedBalance(acct.type, acct.balance);
                        return (
                          <TableRow key={acct.code} className={unexpected ? "bg-amber-50/50" : ""}>
                            <TableCell className="font-mono text-sm text-muted-foreground">{acct.code}</TableCell>
                            <TableCell className="text-sm">
                              {acct.name}
                              {unexpected && (
                                <span title="Unexpected balance direction">
                                  <AlertTriangle className="inline h-3 w-3 ml-1.5 text-amber-500" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground capitalize">{acct.type.charAt(0) + acct.type.slice(1).toLowerCase()}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-sm">
                              {parseFloat(acct.totalDebit) > 0 ? fmt(acct.totalDebit) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-sm">
                              {parseFloat(acct.totalCredit) > 0 ? fmt(acct.totalCredit) : "—"}
                            </TableCell>
                            <TableCell className={`text-right font-mono tabular-nums text-sm font-medium ${unexpected ? "text-amber-700" : ""}`}>
                              {fmt(acct.balance)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                    {/* Totals row */}
                    <TableRow className="bg-muted/30 font-semibold border-t-2">
                      <TableCell />
                      <TableCell className="text-sm">Totals</TableCell>
                      <TableCell />
                      <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(data.totalDebits)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm">{fmt(data.totalCredits)}</TableCell>
                      <TableCell className={`text-right font-mono tabular-nums text-sm ${isBalanced ? "text-emerald-600" : "text-red-600"}`}>
                        {isBalanced ? "Balanced" : "Out of balance"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
