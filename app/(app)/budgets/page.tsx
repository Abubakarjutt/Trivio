"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Archive, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";

const PERIODS = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function UtilBar({ pct }: { pct: number }) {
  const fillColor = pct >= 100 ? "#C05151" : pct >= 80 ? "#C9A86A" : "#1A6644";
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(228,225,216,0.6)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(pct, 100)}%`, background: fillColor }}
      />
    </div>
  );
}

export default function BudgetsPage() {
  const { data: orgData } = trpc.org.get.useQuery();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", limitAmount: "", period: "MONTHLY" });

  const { data: budgets = [], isLoading } = trpc.budgets.list.useQuery({ includeArchived: false });

  const create = trpc.budgets.create.useMutation({
    onSuccess: () => { utils.budgets.list.invalidate(); setOpen(false); setForm({ name: "", category: "", limitAmount: "", period: "MONTHLY" }); toast.success("Budget created"); },
    onError: (e) => toast.error(e.message),
  });

  const archive = trpc.budgets.archive.useMutation({
    onSuccess: () => { utils.budgets.list.invalidate(); toast.success("Budget archived"); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.budgets.delete.useMutation({
    onSuccess: () => { utils.budgets.list.invalidate(); toast.success("Budget deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const totalLimit = budgets.reduce((s, b) => s + b.limitAmount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);

  if (orgData && orgData.plan !== "PRO") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title="Budgets"
          description="Set spending limits by category and track utilization."
        />
        <div className="rounded-2xl border border-border/40 bg-card p-8 text-center max-w-md mx-auto">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-semibold text-lg mb-2">Pro feature</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Budget tracking is available on the Pro plan. Upgrade to set spending limits and track utilization across categories.
          </p>
          <Link
            href="/settings/billing"
            className="inline-flex items-center justify-center h-10 px-6 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#1A6644" }}
          >
            Upgrade to Pro →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Budgets"
        description="Set spending limits by category and track utilization."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Budget
          </Button>
        }
      />

      {/* Summary strip */}
      {budgets.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total budget", value: fmt(totalLimit), sub: "across all categories", iconColor: "#C9A86A", iconBg: "rgba(201,168,106,0.10)" },
            { label: "Total spent",  value: fmt(totalSpent), sub: "this period",           iconColor: "#C05151", iconBg: "rgba(192,81,81,0.08)" },
            { label: "Remaining",    value: fmt(Math.max(0, totalLimit - totalSpent)), sub: "available to spend", iconColor: "#1A6644", iconBg: "rgba(26,102,68,0.08)" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl bg-white p-5"
              style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{card.label}</p>
              <p className="font-serif text-2xl font-medium tabular-nums mt-2 text-foreground">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Budget cards */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <TrendingUp className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No budgets yet</p>
          <p className="text-sm text-muted-foreground">Create a budget to track spending by category.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Budget</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((b) => (
            <div
              key={b.id}
              className="rounded-2xl bg-white p-5 flex flex-col gap-3"
              style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{b.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{b.category} · {b.period.charAt(0) + b.period.slice(1).toLowerCase()}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => archive.mutate({ id: b.id })} title="Archive">
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" style={{ color: "#C05151" }} onClick={() => del.mutate({ id: b.id })} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <UtilBar pct={b.utilization} />
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Spent {fmt(b.spent)}</span>
                <span
                  className="font-medium"
                  style={{ color: b.utilization >= 100 ? "#C05151" : b.utilization >= 80 ? "#C9A86A" : "#1A6644" }}
                >
                  {b.utilization}% of {fmt(b.limitAmount)}
                </span>
              </div>
              {b.utilization >= 100 && (
                <p className="text-xs font-medium" style={{ color: "#C05151" }}>Over budget by {fmt(b.spent - b.limitAmount)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Budget</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Budget name</Label>
              <Input placeholder="e.g. Marketing spend" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input placeholder="e.g. Marketing & Advertising" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Must match part of an expense account name to track spending automatically.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Limit amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.limitAmount} onChange={(e) => setForm((f) => ({ ...f, limitAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Period</Label>
                <Select value={form.period} onValueChange={(v) => setForm((f) => ({ ...f, period: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || !form.category || !form.limitAmount || create.isPending}
              onClick={() => create.mutate({ name: form.name, category: form.category, limitAmount: parseFloat(form.limitAmount), period: form.period as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
