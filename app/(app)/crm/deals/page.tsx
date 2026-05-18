"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Handshake, Trash2, LayoutGrid, List, AlertCircle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function probColor(p: number) {
  if (p >= 80) return "text-emerald-600 bg-emerald-100";
  if (p >= 50) return "text-amber-600 bg-amber-100";
  return "text-red-600 bg-red-100";
}

const emptyForm = {
  name: "",
  value: "",
  contactId: "",
  pipelineId: "",
  stageId: "",
  expectedCloseDate: "",
  probability: "",
};

export default function DealsPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [form, setForm] = useState(emptyForm);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");

  const { data: pipelines = [], isLoading: pipelinesLoading } = trpc.crmPipelines.list.useQuery();
  const { data: deals = [], isLoading: dealsLoading } = trpc.crmDeals.list.useQuery({
    pipelineId: selectedPipelineId || undefined,
  });
  const { data: contacts = [] } = trpc.contacts.list.useQuery({});

  const activePipeline =
    pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];

  const create = trpc.crmDeals.create.useMutation({
    onSuccess: () => {
      utils.crmDeals.list.invalidate();
      setOpen(false);
      setForm(emptyForm);
      toast.success("Deal created");
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.crmDeals.delete.useMutation({
    onSuccess: () => { utils.crmDeals.list.invalidate(); toast.success("Deal deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const moveDeal = trpc.crmDeals.update.useMutation({
    onSuccess: () => utils.crmDeals.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const isLoading = pipelinesLoading || dealsLoading;
  const now = new Date();
  const formStages = pipelines.find((p) => p.id === form.pipelineId)?.stages ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Deals" description="Manage your sales pipeline." />
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Handshake className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No pipeline set up yet</p>
          <p className="text-sm text-muted-foreground">
            Create a pipeline in Settings before adding deals.
          </p>
          <Link href="/settings/pipelines">
            <Button size="sm" variant="outline">Set up pipeline</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Deals"
        description="Manage your sales pipeline."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView(view === "kanban" ? "list" : "kanban")}
              title={view === "kanban" ? "Switch to list view" : "Switch to board view"}
            >
              {view === "kanban" ? (
                <List className="h-4 w-4" />
              ) : (
                <LayoutGrid className="h-4 w-4" />
              )}
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Deal
            </Button>
          </div>
        }
      />

      {/* Pipeline selector */}
      {pipelines.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPipelineId(p.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                (selectedPipelineId ? selectedPipelineId === p.id : pipelines[0]?.id === p.id)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Handshake className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No open deals</p>
          <p className="text-sm text-muted-foreground">
            Add a deal to start tracking your pipeline.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Deal
          </Button>
        </div>
      ) : view === "kanban" ? (
        /* ── Kanban ── */
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
          {(activePipeline?.stages ?? []).map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const stageTotal = stageDeals.reduce((s, d) => s + Number(d.value), 0);
            return (
              <div
                key={stage.id}
                className="flex-shrink-0 w-72 rounded-xl bg-muted/40 border border-border/50 flex flex-col"
              >
                {/* Column header */}
                <div className="px-3 py-2.5 border-b border-border/50">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      {stage.name}
                    </span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {fmt(stageTotal)}
                  </p>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 p-2 flex-1 min-h-[120px]">
                  {stageDeals.map((deal) => {
                    const isOverdue =
                      deal.expectedCloseDate &&
                      new Date(deal.expectedCloseDate) < now;
                    return (
                      <Link
                        key={deal.id}
                        href={`/crm/deals/${deal.id}`}
                        className="block rounded-lg border bg-card p-3 hover:shadow-md transition-all hover:-translate-y-0.5 group"
                      >
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <p className="text-sm font-medium leading-snug group-hover:text-primary transition-colors">
                            {deal.name}
                          </p>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${probColor(deal.probability)}`}
                          >
                            {deal.probability}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {deal.contact.name}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold tabular-nums">
                            {fmt(Number(deal.value))}
                          </span>
                          {deal.expectedCloseDate && (
                            <span
                              className={`flex items-center gap-1 text-[10px] ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                            >
                              {isOverdue ? (
                                <AlertCircle className="h-3 w-3" />
                              ) : (
                                <CalendarClock className="h-3 w-3" />
                              )}
                              {new Date(deal.expectedCloseDate).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Add to column */}
                <button
                  className="mx-2 mb-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      pipelineId: activePipeline?.id ?? "",
                      stageId: stage.id,
                    }));
                    setOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add deal
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── List ── */
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Deal</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Stage</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Value</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Prob.</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Close date</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => {
                const isOverdue =
                  deal.expectedCloseDate && new Date(deal.expectedCloseDate) < now;
                return (
                  <tr
                    key={deal.id}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/crm/deals/${deal.id}`}
                        className="font-medium group-hover:text-primary transition-colors"
                      >
                        {deal.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {deal.contact.name}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={deal.stageId}
                        onValueChange={(stageId) => moveDeal.mutate({ id: deal.id, stageId })}
                      >
                        <SelectTrigger className="h-6 w-auto border-0 p-0 shadow-none focus:ring-0">
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">
                            {deal.stage.name}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {(activePipeline?.stages ?? []).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {fmt(Number(deal.value))}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${probColor(deal.probability)}`}>
                        {deal.probability}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      {deal.expectedCloseDate ? (
                        <span className={isOverdue ? "text-red-600 font-medium flex items-center gap-1 justify-end" : "text-muted-foreground"}>
                          {isOverdue && <AlertCircle className="h-3.5 w-3.5" />}
                          {new Date(deal.expectedCloseDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => del.mutate({ id: deal.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {deals.length} deal{deals.length !== 1 ? "s" : ""} ·{" "}
            {fmt(deals.reduce((s, d) => s + Number(d.value), 0))} total pipeline
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Deal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Deal name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Annual subscription"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Value ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  placeholder="0"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Auto"
                  value={form.probability}
                  onChange={(e) => setForm((f) => ({ ...f, probability: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                Contact <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.contactId}
                onValueChange={(v) => setForm((f) => ({ ...f, contactId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent>
                  {(contacts as Array<{ id: string; name: string }>).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Pipeline <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.pipelineId}
                  onValueChange={(v) => setForm((f) => ({ ...f, pipelineId: v, stageId: "" }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Stage <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.stageId}
                  onValueChange={(v) => setForm((f) => ({ ...f, stageId: v }))}
                  disabled={!form.pipelineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {formStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Expected close date</Label>
              <Input
                type="date"
                value={form.expectedCloseDate}
                onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.name ||
                !form.contactId ||
                !form.pipelineId ||
                !form.stageId ||
                create.isPending
              }
              onClick={() =>
                create.mutate({
                  name: form.name,
                  value: form.value ? parseFloat(form.value) : 0,
                  contactId: form.contactId,
                  pipelineId: form.pipelineId,
                  stageId: form.stageId,
                  expectedCloseDate: form.expectedCloseDate || undefined,
                  probability: form.probability ? parseInt(form.probability) : undefined,
                })
              }
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create Deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
