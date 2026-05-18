"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, ArrowLeft, Trophy, XCircle, FileText, CheckCircle2,
  Edit2, Save, X, Phone, Mail, Users, StickyNote, ClipboardCheck,
  Trash2, Plus, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;

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

type EditForm = {
  name: string;
  value: string;
  probability: string;
  expectedCloseDate: string;
  stageId: string;
};

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();

  const [closeDialog, setCloseDialog] = useState(false);
  const [outcome, setOutcome] = useState<"WON" | "LOST">("WON");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  // New activity state
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>("NOTE");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activityDueDate, setActivityDueDate] = useState("");
  const [addingActivity, setAddingActivity] = useState(false);

  const { data: deal, isLoading } = trpc.crmDeals.get.useQuery({ id });
  const { data: pipelines = [] } = trpc.crmPipelines.list.useQuery();

  const close = trpc.crmDeals.close.useMutation({
    onSuccess: () => {
      utils.crmDeals.get.invalidate({ id });
      setCloseDialog(false);
      toast.success(`Deal marked ${outcome}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.crmDeals.update.useMutation({
    onSuccess: () => {
      utils.crmDeals.get.invalidate({ id });
      setEditing(false);
      setEditForm(null);
      toast.success("Deal updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const convertToInvoice = trpc.crmDeals.convertToInvoice.useMutation({
    onSuccess: (data) => {
      utils.crmDeals.get.invalidate({ id });
      toast.success("Invoice created from deal");
      router.push(`/invoices/${data.invoiceId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const logActivity = trpc.crmActivities.create.useMutation({
    onSuccess: () => {
      utils.crmDeals.get.invalidate({ id });
      setActivitySubject("");
      setActivityNotes("");
      setActivityDueDate("");
      setAddingActivity(false);
      toast.success("Activity logged");
    },
    onError: (e) => toast.error(e.message),
  });

  const markActivityDone = trpc.crmActivities.update.useMutation({
    onSuccess: () => { utils.crmDeals.get.invalidate({ id }); toast.success("Marked complete"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteActivity = trpc.crmActivities.delete.useMutation({
    onSuccess: () => { utils.crmDeals.get.invalidate({ id }); },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = () => {
    if (!deal) return;
    setEditForm({
      name: deal.name,
      value: String(Number(deal.value)),
      probability: String(deal.probability),
      expectedCloseDate: deal.expectedCloseDate
        ? new Date(deal.expectedCloseDate).toISOString().split("T")[0]
        : "",
      stageId: deal.stageId,
    });
    setEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (!deal) return <div className="p-6 text-muted-foreground">Deal not found.</div>;

  const isClosed = deal.closedAt != null;
  const isWon = deal.probability === 100 || deal.invoiceId != null;
  const now = new Date();
  const isOverdue =
    deal.expectedCloseDate && !isClosed && new Date(deal.expectedCloseDate) < now;

  const pipelineStages = pipelines.find((p) => p.id === deal.pipeline?.id)?.stages ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/crm/deals">
        <Button variant="ghost" size="sm" className="self-start">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Deals
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{deal.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {deal.contact.name} · {deal.pipeline.name} · {deal.stage.name}
          </p>
          {isOverdue && (
            <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              Close date overdue
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditForm(null); }}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() => {
                  if (!editForm) return;
                  update.mutate({
                    id,
                    name: editForm.name,
                    value: editForm.value ? parseFloat(editForm.value) : undefined,
                    probability: editForm.probability ? parseInt(editForm.probability) : undefined,
                    expectedCloseDate: editForm.expectedCloseDate || undefined,
                    stageId: editForm.stageId || undefined,
                  });
                }}
              >
                {update.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </>
          ) : (
            <>
              {!isClosed && (
                <>
                  <Button variant="outline" size="sm" onClick={startEdit}>
                    <Edit2 className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setOutcome("LOST"); setCloseDialog(true); }}
                  >
                    <XCircle className="h-4 w-4 mr-1 text-red-500" /> Lost
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => { setOutcome("WON"); setCloseDialog(true); }}
                  >
                    <Trophy className="h-4 w-4 mr-1" /> Won
                  </Button>
                </>
              )}
              {isWon && !deal.invoiceId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={convertToInvoice.isPending}
                  onClick={() => convertToInvoice.mutate({ id: deal.id })}
                >
                  {convertToInvoice.isPending ? (
                    <Loader2 className="animate-spin h-4 w-4 mr-1" />
                  ) : (
                    <FileText className="h-4 w-4 mr-1" />
                  )}
                  Convert to invoice
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Deal info */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Deal details
          </h2>

          {editing && editForm ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Deal name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => f ? { ...f, name: e.target.value } : f)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Value ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={editForm.value}
                  onChange={(e) => setEditForm((f) => f ? { ...f, value: e.target.value } : f)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={editForm.probability}
                  onChange={(e) => setEditForm((f) => f ? { ...f, probability: e.target.value } : f)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Stage</Label>
                <Select
                  value={editForm.stageId}
                  onValueChange={(v) => setEditForm((f) => f ? { ...f, stageId: v } : f)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expected close date</Label>
                <Input
                  type="date"
                  value={editForm.expectedCloseDate}
                  onChange={(e) =>
                    setEditForm((f) => f ? { ...f, expectedCloseDate: e.target.value } : f)
                  }
                />
              </div>
            </div>
          ) : (
            <div className="divide-y text-sm">
              {[
                { label: "Value", value: fmt(Number(deal.value)) },
                { label: "Probability", value: `${deal.probability}%` },
                { label: "Stage", value: deal.stage.name },
                { label: "Pipeline", value: deal.pipeline.name },
                { label: "Contact", value: deal.contact.name },
                { label: "Company", value: deal.crmCompany?.name ?? "—" },
                {
                  label: "Close date",
                  value: deal.expectedCloseDate
                    ? new Date(deal.expectedCloseDate).toLocaleDateString()
                    : "—",
                  className: isOverdue ? "text-red-600 font-medium" : undefined,
                },
                { label: "Source", value: deal.source ?? "—" },
              ].map(({ label, value, className }) => (
                <div key={label} className="flex items-center gap-3 py-2">
                  <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                  <span className={className}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {isClosed && !editing && (
            <div
              className={`rounded-lg p-3 mt-2 ${isWon ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}
            >
              <p
                className={`text-sm font-medium flex items-center gap-1 ${isWon ? "text-emerald-700" : "text-red-700"}`}
              >
                {isWon ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {isWon ? "Won" : "Lost"} on{" "}
                {new Date(deal.closedAt!).toLocaleDateString()}
              </p>
              {deal.wonLostReason && (
                <p className="text-xs text-muted-foreground mt-1">
                  {deal.wonLostReason}
                </p>
              )}
            </div>
          )}

          {deal.invoiceId && !editing && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Linked invoice</p>
              <Link
                href={`/invoices/${deal.invoiceId}`}
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                {deal.invoice?.number ?? "View invoice"}
                {deal.invoice?.status && (
                  <span className="text-xs text-muted-foreground">
                    ({deal.invoice.status})
                  </span>
                )}
              </Link>
            </div>
          )}

        </div>

        {/* Activity timeline */}
        <div className="md:col-span-2 rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Activity timeline ({deal.activities.length})
            </h2>
            {!addingActivity && (
              <Button size="sm" variant="outline" onClick={() => setAddingActivity(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Log activity
              </Button>
            )}
          </div>

          {/* New activity form */}
          {addingActivity && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={activityType}
                    onValueChange={(v) => setActivityType(v as (typeof ACTIVITY_TYPES)[number])}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Due date (optional)</Label>
                  <Input
                    type="datetime-local"
                    className="h-8 text-sm"
                    value={activityDueDate}
                    onChange={(e) => setActivityDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Subject <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="e.g. Follow-up call"
                  value={activitySubject}
                  onChange={(e) => setActivitySubject(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[64px]"
                  placeholder="Outcome or additional context…"
                  value={activityNotes}
                  onChange={(e) => setActivityNotes(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAddingActivity(false);
                    setActivitySubject("");
                    setActivityNotes("");
                    setActivityDueDate("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!activitySubject || logActivity.isPending}
                  onClick={() =>
                    logActivity.mutate({
                      type: activityType,
                      subject: activitySubject,
                      notes: activityNotes || undefined,
                      dueDate: activityDueDate
                        ? new Date(activityDueDate).toISOString()
                        : undefined,
                      dealId: id,
                      contactId: deal.contact.id ?? undefined,
                    })
                  }
                >
                  {logActivity.isPending && (
                    <Loader2 className="animate-spin h-3.5 w-3.5 mr-1" />
                  )}
                  Log
                </Button>
              </div>
            </div>
          )}

          {/* Timeline */}
          {deal.activities.length === 0 && !addingActivity ? (
            <div className="flex flex-col items-center py-10 gap-2 text-center">
              <StickyNote className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No activities logged yet.</p>
              <Button size="sm" variant="outline" onClick={() => setAddingActivity(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Log first activity
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {deal.activities.map((a) => {
                const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                const isActivityOverdue =
                  a.dueDate && !a.completedAt && new Date(a.dueDate) < now;
                return (
                  <div key={a.id} className="flex gap-3 group">
                    <div
                      className={`mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${ACTIVITY_COLOR[a.type]}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{a.subject}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {!a.completedAt && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Mark complete"
                              onClick={() =>
                                markActivityDone.mutate({
                                  id: a.id,
                                  completedAt: new Date().toISOString(),
                                })
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => deleteActivity.mutate({ id: a.id })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {a.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span>{a.createdBy.name}</span>
                        <span>·</span>
                        <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                        {a.completedAt && (
                          <span className="text-emerald-600 flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> Done
                          </span>
                        )}
                        {a.dueDate && !a.completedAt && (
                          <span
                            className={isActivityOverdue ? "text-red-600 font-medium" : ""}
                          >
                            {isActivityOverdue ? "Overdue · " : "Due "}
                            {new Date(a.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Close deal dialog */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark Deal {outcome === "WON" ? "Won 🏆" : "Lost"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {outcome === "WON"
                ? "Congratulations! You can convert this deal to an invoice after marking it won."
                : "Sorry to hear that. Adding a reason helps track why deals are lost."}
            </p>
            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Input
                placeholder={
                  outcome === "WON"
                    ? "e.g. Annual contract signed"
                    : "e.g. Budget constraints"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>
              Cancel
            </Button>
            <Button
              variant={outcome === "LOST" ? "destructive" : "default"}
              disabled={close.isPending}
              onClick={() =>
                close.mutate({ id: deal.id, outcome, reason: reason || undefined })
              }
            >
              {close.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />}
              Mark {outcome === "WON" ? "Won" : "Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
