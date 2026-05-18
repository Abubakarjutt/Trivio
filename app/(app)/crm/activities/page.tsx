"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Calendar, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;
const TYPE_COLOR: Record<string, string> = {
  CALL: "bg-blue-100 text-blue-700",
  EMAIL: "bg-indigo-100 text-indigo-700",
  MEETING: "bg-emerald-100 text-emerald-700",
  NOTE: "bg-amber-100 text-amber-700",
  TASK: "bg-slate-100 text-slate-700",
};

const emptyForm = { type: "NOTE" as const, subject: "", notes: "", dueDate: "", contactId: "", dealId: "" };

export default function ActivitiesPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const { data: activities = [], isLoading } = trpc.crmActivities.list.useQuery({
    ...(typeFilter !== "ALL" ? { type: typeFilter as typeof TYPES[number] } : {}),
    overdueOnly,
  });

  const { data: contacts = [] } = trpc.contacts.list.useQuery({});
  const { data: deals = [] } = trpc.crmDeals.list.useQuery({ includeWonLost: false });

  const create = trpc.crmActivities.create.useMutation({
    onSuccess: () => { utils.crmActivities.list.invalidate(); setOpen(false); setForm(emptyForm); toast.success("Activity logged"); },
    onError: (e) => toast.error(e.message),
  });

  const markComplete = trpc.crmActivities.update.useMutation({
    onSuccess: () => { utils.crmActivities.list.invalidate(); toast.success("Marked complete"); },
    onError: (e) => toast.error(e.message),
  });

  const now = new Date();
  const overdue = activities.filter((a) => a.dueDate && !a.completedAt && new Date(a.dueDate) < now);
  const upcoming = activities.filter((a) => a.dueDate && !a.completedAt && new Date(a.dueDate) >= now);
  const completed = activities.filter((a) => a.completedAt);

  const sections = [
    { label: "Overdue", items: overdue, accent: "text-red-600" },
    { label: "Upcoming", items: upcoming, accent: "text-amber-600" },
    { label: "Completed", items: completed, accent: "text-emerald-600" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Activities"
        description="Log calls, emails, meetings, and tasks."
        action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Log Activity</Button>}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {["ALL", ...TYPES].map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {t}
          </button>
        ))}
        <button onClick={() => setOverdueOnly((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${overdueOnly ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
          Overdue only
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Calendar className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No activities yet</p>
          <p className="text-sm text-muted-foreground">Log calls, meetings, and notes to track client interactions.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Log Activity</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {sections.filter((s) => s.items.length > 0).map((section) => (
            <div key={section.label}>
              <h2 className={`text-sm font-semibold mb-3 ${section.accent}`}>{section.label} ({section.items.length})</h2>
              <div className="space-y-2">
                {section.items.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${TYPE_COLOR[a.type]}`}>{a.type}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{a.subject}</p>
                      {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {a.contact && <span className="text-xs text-muted-foreground">{a.contact.name}</span>}
                        {a.deal && <span className="text-xs text-muted-foreground">· {a.deal.name}</span>}
                        {a.dueDate && <span className={`text-xs ${new Date(a.dueDate) < now && !a.completedAt ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          Due {new Date(a.dueDate).toLocaleDateString()}
                        </span>}
                      </div>
                    </div>
                    {!a.completedAt && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600" title="Mark complete"
                        onClick={() => markComplete.mutate({ id: a.id, completedAt: new Date().toISOString() })}>
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type <span className="text-destructive">*</span></Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as typeof form.type }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Subject <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Follow-up call" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="Optional outcome or notes…" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <Select value={form.contactId} onValueChange={(v) => setForm((f) => ({ ...f, contactId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(contacts as Array<{ id: string; name: string }>).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Deal</Label>
                <Select value={form.dealId} onValueChange={(v) => setForm((f) => ({ ...f, dealId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.subject || create.isPending}
              onClick={() => create.mutate({
                type: form.type, subject: form.subject,
                notes: form.notes || undefined,
                dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
                contactId: form.contactId || undefined,
                dealId: form.dealId || undefined,
              })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Log Activity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
