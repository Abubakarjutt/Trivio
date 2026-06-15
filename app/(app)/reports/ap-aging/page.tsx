"use client";

import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function APAgingPage() {
  const { data, isLoading } = trpc.bills.apAging.useQuery();
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm px-8 py-4" style={{ background: "rgba(244,243,239,0.95)" }}>
        <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">AP Aging</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Outstanding supplier balances grouped by days past due</p>
      </div>
      <div className="p-8 space-y-6">

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Current", value: data.totals.current, color: "text-green-700" },
              { label: "1–30 days", value: data.totals.days30, color: "text-yellow-600" },
              { label: "31–60 days", value: data.totals.days60, color: "text-orange-600" },
              { label: "61–90 days", value: data.totals.days90, color: "text-red-600" },
              { label: "90+ days", value: data.totals.over90, color: "text-red-800 font-bold" },
            ].map((b) => (
              <Card key={b.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{b.label}</p>
                  <p className={`text-lg font-semibold mt-0.5 ${b.color}`}>{fmt(b.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">By Supplier</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {data.billCount} outstanding bill{data.billCount !== 1 ? "s" : ""}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">1–30 days</TableHead>
                    <TableHead className="text-right">31–60 days</TableHead>
                    <TableHead className="text-right">61–90 days</TableHead>
                    <TableHead className="text-right">90+ days</TableHead>
                    <TableHead className="text-right font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        No outstanding balances
                      </TableCell>
                    </TableRow>
                  )}
                  {data.rows.map((row) => (
                    <TableRow key={row.contactName}>
                      <TableCell className="font-medium">{row.contactName}</TableCell>
                      <TableCell className="text-right text-sm">{row.current > 0 ? fmt(row.current) : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{row.days30 > 0 ? fmt(row.days30) : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{row.days60 > 0 ? fmt(row.days60) : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{row.days90 > 0 ? fmt(row.days90) : "—"}</TableCell>
                      <TableCell className="text-right text-sm text-red-700">{row.over90 > 0 ? fmt(row.over90) : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(row.total)}</TableCell>
                    </TableRow>
                  ))}
                  {data.rows.length > 0 && (
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{fmt(data.totals.current)}</TableCell>
                      <TableCell className="text-right">{fmt(data.totals.days30)}</TableCell>
                      <TableCell className="text-right">{fmt(data.totals.days60)}</TableCell>
                      <TableCell className="text-right">{fmt(data.totals.days90)}</TableCell>
                      <TableCell className="text-right text-red-700">{fmt(data.totals.over90)}</TableCell>
                      <TableCell className="text-right">{fmt(data.totals.total)}</TableCell>
                    </TableRow>
                  )}
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
