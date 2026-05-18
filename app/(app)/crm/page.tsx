"use client";

import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Loader2, Users2, TrendingUp, Trophy, Clock, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function CrmDashboardPage() {
  const { data: pipeline = [], isLoading: pipelineLoading } = trpc.crmReports.pipeline.useQuery({});
  const { data: forecast = [], isLoading: forecastLoading } = trpc.crmReports.salesForecast.useQuery({ months: 3 });
  const { data: leadSources = [] } = trpc.crmReports.leadSourceReport.useQuery();
  const { data: activities = [] } = trpc.crmActivities.list.useQuery({ overdueOnly: false });
  const { data: deals = [] } = trpc.crmDeals.list.useQuery({ includeWonLost: false });

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: wonLost } = trpc.crmReports.wonLostAnalysis.useQuery({ from: thirtyDaysAgo, to: now.toISOString() });

  const isLoading = pipelineLoading || forecastLoading;

  const openDealsValue = deals.reduce((s, d) => s + (typeof d.value === "object" && d.value && "toNumber" in d.value ? (d.value as { toNumber: () => number }).toNumber() : Number(d.value)), 0);
  const overdueActivities = activities.filter((a) => a.dueDate && !a.completedAt && new Date(a.dueDate) < now);
  const topDeals = [...deals].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 5);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="CRM Dashboard" description="Overview of your sales pipeline and client relationships." />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Open deals value", value: fmt(openDealsValue), icon: TrendingUp, color: "text-indigo-600" },
          { label: "Win rate (30d)", value: `${wonLost?.winRate ?? 0}%`, icon: Trophy, color: "text-emerald-600" },
          { label: "Avg close time", value: `${wonLost ? "-" : "-"} days`, icon: Clock, color: "text-amber-600" },
          { label: "Activities due today", value: String(overdueActivities.length), icon: Calendar, color: "text-red-600" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border bg-card p-4 flex items-start gap-3">
            <div className={`mt-0.5 ${kpi.color}`}>
              <kpi.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="text-2xl font-semibold tabular-nums mt-0.5">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Funnel */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Pipeline by Stage</h2>
          {pipeline.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-center">
              <Users2 className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No pipeline data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipeline} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="stageName" width={90} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, "Deals"]} />
                <Bar dataKey="dealCount" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue Forecast */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Revenue Forecast (Next 3 Months)</h2>
          {forecast.every((f) => f.weightedValue === 0) ? (
            <div className="flex flex-col items-center py-10 gap-2 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Set expected close dates on deals to see the forecast</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={forecast}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [fmt(v), ""]} />
                <Bar dataKey="weightedValue" name="Weighted" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalValue" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Sources */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Lead Source Breakdown</h2>
          {leadSources.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <p className="text-sm text-muted-foreground">No lead data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={leadSources} dataKey="total" nameKey="source" cx="50%" cy="50%" outerRadius={80} label={({ source, total }) => `${source} (${total})`} labelLine={false}>
                  {leadSources.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Deals */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Top Deals by Value</h2>
          {topDeals.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <p className="text-sm text-muted-foreground">No open deals yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topDeals.map((deal) => (
                <div key={deal.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{deal.name}</p>
                    <p className="text-xs text-muted-foreground">{deal.contact.name} · {deal.probability}% probability</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{fmt(Number(deal.value))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
