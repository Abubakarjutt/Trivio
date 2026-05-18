"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, Plus, CheckCircle2, Trash2,
  Phone, Mail, Users, StickyNote, ClipboardCheck,
  Clock, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: StickyNote,
  TASK: ClipboardCheck,
};

const TYPE_COLOR: Record<string, string> = {
  CALL: "bg-blue-100 text-blue-700",
  EMAIL: "bg-violet-100 text-violet-700",
  MEETING: "bg-emerald-100 text-emerald-700",
  NOTE: "bg-amber-100 text-amber-700",
  TASK: "bg-slate-100 text-slate-700",
};

const emptyForm = {
  type: "NOTE" as (typeof TYPES)[number],
  subject: "",
  notes: "",
  dueDate: "",
  contactId: "",
  dealId: "",
};

export default function ActivitiesPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const { data: activities = [], isLoading } = trpc.crmActivities.list.useQuery({
    ...(typeFilter !== "ALL" ? { type: typeFilter as (typeof TYPES)[number] } : {}),
    overdueOnly,
  });

  const { data: contacts = [] } = trpc.contacts.list.useQuery({});
  const { data: deals = [] } = trpc.crmDeals.list.useQuery({ includeWonLost: false });

  const create = trpc.crmActivities.create.useMutation({
    onSuccess: () => {
      utils.crmActivities.list.invalidate();
      setOpen(false);
      setForm(emptyForm);
      toast.success("Activity logged");
    },
    onError: (e) => toast.error(e.message),
  });

  const markComplete = trpc.crmActivities.update.useMutation({
    onSuccess: () => { utils.crmActivities.list.invalidate(); toast.success("Marked complete"); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.crmActivities.delete.useMutation({
    onSuccess: () => { utils.crmActivities.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const now = new Date();
  const overdue = activities.filter(
    (a) => a.dueDate && !a.completedAt && new Date(a.dueDate) < now,
  );
  const upcoming = activities.filter(
    (a) => a.dueDate && !a.completedAt && new Date(a.dueDate) >= now,
  );
  const noDate = activities.filter((a) => !a.dueDate && !a.completedAt);
  const completed = activities.filter((a) => a.completedAt);

  const sections = [
    {
      label: "Overdue",
      items: overdue,
      Icon: AlertTriangle,
      accent: "text-red-600",
      borderColor: "border-red-200",
      bgColor: "bg-red-50",
    },
    {
      label: "Upcoming",
      items: upcoming,
      Icon: Clock,
      accent: "text-amber-600",
      borderColor: "border-amber-200",
      bgColor: "bg-amber-50/50",
    },
    {
      label: "No due date",
      items: noDate,
      Icon: StickyNote,
      accent: "text-muted-foreground",
      borderColor: "border-border",
      bgColor: "",
    },
    {
      label: "Completed",
      items: completed,
      Icon: CheckCircle2,
      accent: "text-emerald-600",
      borderColor: "border-emerald-200",
      bgColor: "bg-emerald-50/30",
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Activities"
        description="Log calls, emails, meetings, and tasks."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Log Activity
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(["ALL", ...TYPES] as string[]).map((t) => {
          const Icon = t !== "ALL" ? TYPE_ICON[t] : null;
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {t}
            </button>
          );
        })}
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            overdueOnly
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Overdue only
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No activities yet</p>
          <p className="text-sm text-muted-foreground">
            Log calls, meetings, and notes to track client interactions.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Log Activity
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {sections
            .filter((s) => s.items.length > 0)
            .map((section) => {
              const SectionIcon = section.Icon;
              return (
                <div key={section.label}>
                  <div className={`flex items-center gap-2 mb-3 ${section.accent}`}>
                    <SectionIcon className="h-4 w-4" />
                    <h2 className="text-sm font-semibold">
                      {section.label}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({section.items.length})
                      </span>
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {section.items.map((a) => {
                      const Icon = TYPE_ICON[a.type] ?? StickyNote;
                      const isActivityOverdue =
                        a.dueDate && !a.completedAt && new Date(a.dueDate) < now;
                      return (
                        <div
                          key={a.id}
                          className={`flex items-start gap-3 rounded-xl border p-4 group transition-colors ${section.bgColor} ${section.borderColor}`}
                        >
                          <div
                            className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${TYPE_COLOR[a.type]}`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{a.subject}</p>
                            {a.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {a.notes}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                              {a.contact && (
                                <span className="text-xs text-muted-foreground">
                                  {a.contact.name}
                                </span>
                              )}
                              {a.deal && (
                                <span className="text-xs text-muted-foreground">
                                  · {a.deal.name}
                                </span>
                              )}
                              {a.dueDate && (
                                <span
                                  className={`text-xs ${isActivityOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                                >
                                  {isActivityOverdue ? "Overdue · " : "Due "}
                                  {new Date(a.dueDate).toLocaleDateString()}
                                </span>
                              )}
                              {a.completedAt && (
                                <span className="text-xs text-emerald-600">
                                  Completed {new Date(a.completedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!a.completedAt && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Mark complete"
                                onClick={() =>
                                  markComplete.mutate({
                                    id: a.id,
                                    completedAt: new Date().toISOString(),
                                  })
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => del.mutate({ id: a.id })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as typeof form.type }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="datetime-local"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                Subject <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Follow-up call"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[80px]"
                placeholder="Outcome or additional context…"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <Select
                  value={form.contactId}
                  onValueChange={(v) => setForm((f) => ({ ...f, contactId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(contacts as Array<{ id: string; name: string }>).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Deal</Label>
                <Select
                  value={form.dealId}
                  onValueChange={(v) => setForm((f) => ({ ...f, dealId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.subject || create.isPending}
              onClick={() =>
                create.mutate({
                  type: form.type,
                  subject: form.subject,
                  notes: form.notes || undefined,
                  dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
                  contactId: form.contactId || undefined,
                  dealId: form.dealId || undefined,
                })
              }
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Log Activity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
