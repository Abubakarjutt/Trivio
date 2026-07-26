"use client";

import Link from "next/link";
import { BarChart3, Scale, ListOrdered, Receipt } from "lucide-react";

const REPORTS = [
  {
    href: "/reports/profit-loss",
    icon: BarChart3,
    title: "Profit & Loss",
    description: "Income minus expenses for a date range. Shows net profit or loss.",
    iconColor: "#1A6644",
    iconBg: "rgba(26,102,68,0.08)",
  },
  {
    href: "/reports/balance-sheet",
    icon: Scale,
    title: "Balance Sheet",
    description: "Assets, liabilities and equity as of a specific date.",
    iconColor: "#C9A86A",
    iconBg: "rgba(201,168,106,0.10)",
  },
  {
    href: "/reports/trial-balance",
    icon: ListOrdered,
    title: "Trial Balance",
    description: "All account debit and credit totals for a period.",
    iconColor: "#2E7D52",
    iconBg: "rgba(147,196,174,0.15)",
  },
  {
    href: "/reports/tax-summary",
    icon: Receipt,
    title: "Tax Summary",
    description: "Output tax collected and input tax paid for a period.",
    iconColor: "#C05151",
    iconBg: "rgba(192,81,81,0.08)",
  },
];

export default function ReportsPage() {
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm bg-background/95 px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Reports</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Financial reports and statements</p>
      </div>

      <div className="p-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {REPORTS.map(({ href, icon: Icon, title, description, iconColor, iconBg }) => (
            <Link key={href} href={href} className="group">
              <div
                className="rounded-2xl bg-white p-5 h-full flex flex-col gap-3 transition-all hover:translate-y-[-1px]"
                style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: iconBg }}>
                  <Icon className="h-5 w-5" style={{ color: iconColor }} />
                </div>
                <div>
                  <p className="font-serif text-base font-medium text-foreground">{title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-1">{description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] mb-4" style={{ color: "rgba(201,168,106,0.8)" }}>Aging Reports</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { href: "/reports/ar-aging", title: "AR Aging", desc: "Outstanding customer balances grouped by days overdue.", iconColor: "#1A6644", iconBg: "rgba(26,102,68,0.08)" },
              { href: "/reports/ap-aging", title: "AP Aging", desc: "Outstanding supplier balances grouped by days overdue.", iconColor: "#C05151", iconBg: "rgba(192,81,81,0.08)" },
            ].map((r) => (
              <Link key={r.href} href={r.href} className="group">
                <div
                  className="rounded-2xl bg-white p-5 flex flex-col gap-3 transition-all hover:translate-y-[-1px]"
                  style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: r.iconBg }}>
                    <BarChart3 className="h-5 w-5" style={{ color: r.iconColor }} />
                  </div>
                  <div>
                    <p className="font-serif text-base font-medium text-foreground">{r.title}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">{r.desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
