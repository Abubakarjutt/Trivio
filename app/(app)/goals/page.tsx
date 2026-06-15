"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Target, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  ACTIVE:    { color: "#1A6644",  background: "rgba(26,102,68,0.08)",   border: "1px solid rgba(26,102,68,0.2)" },
  COMPLETED: { color: "#2E7D52",  background: "rgba(147,196,174,0.15)", border: "1px solid rgba(147,196,174,0.35)" },
  CANCELLED: { color: "#9CA3AF",  background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" },
};

export default function GoalsPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED">("ALL");
  const [form, setForm] = useState({ name: "", description: "", targetAmount: "", currentAmount: "", targetDate: "" });

  const { data: goals = [], isLoading } = trpc.goals.list.useQuery({ status: statusFilter });

  const create = trpc.goals.create.useMutation({
    onSuccess: () => { utils.goals.list.invalidate(); setOpen(false); setForm({ name: "", description: "", targetAmount: "", currentAmount: "", targetDate: "" }); toast.success("Goal created"); },
    onError: (e) => toast.error(e.message),
  });

  const contribute = trpc.goals.contribute.useMutation({
    onSuccess: () => { utils.goals.list.invalidate(); setContributeOpen(null); setContributeAmount(""); toast.success("Contribution added"); },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.goals.update.useMutation({
    onSuccess: () => { utils.goals.list.invalidate(); toast.success("Goal updated"); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.goals.delete.useMutation({
    onSuccess: () => { utils.goals.list.invalidate(); toast.success("Goal deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const totalTarget = goals.filter((g) => g.status === "ACTIVE").reduce((s, g) => s + g.targetAmount, 0);
  const totalSaved = goals.filter((g) => g.status === "ACTIVE").reduce((s, g) => s + g.currentAmount, 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Goals"
        description="Set financial targets and track your progress."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Goal
          </Button>
        }
      />

      {/* Summary */}
      {goals.some((g) => g.status === "ACTIVE") && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total target", value: fmt(totalTarget) },
            { label: "Total saved",  value: fmt(totalSaved) },
            { label: "Still needed", value: fmt(Math.max(0, totalTarget - totalSaved)) },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-2xl bg-white p-5"
              style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{c.label}</p>
              <p className="font-serif text-2xl font-medium tabular-nums mt-2 text-foreground">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(["ALL", "ACTIVE", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Target className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No goals yet</p>
          <p className="text-sm text-muted-foreground">Set a savings goal and track your progress.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Goal</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((g) => (
            <div
              key={g.id}
              className="rounded-2xl bg-white p-5 flex flex-col gap-3"
              style={{ boxShadow: "0 0 0 1px rgba(15,17,23,0.04), 0 1px 2px rgba(15,17,23,0.04), 0 8px 24px -8px rgba(15,17,23,0.08)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{g.name}</p>
                  {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
                  {g.targetDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">Due: {new Date(g.targetDate).toLocaleDateString()}</p>
                  )}
                </div>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={STATUS_STYLE[g.status] ?? {}}
                >
                  {g.status}
                </span>
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "rgba(228,225,216,0.6)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${g.progress}%`, background: g.status === "COMPLETED" ? "#93C4AE" : "#1A6644" }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1.5">
                  <span className="text-muted-foreground">{fmt(g.currentAmount)} saved</span>
                  <span className="font-medium">{g.progress}% of {fmt(g.targetAmount)}</span>
                </div>
              </div>

              {/* Actions */}
              {g.status === "ACTIVE" && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setContributeOpen(g.id); setContributeAmount(""); }}>
                    Add funds
                  </Button>
                  <Button size="sm" variant="ghost" className="text-emerald-600" onClick={() => updateStatus.mutate({ id: g.id, status: "COMPLETED" })} title="Mark complete">
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => updateStatus.mutate({ id: g.id, status: "CANCELLED" })} title="Cancel">
                    <XCircle className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate({ id: g.id })} title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {g.status !== "ACTIVE" && (
                <Button size="sm" variant="ghost" className="text-destructive self-start" onClick={() => del.mutate({ id: g.id })}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Goal</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Goal name</Label>
              <Input placeholder="e.g. Emergency fund" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="What is this goal for?" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Target amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.targetAmount} onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Already saved <span className="text-muted-foreground">(optional)</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.currentAmount} onChange={(e) => setForm((f) => ({ ...f, currentAmount: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Target date <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" value={form.targetDate} onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || !form.targetAmount || create.isPending}
              onClick={() =>
                create.mutate({
                  name: form.name,
                  description: form.description || undefined,
                  targetAmount: parseFloat(form.targetAmount),
                  currentAmount: parseFloat(form.currentAmount || "0"),
                  targetDate: form.targetDate ? new Date(form.targetDate) : undefined,
                })
              }
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contribute dialog */}
      <Dialog open={!!contributeOpen} onOpenChange={() => setContributeOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add funds to goal</DialogTitle></DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label>Amount to add</Label>
            <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={contributeAmount} onChange={(e) => setContributeAmount(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributeOpen(null)}>Cancel</Button>
            <Button
              disabled={!contributeAmount || parseFloat(contributeAmount) <= 0 || contribute.isPending}
              onClick={() => contributeOpen && contribute.mutate({ id: contributeOpen, amount: parseFloat(contributeAmount) })}
            >
              {contribute.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Add funds
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
