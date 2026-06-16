"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const PERIODS = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export default function WatchlistsPage() {
  const utils = trpc.useUtils();
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", threshold: "", period: "MONTHLY" });

  const { data: watchlists = [], isLoading } = trpc.watchlists.list.useQuery();

  const create = trpc.watchlists.create.useMutation({
    onSuccess: () => {
      utils.watchlists.list.invalidate();
      setOpen(false);
      setForm({ name: "", category: "", threshold: "", period: "MONTHLY" });
      toast.success("Watchlist created");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = trpc.watchlists.update.useMutation({
    onSuccess: () => { utils.watchlists.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.watchlists.delete.useMutation({
    onSuccess: () => { utils.watchlists.list.invalidate(); toast.success("Removed from watchlist"); },
    onError: (e) => toast.error(e.message),
  });

  const breached = watchlists.filter((w) => w.isBreached);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Watchlists"
        description="Set spending thresholds on categories and get alerted when exceeded."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Watch
          </Button>
        }
      />

      {/* Alert strip */}
      {breached.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700 font-medium">
            {breached.length} watchlist{breached.length > 1 ? "s" : ""} exceeded threshold: {breached.map((w) => w.name).join(", ")}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : watchlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Eye className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No watchlists</p>
          <p className="text-sm text-muted-foreground">Monitor specific spending categories and set alert thresholds.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Watch</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {watchlists.map((w) => (
            <div key={w.id} className={`rounded-xl border bg-card p-5 flex flex-col gap-3 ${w.isBreached ? "border-red-200" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{w.name}</p>
                    {w.isBreached
                      ? <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{w.category} · {w.period.charAt(0) + w.period.slice(1).toLowerCase()}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => del.mutate({ id: w.id })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Spend bar */}
              <div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${w.isBreached ? "bg-red-500" : w.percentUsed >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(w.percentUsed, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1.5">
                  <span className="text-muted-foreground">Spent {fmt(w.spent)}</span>
                  <span className={`font-medium ${w.isBreached ? "text-red-600" : ""}`}>
                    {w.percentUsed}% of {fmt(w.threshold)}
                  </span>
                </div>
              </div>

              {w.isBreached && (
                <p className="text-xs text-red-600 font-medium">Over threshold by {fmt(w.spent - w.threshold)}</p>
              )}

              <Button
                size="sm" variant="ghost"
                className="text-muted-foreground self-start text-xs"
                onClick={() => toggle.mutate({ id: w.id, isActive: !w.isActive })}
              >
                {w.isActive ? "Pause" : "Resume"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Watchlist</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="e.g. Software spend" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input placeholder="e.g. Software & Subscriptions" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Matches expense account names containing this text.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Threshold</Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} />
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
              disabled={!form.name || !form.category || !form.threshold || create.isPending}
              onClick={() => create.mutate({ name: form.name, category: form.category, threshold: parseFloat(form.threshold), period: form.period as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
