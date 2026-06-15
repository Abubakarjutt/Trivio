"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function startOfYearISO() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function TaxSummaryPage() {
  const [from, setFrom] = useState(startOfYearISO);
  const [to, setTo] = useState(todayISO);

  const { data, isLoading, refetch } = trpc.reports.taxSummary.useQuery(
    { from, to },
    { enabled: !!from && !!to }
  );
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: string | number) => formatCurrency(typeof n === "string" ? parseFloat(n) : n, currency);

  const netTaxPayable = parseFloat(data?.netTaxPayable ?? "0");

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm px-8 py-4" style={{ background: "rgba(244,243,239,0.95)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Tax Summary</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Output and input tax for a period</p>
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
            {/* Summary boxes */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="rounded-2xl border border-emerald-200 bg-emerald-50/50 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-emerald-700">Output Tax Collected</p>
                  <p className="text-2xl font-mono font-semibold text-emerald-700 mt-1">{fmt(data.outputTax)}</p>
                  <p className="text-xs text-emerald-600 mt-1">{data.invoiceCount} invoice{data.invoiceCount !== 1 ? "s" : ""}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-red-200 bg-red-50/50 shadow-sm">
                <CardContent className="pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-red-700">Input Tax Paid</p>
                  <p className="text-2xl font-mono font-semibold text-red-700 mt-1">{fmt(data.inputTax)}</p>
                  <p className="text-xs text-red-600 mt-1">{data.billCount} bill{data.billCount !== 1 ? "s" : ""}</p>
                </CardContent>
              </Card>

              <Card className={`rounded-2xl shadow-sm ${netTaxPayable >= 0 ? "border-amber-200 bg-amber-50/50" : "border-blue-200 bg-blue-50/50"}`}>
                <CardContent className="pt-4">
                  <p className={`text-xs font-medium uppercase tracking-[0.08em] ${netTaxPayable >= 0 ? "text-amber-700" : "text-blue-700"}`}>
                    {netTaxPayable >= 0 ? "Net Tax Payable" : "Net Tax Refund"}
                  </p>
                  <p className={`text-2xl font-mono font-semibold mt-1 ${netTaxPayable >= 0 ? "text-amber-700" : "text-blue-700"}`}>
                    {fmt(Math.abs(netTaxPayable))}
                  </p>
                  <p className={`text-xs mt-1 ${netTaxPayable >= 0 ? "text-amber-600" : "text-blue-600"}`}>
                    {netTaxPayable >= 0 ? "Output − Input" : "Input − Output (credit)"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Detail table */}
            <div className="rounded-2xl border border-border/40 shadow-sm overflow-hidden bg-card">
              <div className="px-6 py-4 border-b border-border/40">
                <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Breakdown</h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em]">Item</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-32">Count</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-[0.08em] text-right w-40">Tax Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm">Output Tax (from Invoices)</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">{data.invoiceCount}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm text-emerald-600">{fmt(data.outputTax)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">Input Tax (from Bills)</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">{data.billCount}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm text-red-600">{fmt(data.inputTax)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell className="text-sm">Net Tax Payable / (Refund)</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">{data.invoiceCount + data.billCount}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums text-sm ${netTaxPayable >= 0 ? "text-amber-700" : "text-blue-700"}`}>
                      {fmt(data.netTaxPayable)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
