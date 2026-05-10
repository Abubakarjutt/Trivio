"use client";

import Link from "next/link";
import { BarChart3, Scale, ListOrdered, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const REPORTS = [
  {
    href: "/reports/profit-loss",
    icon: BarChart3,
    title: "Profit & Loss",
    description: "Income minus expenses for a date range. Shows net profit or loss.",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    href: "/reports/balance-sheet",
    icon: Scale,
    title: "Balance Sheet",
    description: "Assets, liabilities and equity as of a specific date.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    href: "/reports/trial-balance",
    icon: ListOrdered,
    title: "Trial Balance",
    description: "All account debit and credit totals for a period.",
    color: "text-violet-600",
    bg: "bg-violet-50",
  },
  {
    href: "/reports/tax-summary",
    icon: Receipt,
    title: "Tax Summary",
    description: "Output tax collected and input tax paid for a period.",
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
];

export default function ReportsPage() {
  return (
    <div className="min-h-full">
      <div className="border-b border-border/60 bg-white/60 backdrop-blur-sm px-8 py-5">
        <h1 className="text-2xl font-serif text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Financial reports and statements</p>
      </div>

      <div className="p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
          {REPORTS.map(({ href, icon: Icon, title, description, color, bg }) => (
            <Link key={href} href={href} className="group">
              <Card className="rounded-2xl border border-border/40 shadow-sm transition-shadow group-hover:shadow-md h-full">
                <CardHeader className="pb-3">
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg} mb-2`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <CardTitle className="text-base font-semibold">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-4">Aging Reports</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
            <Link href="/reports/ar-aging" className="group">
              <Card className="rounded-2xl border border-border/40 shadow-sm transition-shadow group-hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 mb-2">
                    <BarChart3 className="h-5 w-5 text-green-600" />
                  </div>
                  <CardTitle className="text-base font-semibold">AR Aging</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">Outstanding customer balances grouped by days overdue.</p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/reports/ap-aging" className="group">
              <Card className="rounded-2xl border border-border/40 shadow-sm transition-shadow group-hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 mb-2">
                    <BarChart3 className="h-5 w-5 text-red-600" />
                  </div>
                  <CardTitle className="text-base font-semibold">AP Aging</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">Outstanding supplier balances grouped by days overdue.</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
