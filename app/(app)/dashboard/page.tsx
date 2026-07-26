"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { MonthPicker, currentMonth, fmtMonth } from "@/app/(app)/_components/month-picker";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Landmark, FileText, Receipt,
  ArrowUpDown, Users, BarChart3, Plus, ArrowRight, Clock,
} from "lucide-react";

import { formatCurrency } from "@/lib/utils";

/* Forest-spine palette — stays cohesive with the sidebar */
const PIE_COLORS = ["#1A6644", "#C9A86A", "#93C4AE", "#C05151", "#2E8B57", "#D4A854"];

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  INVOICE: "Invoice",
  BILL: "Bill",
  BANK_IMPORT: "Bank Import",
  AI_EXTRACTION: "AI Extract",
};

type KpiCardProps = {
  label: string;
  value: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  accentColor: string;
  sub?: string;
  href?: string;
  delay?: number;
};

function KpiCard({ label, value, icon: Icon, iconBg, iconColor, accentColor, sub, href, delay = 0 }: KpiCardProps) {
  const inner = (
    <div
      className="rise group relative rounded-2xl bg-card p-5 overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)",
        animationDelay: `${delay}ms`,
        transition: "box-shadow 0.18s ease, transform 0.18s cubic-bezier(0.22,1,0.36,1)",
        ...(href ? { cursor: "pointer" } : {}),
      }}
      onMouseEnter={href ? (e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(15,17,23,0.05),0 2px 6px rgba(15,17,23,0.06),0 12px 32px -8px rgba(15,17,23,0.14)"; } : undefined}
      onMouseLeave={href ? (e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)"; } : undefined}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accentColor, opacity: 0.7 }} />

      <div className="flex items-start justify-between mb-4">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: iconBg }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} strokeWidth={1.75} />
        </div>
        {sub && (
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
            style={{ background: iconBg, color: iconColor }}
          >
            {sub}
          </span>
        )}
      </div>

      <p
        className="num font-serif leading-none tracking-tight text-foreground"
        style={{ fontSize: "1.875rem", fontWeight: 500 }}
        title={value}
      >
        {value}
      </p>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] mt-2 text-muted-foreground/70">{label}</p>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded-xl ${className}`} />;
}

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  boxShadow: "0 4px 16px rgba(15,17,23,0.08)",
  color: "hsl(var(--card-foreground))",
};

export default function DashboardPage() {
  const [month, setMonth] = useState<string | undefined>(() => currentMonth());

  const org = trpc.org.get.useQuery();
  const kpis = trpc.dashboard.getKPIs.useQuery({ month });
  const trend = trpc.dashboard.getIncomeExpenseTrend.useQuery();
  const breakdown = trpc.dashboard.getExpenseBreakdown.useQuery({ month });
  const recent = trpc.dashboard.getRecentTransactions.useQuery();
  const outstanding = trpc.dashboard.getOutstandingInvoices.useQuery();

  const currency = org.data?.currency ?? "USD";
  const fmt = (v: string | number | undefined) => formatCurrency(Number(v ?? 0), currency);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const periodLabel = month ? fmtMonth(month) : "All time";

  return (
    <div className="min-h-full">

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/40 px-8 py-4 flex items-center justify-between backdrop-blur-sm bg-background/95">
        <div>
          <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5" style={{ color: "rgba(201,168,106,0.8)" }}>{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthPicker month={month} onChange={setMonth} />
          <Link
            href="/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95"
            style={{ background: "#1A6644" }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Invoice
          </Link>
        </div>
      </div>

      <div className="p-8 space-y-7 max-w-7xl">

        {/* KPI Grid — two rows of 3 */}
        <div className="space-y-3">
          {/* Row 1: P&L */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kpis.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[120px]" />)
            ) : (
              <>
                <KpiCard label="Income"    value={fmt(kpis.data?.monthlyIncome)}   icon={TrendingUp}   iconBg="rgba(26,102,68,0.08)"  iconColor="#1A6644" accentColor="#1A6644" sub={periodLabel} delay={0}  />
                <KpiCard label="Expenses"  value={fmt(kpis.data?.monthlyExpenses)} icon={TrendingDown} iconBg="rgba(192,81,81,0.08)"   iconColor="#C05151" accentColor="#C05151" sub={periodLabel} delay={55} />
                <KpiCard
                  label="Net Profit"
                  value={fmt(kpis.data?.netProfit)}
                  icon={DollarSign}
                  iconBg={Number(kpis.data?.netProfit ?? 0) >= 0 ? "rgba(26,102,68,0.08)" : "rgba(192,81,81,0.08)"}
                  iconColor={Number(kpis.data?.netProfit ?? 0) >= 0 ? "#1A6644" : "#C05151"}
                  accentColor={Number(kpis.data?.netProfit ?? 0) >= 0 ? "#1A6644" : "#C05151"}
                  sub={periodLabel}
                  delay={110}
                />
              </>
            )}
          </div>
          {/* Row 2: Balance sheet */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kpis.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[120px]" />)
            ) : (
              <>
                <KpiCard label="Receivables" value={fmt(kpis.data?.outstandingAR)} icon={FileText} iconBg="rgba(201,168,106,0.10)" iconColor="#B8860B" accentColor="#C9A86A" sub="Outstanding" href="/invoices" delay={165} />
                <KpiCard label="Payables"    value={fmt(kpis.data?.outstandingAP)} icon={Receipt}  iconBg="rgba(201,168,106,0.10)" iconColor="#B8860B" accentColor="#C9A86A" sub="Outstanding" href="/bills"    delay={220} />
                <KpiCard label="Cash"        value={fmt(kpis.data?.cashPosition)}  icon={Landmark} iconBg="rgba(147,196,174,0.15)" iconColor="#2E7D52" accentColor="#93C4AE" sub="Position"                      delay={275} />
              </>
            )}
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Income vs Expense Bar Chart */}
          <div
            className="lg:col-span-2 rounded-2xl bg-card p-6"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-serif text-base font-medium text-foreground">Income vs Expenses</h2>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">12-month comparison</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#1A6644" }} />
                  <span className="text-[11px] text-muted-foreground">Income</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#C05151" }} />
                  <span className="text-[11px] text-muted-foreground">Expenses</span>
                </div>
              </div>
            </div>
            {trend.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={trend.data} barGap={2} barCategoryGap="25%">
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} width={72} />
                  <Tooltip
                    formatter={(v: number | string, name: string) => [fmt(String(v)), name === "income" ? "Income" : "Expenses"]}
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(228,225,216,0.4)" }}
                  />
                  <Bar dataKey="income"   name="income"   fill="#1A6644" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="expenses" fill="#C05151" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Expense Breakdown Donut */}
          <div
            className="rounded-2xl bg-card p-6"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="mb-5">
              <h2 className="font-serif text-base font-medium text-foreground">Expense Breakdown</h2>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">{periodLabel}</p>
            </div>
            {breakdown.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : !breakdown.data?.length ? (
              <div className="flex flex-col items-center justify-center h-52 text-center">
                <BarChart3 className="h-8 w-8 mb-2" style={{ color: "rgba(147,196,174,0.4)" }} />
                <p className="text-sm text-muted-foreground">No expenses for {periodLabel.toLowerCase()}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={breakdown.data} dataKey="total" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
                    {breakdown.data.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | string) => [fmt(String(v)), "Total"]} contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 11, color: "#6B7180" }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Recent Transactions */}
          <div
            className="rounded-2xl bg-card overflow-hidden"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(147,196,174,0.12)" }}>
                  <ArrowUpDown className="h-3.5 w-3.5" style={{ color: "#93C4AE" }} strokeWidth={1.75} />
                </div>
                <h2 className="font-serif text-base font-medium text-foreground">Recent Transactions</h2>
              </div>
              <Link href="/transactions" className="flex items-center gap-1 text-xs font-medium transition-colors" style={{ color: "#1A6644" }}>
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recent.isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : !recent.data?.length ? (
              <div className="flex flex-col items-center py-12 text-center">
                <ArrowUpDown className="h-8 w-8 mb-2" style={{ color: "rgba(147,196,174,0.35)" }} />
                <p className="text-sm text-muted-foreground">No transactions yet</p>
              </div>
            ) : (
              <div>
                {recent.data.map((tx) => (
                  <div key={tx.id} className="tr-hover flex items-center justify-between px-6 py-3 border-b border-border/30 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" · "}
                        <span>{SOURCE_LABELS[tx.source] ?? tx.source}</span>
                      </p>
                    </div>
                    <span className="num text-sm font-medium text-foreground ml-4 shrink-0">{fmt(tx.totalDebit)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outstanding Invoices */}
          <div
            className="rounded-2xl bg-card overflow-hidden"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(201,168,106,0.12)" }}>
                  <Clock className="h-3.5 w-3.5" style={{ color: "#C9A86A" }} strokeWidth={1.75} />
                </div>
                <h2 className="font-serif text-base font-medium text-foreground">Outstanding Invoices</h2>
              </div>
              <Link href="/invoices" className="flex items-center gap-1 text-xs font-medium transition-colors" style={{ color: "#1A6644" }}>
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {outstanding.isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : !outstanding.data?.length ? (
              <div className="flex flex-col items-center py-12 text-center">
                <FileText className="h-8 w-8 mb-2" style={{ color: "rgba(201,168,106,0.35)" }} />
                <p className="text-sm text-muted-foreground">No outstanding invoices</p>
                <Link href="/invoices/new" className="mt-3 flex items-center gap-1 text-xs font-medium" style={{ color: "#1A6644" }}>
                  <Plus className="h-3 w-3" /> Create invoice
                </Link>
              </div>
            ) : (
              <div>
                {outstanding.data.map((inv) => {
                  const daysOverdue = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86_400_000);
                  const overdue = daysOverdue > 0;
                  return (
                    <Link
                      key={inv.id}
                      href={`/invoices/${inv.id}`}
                      className="tr-hover flex items-center justify-between px-6 py-3 border-b border-border/30 last:border-0 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-foreground">{inv.number}</span>
                          {overdue && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(192,81,81,0.08)", color: "#C05151", border: "1px solid rgba(192,81,81,0.15)" }}>
                              {daysOverdue}d overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{inv.contactName}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <span className="num text-sm font-medium text-foreground">{fmt(inv.amountDue)}</span>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" style={{ color: "#6B7180" }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div
          className="rounded-2xl bg-card overflow-hidden"
          style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
        >
          <div className="px-6 py-3.5 border-b border-border/60 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: "#C9A86A" }} />
            <h2 className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "rgba(201,168,106,0.8)" }}>Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: "rgba(228,225,216,0.5)" }}>
            {[
              { label: "New Invoice",      href: "/invoices/new",      icon: FileText,   iconBg: "rgba(26,102,68,0.08)",   iconColor: "#1A6644"  },
              { label: "New Bill",         href: "/bills/new",         icon: Receipt,    iconBg: "rgba(201,168,106,0.10)", iconColor: "#B8860B"  },
              { label: "New Transaction",  href: "/transactions/new",  icon: ArrowUpDown,iconBg: "rgba(147,196,174,0.15)", iconColor: "#2E7D52"  },
              { label: "Add Contact",      href: "/contacts",          icon: Users,      iconBg: "rgba(26,102,68,0.08)",   iconColor: "#1A6644"  },
              { label: "View Reports",     href: "/reports",           icon: BarChart3,  iconBg: "rgba(192,81,81,0.08)",   iconColor: "#C05151"  },
            ].map((action, idx) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex flex-col items-center gap-3 py-7 transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={{ borderRight: idx < 4 ? "1px solid rgba(228,225,216,0.5)" : undefined }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-110"
                  style={{ background: action.iconBg }}
                >
                  <action.icon className="h-[18px] w-[18px]" style={{ color: action.iconColor }} strokeWidth={1.75} />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground/80 group-hover:text-foreground transition-colors">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
