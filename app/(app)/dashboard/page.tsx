"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
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
  sub?: string;
  href?: string;
  delay?: number;
};

function KpiCard({ label, value, icon: Icon, iconBg, iconColor, sub, href, delay = 0 }: KpiCardProps) {
  const inner = (
    <div
      className="rise group relative rounded-2xl bg-white p-5 cursor-default hover:translate-y-[-1px] transition-transform duration-200"
      style={{
        boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)",
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{label}</span>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: iconBg }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
        </div>
      </div>
      <p className="font-serif text-[1.6rem] font-medium text-foreground leading-none tracking-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-2">{sub}</p>}

      {/* gilt hairline accent on hover */}
      <div
        className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: "linear-gradient(90deg, transparent, #C9A86A, transparent)" }}
      />
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
  border: "1px solid rgba(228,225,216,1)",
  background: "#fff",
  boxShadow: "0 4px 16px rgba(15,17,23,0.08)",
  color: "#0F1117",
};

export default function DashboardPage() {
  const org = trpc.org.get.useQuery();
  const kpis = trpc.dashboard.getKPIs.useQuery();
  const trend = trpc.dashboard.getIncomeExpenseTrend.useQuery();
  const breakdown = trpc.dashboard.getExpenseBreakdown.useQuery();
  const recent = trpc.dashboard.getRecentTransactions.useQuery();
  const outstanding = trpc.dashboard.getOutstandingInvoices.useQuery();

  const currency = org.data?.currency ?? "USD";
  const fmt = (v: string | number | undefined) => formatCurrency(Number(v ?? 0), currency);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-full">

      {/* Header */}
      <div
        className="sticky top-0 z-10 border-b border-border/40 px-8 py-4 flex items-center justify-between backdrop-blur-sm"
        style={{ background: "rgba(244,243,239,0.95)" }}
      >
        <div>
          <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5" style={{ color: "rgba(201,168,106,0.8)" }}>{today}</p>
        </div>
        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95"
          style={{ background: "#1A6644" }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Invoice
        </Link>
      </div>

      <div className="p-8 space-y-7 max-w-7xl">

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpis.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[108px]" />)
          ) : (
            <>
              <KpiCard label="Income"     value={fmt(kpis.data?.monthlyIncome)}   icon={TrendingUp}   iconBg="rgba(26,102,68,0.08)"  iconColor="#1A6644" sub="This month"  delay={0}   />
              <KpiCard label="Expenses"   value={fmt(kpis.data?.monthlyExpenses)} icon={TrendingDown} iconBg="rgba(192,81,81,0.08)"   iconColor="#C05151" sub="This month"  delay={55}  />
              <KpiCard
                label="Net Profit"
                value={fmt(kpis.data?.netProfit)}
                icon={DollarSign}
                iconBg={Number(kpis.data?.netProfit ?? 0) >= 0 ? "rgba(26,102,68,0.08)" : "rgba(192,81,81,0.08)"}
                iconColor={Number(kpis.data?.netProfit ?? 0) >= 0 ? "#1A6644" : "#C05151"}
                sub="This month"
                delay={110}
              />
              <KpiCard label="AR"         value={fmt(kpis.data?.outstandingAR)}  icon={FileText}     iconBg="rgba(201,168,106,0.10)" iconColor="#B8860B" sub="Outstanding" href="/invoices" delay={165} />
              <KpiCard label="AP"         value={fmt(kpis.data?.outstandingAP)}  icon={Receipt}      iconBg="rgba(201,168,106,0.10)" iconColor="#B8860B" sub="Outstanding" href="/bills"    delay={220} />
              <KpiCard label="Cash"       value={fmt(kpis.data?.cashPosition)}   icon={Landmark}     iconBg="rgba(147,196,174,0.15)" iconColor="#2E7D52" sub="Position"    delay={275} />
            </>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Income vs Expense Bar Chart */}
          <div
            className="lg:col-span-2 rounded-2xl bg-white p-6"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif text-base font-medium text-foreground">Income vs Expenses</h2>
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">Last 12 months</span>
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
            className="rounded-2xl bg-white p-6"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <h2 className="font-serif text-base font-medium text-foreground mb-5">Expense Breakdown</h2>
            {breakdown.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : !breakdown.data?.length ? (
              <div className="flex flex-col items-center justify-center h-52 text-center">
                <BarChart3 className="h-8 w-8 mb-2" style={{ color: "rgba(147,196,174,0.4)" }} />
                <p className="text-sm text-muted-foreground">No expenses this month</p>
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
            className="rounded-2xl bg-white overflow-hidden"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(228,225,216,0.6)" }}>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5" style={{ color: "#93C4AE" }} />
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
                  <div key={tx.id} className="flex items-center justify-between px-6 py-3 hover:bg-[#F4F3EF]/60 transition-colors" style={{ borderBottom: "1px solid rgba(228,225,216,0.4)" }}>
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
            className="rounded-2xl bg-white overflow-hidden"
            style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
          >
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(228,225,216,0.6)" }}>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" style={{ color: "#C9A86A" }} />
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
                      className="flex items-center justify-between px-6 py-3 hover:bg-[#F4F3EF]/60 transition-colors group"
                      style={{ borderBottom: "1px solid rgba(228,225,216,0.4)" }}
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
          className="rounded-2xl bg-white overflow-hidden"
          style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
        >
          <div className="px-6 py-3.5" style={{ borderBottom: "1px solid rgba(228,225,216,0.6)" }}>
            <h2 className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "rgba(201,168,106,0.8)" }}>Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0" style={{ borderColor: "rgba(228,225,216,0.5)" }}>
            {[
              { label: "New Invoice",      href: "/invoices/new",      icon: FileText,   iconBg: "rgba(26,102,68,0.08)",   iconColor: "#1A6644"  },
              { label: "New Bill",         href: "/bills/new",         icon: Receipt,    iconBg: "rgba(201,168,106,0.10)", iconColor: "#B8860B"  },
              { label: "New Transaction",  href: "/transactions/new",  icon: ArrowUpDown,iconBg: "rgba(147,196,174,0.15)", iconColor: "#2E7D52"  },
              { label: "Add Contact",      href: "/contacts",          icon: Users,      iconBg: "rgba(26,102,68,0.08)",   iconColor: "#1A6644"  },
              { label: "View Reports",     href: "/reports",           icon: BarChart3,  iconBg: "rgba(192,81,81,0.08)",   iconColor: "#C05151"  },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex flex-col items-center gap-2.5 py-6 transition-all hover:bg-[#F4F3EF]/70 active:scale-95"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: action.iconBg }}>
                  <action.icon className="h-4 w-4" style={{ color: action.iconColor }} />
                </div>
                <span className="text-xs font-medium" style={{ color: "#6B7180" }}>{action.label}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
