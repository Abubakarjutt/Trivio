"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const FREQUENCIES = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export default function RecurringPage() {
  const utils = trpc.useUtils();
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", amount: "", type: "EXPENSE",
    frequency: "MONTHLY", category: "", nextDueDate: "",
  });

  const { data: items = [], isLoading } = trpc.recurringItems.list.useQuery({ activeOnly: false });
  const { data: summary } = trpc.recurringItems.summary.useQuery();

  const create = trpc.recurringItems.create.useMutation({
    onSuccess: () => {
      utils.recurringItems.list.invalidate();
      utils.recurringItems.summary.invalidate();
      setOpen(false);
      setForm({ name: "", description: "", amount: "", type: "EXPENSE", frequency: "MONTHLY", category: "", nextDueDate: "" });
      toast.success("Recurring item created");
    },
    onError: (e) => toast.error(e.message),
  });

  const markPaid = trpc.recurringItems.markPaid.useMutation({
    onSuccess: () => { utils.recurringItems.list.invalidate(); toast.success("Marked as paid — next due date advanced"); },
    onError: (e) => toast.error(e.message),
  });

  const toggle = trpc.recurringItems.update.useMutation({
    onSuccess: () => { utils.recurringItems.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.recurringItems.delete.useMutation({
    onSuccess: () => { utils.recurringItems.list.invalidate(); utils.recurringItems.summary.invalidate(); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const dueItems = items.filter((i) => i.isDue && i.isActive);
  const upcomingItems = items.filter((i) => !i.isDue && i.isActive);
  const inactiveItems = items.filter((i) => !i.isActive);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recurring Items"
        description="Track regular income and expenses. Mark them paid to advance the due date."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Recurring
          </Button>
        }
      />

      {/* Monthly summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Monthly income", value: fmt(summary.monthlyIncome), color: "text-emerald-600" },
            { label: "Monthly expenses", value: fmt(summary.monthlyExpense), color: "text-red-600" },
            { label: "Monthly net", value: fmt(summary.monthlyNet), color: summary.monthlyNet >= 0 ? "text-emerald-600" : "text-red-600" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-2xl font-semibold tabular-nums mt-1 ${c.color}`}>{c.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">normalised monthly equivalent</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <RefreshCw className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No recurring items</p>
          <p className="text-sm text-muted-foreground">Add subscriptions, salaries, rent, or any regular income/expense.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Recurring</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {dueItems.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-red-600 flex items-center gap-1.5 mb-3">
                <AlertCircle className="h-4 w-4" /> Due now ({dueItems.length})
              </h3>
              <RecurringList items={dueItems} onPaid={(id) => markPaid.mutate({ id })} onToggle={(id, v) => toggle.mutate({ id, isActive: v })} onDelete={(id) => del.mutate({ id })} fmt={fmt} />
            </section>
          )}
          {upcomingItems.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">Upcoming ({upcomingItems.length})</h3>
              <RecurringList items={upcomingItems} onPaid={(id) => markPaid.mutate({ id })} onToggle={(id, v) => toggle.mutate({ id, isActive: v })} onDelete={(id) => del.mutate({ id })} fmt={fmt} />
            </section>
          )}
          {inactiveItems.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">Inactive ({inactiveItems.length})</h3>
              <RecurringList items={inactiveItems} onPaid={(id) => markPaid.mutate({ id })} onToggle={(id, v) => toggle.mutate({ id, isActive: v })} onDelete={(id) => del.mutate({ id })} fmt={fmt} />
            </section>
          )}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Recurring Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="e.g. Office rent" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCOME">Income</SelectItem>
                    <SelectItem value="EXPENSE">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f.charAt(0) + f.slice(1).toLowerCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="e.g. Rent" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Next due date</Label>
              <Input type="date" value={form.nextDueDate} onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || !form.amount || !form.nextDueDate || create.isPending}
              onClick={() => create.mutate({
                name: form.name,
                description: form.description || undefined,
                amount: parseFloat(form.amount),
                type: form.type as "INCOME" | "EXPENSE",
                frequency: form.frequency as typeof FREQUENCIES[number],
                category: form.category || undefined,
                nextDueDate: new Date(form.nextDueDate),
              })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type RecurringItemData = {
  id: string; name: string; amount: number; type: string;
  frequency: string; category: string | null; nextDueDate: Date;
  isDue: boolean; daysUntilDue: number; isActive: boolean;
};

function RecurringList({ items, onPaid, onToggle, onDelete, fmt }: {
  items: RecurringItemData[];
  onPaid: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  fmt: (n: number) => string;
}) {
  return (
    <div className="divide-y rounded-xl border bg-card overflow-hidden">
      {items.map((item) => (
        <div key={item.id} className={`flex items-center gap-4 px-4 py-3 ${!item.isActive ? "opacity-50" : ""}`}>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.type === "INCOME" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {item.type === "INCOME" ? "+" : "−"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.frequency.charAt(0) + item.frequency.slice(1).toLowerCase()}
              {item.category ? ` · ${item.category}` : ""}
              {" · "}
              {item.isDue ? <span className="text-red-600 font-medium">Due now</span>
                : item.daysUntilDue <= 7 ? <span className="text-amber-600">Due in {item.daysUntilDue}d</span>
                : `Due in ${item.daysUntilDue}d`}
            </p>
          </div>
          <p className={`text-sm font-semibold tabular-nums shrink-0 ${item.type === "INCOME" ? "text-emerald-600" : ""}`}>
            {fmt(item.amount)}
          </p>
          <div className="flex gap-1 shrink-0">
            {item.isActive && (
              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="Mark paid" onClick={() => onPaid(item.id)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" title={item.isActive ? "Deactivate" : "Activate"} onClick={() => onToggle(item.id, !item.isActive)}>
              <RefreshCw className={`h-3.5 w-3.5 ${item.isActive ? "text-muted-foreground" : "text-primary"}`} />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
