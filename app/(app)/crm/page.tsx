"use client";

import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import {
  Loader2, TrendingUp, Trophy, Clock, AlertTriangle,
  Plus, ArrowRight, Phone, Mail, Users, StickyNote, ClipboardCheck,
  Handshake, UserPlus,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: StickyNote,
  TASK: ClipboardCheck,
};

const ACTIVITY_COLOR: Record<string, string> = {
  CALL: "bg-blue-100 text-blue-700",
  EMAIL: "bg-violet-100 text-violet-700",
  MEETING: "bg-emerald-100 text-emerald-700",
  NOTE: "bg-amber-100 text-amber-700",
  TASK: "bg-slate-100 text-slate-700",
};

export default function CrmDashboardPage() {
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const { data: pipeline = [], isLoading: pipelineLoading } = trpc.crmReports.pipeline.useQuery({});
  const { data: forecast = [], isLoading: forecastLoading } = trpc.crmReports.salesForecast.useQuery({ months: 3 });
  const { data: leadSources = [] } = trpc.crmReports.leadSourceReport.useQuery();
  const { data: activities = [], isLoading: activitiesLoading } = trpc.crmActivities.list.useQuery({ overdueOnly: false });
  const { data: deals = [] } = trpc.crmDeals.list.useQuery({ includeWonLost: false });

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: wonLost } = trpc.crmReports.wonLostAnalysis.useQuery({
    from: thirtyDaysAgo,
    to: now.toISOString(),
  });

  const isLoading = pipelineLoading || forecastLoading || activitiesLoading;

  const openDealsValue = deals.reduce(
    (s, d) =>
      s +
      (typeof d.value === "object" && d.value && "toNumber" in d.value
        ? (d.value as { toNumber: () => number }).toNumber()
        : Number(d.value)),
    0,
  );

  const overdueActivities = activities.filter(
    (a) => a.dueDate && !a.completedAt && new Date(a.dueDate) < now,
  );

  const recentActivities = [...activities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const topDeals = [...deals]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  const avgDealSize = wonLost?.avgDealSize ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="CRM"
        description="Overview of your sales pipeline and client relationships."
        action={
          <div className="flex gap-2">
            <Link href="/crm/leads">
              <Button size="sm" variant="outline">
                <UserPlus className="h-4 w-4 mr-1" /> Add Lead
              </Button>
            </Link>
            <Link href="/crm/deals">
              <Button size="sm">
                <Handshake className="h-4 w-4 mr-1" /> New Deal
              </Button>
            </Link>
          </div>
        }
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Open pipeline",
            value: fmt(openDealsValue),
            sub: `${deals.length} deal${deals.length !== 1 ? "s" : ""}`,
            icon: TrendingUp,
            color: "text-indigo-600",
            bg: "bg-indigo-50",
          },
          {
            label: "Win rate (30d)",
            value: `${wonLost?.winRate ?? 0}%`,
            sub: "won vs lost",
            icon: Trophy,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
          {
            label: "Avg deal size",
            value: avgDealSize > 0 ? fmt(avgDealSize) : "—",
            sub: "won deals (30d)",
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
          },
          {
            label: "Overdue tasks",
            value: String(overdueActivities.length),
            sub: "need attention",
            icon: AlertTriangle,
            color: overdueActivities.length > 0 ? "text-red-600" : "text-slate-400",
            bg: overdueActivities.length > 0 ? "bg-red-50" : "bg-slate-50",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border bg-card p-4 flex items-start gap-3"
          >
            <div className={`h-9 w-9 rounded-lg ${kpi.bg} flex items-center justify-center shrink-0`}>
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="text-2xl font-semibold tabular-nums mt-0.5">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline by stage */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Pipeline by Stage</h2>
            <Link href="/crm/deals" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {pipeline.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-3 text-center">
              <Handshake className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No pipeline data yet.</p>
              <Link href="/crm/deals">
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add first deal
                </Button>
              </Link>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipeline} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stageName" width={100} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number) => [v, "Deals"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="dealCount" fill="#6366f1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Deals */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Top Deals</h2>
            <Link href="/crm/deals" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              All deals <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {topDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No open deals yet.</p>
          ) : (
            <div className="space-y-1">
              {topDeals.map((deal, i) => (
                <Link
                  key={deal.id}
                  href={`/crm/deals/${deal.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <span className="text-xs text-muted-foreground w-4 shrink-0 text-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {deal.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {deal.contact.name} · {deal.probability}%
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {fmt(Number(deal.value))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Forecast */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Revenue Forecast (Next 3 Months)</h2>
          {forecast.every((f) => f.weightedValue === 0) ? (
            <div className="flex flex-col items-center py-10 gap-2 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Set expected close dates on deals to see the forecast.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={forecast}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmt(v)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: number) => [fmt(v), ""]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="totalValue" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                <Bar dataKey="weightedValue" name="Weighted" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Activities */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Recent Activity</h2>
            <Link href="/crm/activities" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recentActivities.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <StickyNote className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No activities yet.</p>
              <Link href="/crm/activities">
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Log activity
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentActivities.map((a) => {
                const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                return (
                  <div key={a.id} className="flex items-start gap-2.5 py-1">
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${ACTIVITY_COLOR[a.type]}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.contact?.name && `${a.contact.name} · `}
                        {new Date(a.createdAt).toLocaleDateString()}
                        {a.completedAt && " · ✓"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lead sources */}
      {leadSources.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Lead Source Breakdown</h2>
          <div className="flex items-center gap-8">
            <ResponsiveContainer width={200} height={180}>
              <PieChart>
                <Pie
                  data={leadSources}
                  dataKey="total"
                  nameKey="source"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={40}
                >
                  {leadSources.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {leadSources.map((s, i) => (
                <div key={s.source} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-muted-foreground">{s.source.replace(/_/g, " ")}</span>
                  <span className="font-semibold tabular-nums ml-auto pl-4">{s.total}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
