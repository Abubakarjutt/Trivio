"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  PiggyBank,
  CalendarDays,
  Store,
  Wallet,
  ArrowRight,
  Plus,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { PayMonthPicker, usePayMonths } from "@/app/(app)/pf/_components/pay-month-picker";
import { CATEGORY_BY_NAME } from "@/lib/categories";
import { formatCurrency } from "@/lib/utils";

/* Forest-spine palette (as on the business dashboard), extended for more slices */
const PIE_COLORS = [
  "#1A6644",
  "#C9A86A",
  "#93C4AE",
  "#C05151",
  "#2E8B57",
  "#D4A854",
  "#5B7F95",
  "#8C6BA8",
];
const REST_COLOR = "#B8B5AC";
/** Slices after this many are folded into "Everything else" so the pie stays readable. */
const MAX_SLICES = 7;

const CARD_SHADOW =
  "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)";
const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  boxShadow: "0 4px 16px rgba(15,17,23,0.08)",
  color: "hsl(var(--card-foreground))",
};

type Slice = { name: string; total: number; count: number; share: number };

function foldSlices(slices: Slice[]): (Slice & { color: string })[] {
  const shown = slices.slice(0, MAX_SLICES).map((s, i) => ({ ...s, color: PIE_COLORS[i] }));
  const rest = slices.slice(MAX_SLICES);
  if (!rest.length) return shown;
  return [
    ...shown,
    {
      name: "Everything else",
      total: rest.reduce((a, s) => a + s.total, 0),
      count: rest.reduce((a, s) => a + s.count, 0),
      share: rest.reduce((a, s) => a + s.share, 0),
      color: REST_COLOR,
    },
  ];
}

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
/** Axis tick for a period: "Aug" for a calendar month, "25 Aug" for a pay month. */
const shortPeriod = (from: string) =>
  new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    ...(from.endsWith("-01") ? {} : { day: "numeric" }),
    timeZone: "UTC",
  });

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl p-6 ${className}`} style={{ boxShadow: CARD_SHADOW }}>
      {children}
    </div>
  );
}

function CardTitle({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-foreground font-serif text-base font-medium">{title}</h2>
        {sub && <p className="text-muted-foreground/60 mt-0.5 text-[11px]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div
      className="bg-card relative overflow-hidden rounded-2xl p-5"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <div
        className="absolute top-0 right-0 left-0 h-[3px]"
        style={{ background: color, opacity: 0.7 }}
      />
      <div
        className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: `${color}14` }}
      >
        <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={1.75} />
      </div>
      <p
        className="num font-serif text-[1.75rem] leading-none font-medium tracking-tight"
        title={value}
      >
        {value}
      </p>
      <p className="text-muted-foreground/70 mt-2 text-[11px] font-semibold tracking-[0.1em] uppercase">
        {label}
      </p>
      {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded-xl ${className}`} />;
}

/** Ranked list with share bars — the pie's legend, readable at any count. */
function SliceList({
  slices,
  fmt,
  icons,
}: {
  slices: (Slice & { color?: string })[];
  fmt: (n: number) => string;
  icons?: boolean;
}) {
  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {s.color && (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
              )}
              {icons && CATEGORY_BY_NAME[s.name] && (
                <span aria-hidden>{CATEGORY_BY_NAME[s.name].icon}</span>
              )}
              <span className="text-foreground truncate">{s.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {s.count} {s.count === 1 ? "txn" : "txns"}
              </span>
            </span>
            <span className="shrink-0">
              <span className="num text-foreground font-medium">{fmt(s.total)}</span>
              <span className="text-muted-foreground ml-2 inline-block w-11 text-right text-xs">
                {pct(s.share)}
              </span>
            </span>
          </div>
          <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(s.share * 100, 1)}%`, background: s.color ?? "#1A6644" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function PfDashboardPage() {
  const payMonths = usePayMonths();
  const { period } = payMonths;
  const [view, setView] = useState<"category" | "group">("category");

  const { data: org } = trpc.org.get.useQuery();
  const insights = trpc.statementTransactions.insights.useQuery(
    period ? { from: period.from, to: period.to } : {},
    { enabled: payMonths.ready }
  );
  const data = insights.data;
  const isLoading = insights.isLoading || !payMonths.ready;

  const currency = org?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const periodLabel = period ? period.label : "All time";
  const periodNoun = period ? (period.kind === "open" ? "this month" : "this period") : "all time";

  const pieSlices = foldSlices(
    (view === "category" ? data?.expenseByCategory : data?.expenseByGroup) ?? []
  );
  const empty = !isLoading && data?.count === 0;
  const top = data?.expenseByCategory[0];

  return (
    <div className="min-h-full">
      <PageHeader
        title="Money Overview"
        description="Where your money comes from and where it goes."
        action={<PayMonthPicker {...payMonths} />}
      />

      <div className="max-w-7xl space-y-6 p-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[138px]" />)
          ) : (
            <>
              <Kpi
                label="Income"
                value={fmt(data.income)}
                sub={periodLabel}
                icon={TrendingUp}
                color="#1A6644"
              />
              <Kpi
                label="Expenses"
                value={fmt(data.expenses)}
                sub={periodLabel}
                icon={TrendingDown}
                color="#C05151"
              />
              <Kpi
                label={data.net >= 0 ? "Saved" : "Overspent"}
                value={fmt(Math.abs(data.net))}
                sub={
                  data.savingsRate === null
                    ? "No income recorded"
                    : `${pct(Math.max(data.savingsRate, 0))} of income kept`
                }
                icon={PiggyBank}
                color={data.net >= 0 ? "#2E8B57" : "#C05151"}
              />
              {data.dailyAverage !== null ? (
                <Kpi
                  label="Daily spend"
                  value={fmt(data.dailyAverage)}
                  sub="Average per day"
                  icon={CalendarDays}
                  color="#C9A86A"
                />
              ) : (
                <Kpi
                  label="Transactions"
                  value={String(data.count)}
                  sub="All time"
                  icon={Wallet}
                  color="#C9A86A"
                />
              )}
            </>
          )}
        </div>

        {empty ? (
          <Card className="flex flex-col items-center py-16 text-center">
            <Wallet className="mb-3 h-10 w-10" style={{ color: "rgba(147,196,174,0.6)" }} />
            <p className="text-foreground font-serif text-lg">No transactions for {periodNoun}</p>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Import a bank statement or add transactions to see where your money goes.
            </p>
            <Link
              href="/pf/transactions"
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "#1A6644" }}
            >
              <Plus className="h-3.5 w-3.5" /> Add transactions
            </Link>
          </Card>
        ) : (
          <>
            {/* Where the money goes */}
            <Card>
              <CardTitle
                title="Where your money goes"
                sub={`Expenses by ${view === "category" ? "category" : "category group"} · ${periodLabel}`}
                right={
                  <div
                    className="bg-muted flex rounded-lg p-0.5 text-xs font-medium"
                    role="radiogroup"
                    aria-label="Group spending by"
                  >
                    {(["category", "group"] as const).map((v) => (
                      <button
                        key={v}
                        role="radio"
                        aria-checked={view === v}
                        onClick={() => setView(v)}
                        className={`rounded-md px-3 py-1 transition-colors ${
                          view === v
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {v === "category" ? "Categories" : "Groups"}
                      </button>
                    ))}
                  </div>
                }
              />
              {isLoading || !data ? (
                <Skeleton className="h-72 w-full" />
              ) : !pieSlices.length ? (
                <p className="text-muted-foreground py-16 text-center text-sm">
                  No spending for {periodNoun} — only income so far.
                </p>
              ) : (
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[320px_1fr]">
                  <div className="relative h-72" data-testid="spending-pie">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieSlices}
                          dataKey="total"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={78}
                          outerRadius={120}
                          paddingAngle={pieSlices.length > 1 ? 2 : 0}
                          stroke="none"
                          animationDuration={600}
                        >
                          {pieSlices.map((s) => (
                            <Cell key={s.name} fill={s.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number | string, name: string) => [fmt(Number(v)), name]}
                          contentStyle={TOOLTIP_STYLE}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-[0.12em] uppercase">
                        Spent
                      </span>
                      <span className="num text-foreground font-serif text-xl font-medium">
                        {fmt(data.expenses)}
                      </span>
                    </div>
                  </div>
                  <SliceList slices={pieSlices} fmt={fmt} icons={view === "category"} />
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Trend */}
              <Card className="lg:col-span-2">
                <CardTitle
                  title="Income vs expenses"
                  sub={period ? "Your last 6 months" : "Your last 12 months"}
                  right={
                    <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: "#1A6644" }}
                        />
                        Income
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: "#C05151" }}
                        />
                        Expenses
                      </span>
                    </div>
                  }
                />
                {isLoading || !data ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={data.trend} barGap={2} barCategoryGap="25%">
                      <XAxis
                        dataKey="from"
                        tickFormatter={shortPeriod}
                        tick={{ fontSize: 10, fill: "#9CA3AF" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#9CA3AF" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => fmt(Number(v))}
                        width={80}
                      />
                      <Tooltip
                        labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
                        formatter={(v: number | string, name: string) => [
                          fmt(Number(v)),
                          name === "income" ? "Income" : "Expenses",
                        ]}
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: "rgba(228,225,216,0.4)" }}
                      />
                      <Bar dataKey="income" fill="#1A6644" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="expenses" fill="#C05151" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Income sources */}
              <Card>
                <CardTitle
                  title="Where it comes from"
                  sub={`Income by category · ${periodLabel}`}
                />
                {isLoading || !data ? (
                  <Skeleton className="h-56 w-full" />
                ) : !data.incomeByCategory.length ? (
                  <p className="text-muted-foreground py-12 text-center text-sm">
                    No income recorded.
                  </p>
                ) : (
                  <SliceList slices={data.incomeByCategory.slice(0, 6)} fmt={fmt} icons />
                )}
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Top merchants */}
              <Card>
                <CardTitle
                  title="Top merchants"
                  sub={`Where you spent the most · ${periodLabel}`}
                />
                {isLoading || !data ? (
                  <Skeleton className="h-48 w-full" />
                ) : !data.topMerchants.length ? (
                  <p className="text-muted-foreground py-12 text-center text-sm">
                    No spending recorded.
                  </p>
                ) : (
                  <ol className="divide-border/40 divide-y">
                    {data.topMerchants.map((m, i) => (
                      <li
                        key={m.name}
                        className="flex items-center justify-between gap-3 py-2.5 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="bg-muted text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                            {i + 1}
                          </span>
                          <span className="text-foreground truncate">{m.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">×{m.count}</span>
                        </span>
                        <span className="num shrink-0 font-medium">{fmt(m.total)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {/* Highlights */}
              <Card>
                <CardTitle title="Highlights" sub={periodLabel} />
                {isLoading || !data ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <ul className="space-y-4 text-sm">
                    {top && (
                      <li className="flex gap-3">
                        <span className="text-lg" aria-hidden>
                          {CATEGORY_BY_NAME[top.name]?.icon ?? "📋"}
                        </span>
                        <span className="text-muted-foreground">
                          Your biggest spending category is{" "}
                          <strong className="text-foreground">{top.name}</strong> — {fmt(top.total)}
                          , {pct(top.share)} of everything you spent.
                        </span>
                      </li>
                    )}
                    {data.largestExpense && (
                      <li className="flex gap-3">
                        <Store className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                        <span className="text-muted-foreground">
                          Largest single expense:{" "}
                          <strong className="text-foreground">
                            {fmt(data.largestExpense.amount)}
                          </strong>{" "}
                          at {data.largestExpense.name} on{" "}
                          {new Date(data.largestExpense.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          })}
                          .
                        </span>
                      </li>
                    )}
                    <li className="flex gap-3">
                      <PiggyBank className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <span className="text-muted-foreground">
                        {data.savingsRate === null
                          ? "No income recorded for this period."
                          : data.net >= 0
                            ? `You kept ${pct(data.savingsRate)} of your income.`
                            : `You spent ${fmt(-data.net)} more than you earned.`}
                      </span>
                    </li>
                  </ul>
                )}
                <Link
                  href="/pf/transactions"
                  className="mt-6 inline-flex items-center gap-1 text-xs font-medium"
                  style={{ color: "#1A6644" }}
                >
                  View all transactions <ArrowRight className="h-3 w-3" />
                </Link>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
