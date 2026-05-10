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

const fmt = (v: string | number | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(v ?? 0));

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444"];

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  INVOICE: "Invoice",
  BILL: "Bill",
  BANK_IMPORT: "Bank Import",
  AI_EXTRACTION: "AI Extract",
};

function KpiCard({
  label, value, icon: Icon, color, sub, href,
}: {
  label: string; value: string; icon: React.ElementType;
  color: string; sub?: string; href?: string;
}) {
  const inner = (
    <div className={`relative rounded-2xl bg-card shadow-card overflow-hidden border-t-4 ${color}`}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        </div>
        <p className="num text-2xl font-semibold text-foreground leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded-xl ${className}`} />;
}

export default function DashboardPage() {
  const kpis = trpc.dashboard.getKPIs.useQuery();
  const trend = trpc.dashboard.getIncomeExpenseTrend.useQuery();
  const breakdown = trpc.dashboard.getExpenseBreakdown.useQuery();
  const recent = trpc.dashboard.getRecentTransactions.useQuery();
  const outstanding = trpc.dashboard.getOutstandingInvoices.useQuery();

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Invoice
        </Link>
      </div>

      <div className="p-8 space-y-8 max-w-7xl">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpis.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <KpiCard label="Income" value={fmt(kpis.data?.monthlyIncome)} icon={TrendingUp} color="border-emerald-400" sub="This month" />
              <KpiCard label="Expenses" value={fmt(kpis.data?.monthlyExpenses)} icon={TrendingDown} color="border-rose-400" sub="This month" />
              <KpiCard
                label="Net Profit"
                value={fmt(kpis.data?.netProfit)}
                icon={DollarSign}
                color={Number(kpis.data?.netProfit ?? 0) >= 0 ? "border-blue-400" : "border-orange-400"}
                sub="This month"
              />
              <KpiCard label="AR" value={fmt(kpis.data?.outstandingAR)} icon={FileText} color="border-amber-400" sub="Outstanding" href="/invoices" />
              <KpiCard label="AP" value={fmt(kpis.data?.outstandingAP)} icon={Receipt} color="border-orange-400" sub="Outstanding" href="/bills" />
              <KpiCard label="Cash" value={fmt(kpis.data?.cashPosition)} icon={Landmark} color="border-violet-400" sub="Position" />
            </>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Income vs Expense Bar Chart */}
          <div className="lg:col-span-2 rounded-2xl bg-card shadow-card border border-border/40 p-6">
            <h2 className="font-semibold text-sm mb-4">Income vs Expenses — Last 12 Months</h2>
            {trend.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={trend.data} barGap={2} barCategoryGap="25%">
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(v: number | string, name: string) => [fmt(String(v)), name === "income" ? "Income" : "Expenses"]}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                  />
                  <Bar dataKey="income" name="income" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Expense Breakdown Donut */}
          <div className="rounded-2xl bg-card shadow-card border border-border/40 p-6">
            <h2 className="font-semibold text-sm mb-4">Expenses by Category</h2>
            {breakdown.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : !breakdown.data?.length ? (
              <div className="flex flex-col items-center justify-center h-52 text-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No expenses this month</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie
                    data={breakdown.data}
                    dataKey="total"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {breakdown.data.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number | string) => [fmt(String(v)), "Total"]}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Transactions */}
          <div className="rounded-2xl bg-card shadow-card border border-border/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm">Recent Transactions</h2>
              </div>
              <Link href="/transactions" className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recent.isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !recent.data?.length ? (
              <div className="flex flex-col items-center py-12 text-center">
                <ArrowUpDown className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No transactions yet</p>
              </div>
            ) : (
              <div>
                {recent.data.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between px-6 py-3 border-b border-border/30 last:border-0 hover:bg-muted/20">
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
          <div className="rounded-2xl bg-card shadow-card border border-border/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm">Outstanding Invoices</h2>
              </div>
              <Link href="/invoices" className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {outstanding.isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !outstanding.data?.length ? (
              <div className="flex flex-col items-center py-12 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No outstanding invoices</p>
                <Link href="/invoices/new" className="mt-3 text-xs text-primary hover:underline flex items-center gap-1">
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
                      className="flex items-center justify-between px-6 py-3 border-b border-border/30 last:border-0 hover:bg-muted/20 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium text-foreground">{inv.number}</span>
                          {overdue && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100">
                              {daysOverdue}d overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{inv.contactName}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <span className="num text-sm font-medium text-foreground">{fmt(inv.amountDue)}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-2xl bg-card shadow-card border border-border/40 overflow-hidden">
          <div className="px-6 py-3.5 border-b border-border/40">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-border/40">
            {[
              { label: "New Invoice", href: "/invoices/new", icon: FileText, color: "text-blue-600 bg-blue-50" },
              { label: "New Bill", href: "/bills/new", icon: Receipt, color: "text-amber-600 bg-amber-50" },
              { label: "New Transaction", href: "/transactions/new", icon: ArrowUpDown, color: "text-violet-600 bg-violet-50" },
              { label: "Add Contact", href: "/contacts", icon: Users, color: "text-emerald-600 bg-emerald-50" },
              { label: "View Reports", href: "/reports", icon: BarChart3, color: "text-rose-600 bg-rose-50" },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex flex-col items-center gap-2 py-5 hover:bg-muted/30 transition-colors"
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${action.color}`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium text-foreground/70">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
