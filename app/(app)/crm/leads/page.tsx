"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, UserPlus, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;
const SOURCES = ["WEBSITE", "REFERRAL", "SOCIAL_MEDIA", "COLD_OUTREACH", "EVENT", "ADVERTISING", "OTHER"] as const;

const STATUS_COLOR: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  QUALIFIED: "bg-emerald-100 text-emerald-700",
  UNQUALIFIED: "bg-slate-100 text-slate-600",
  CONVERTED: "bg-purple-100 text-purple-700",
};

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const emptyForm = {
  firstName: "", lastName: "", email: "", phone: "", companyName: "", jobTitle: "",
  estimatedValue: "", source: "OTHER" as const, notes: "",
};

export default function LeadsPage() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const { data: leads = [], isLoading } = trpc.crmLeads.list.useQuery({
    ...(statusFilter !== "ALL" ? { status: statusFilter as typeof STATUSES[number] } : {}),
  });

  const create = trpc.crmLeads.create.useMutation({
    onSuccess: () => { utils.crmLeads.list.invalidate(); setOpen(false); setForm(emptyForm); toast.success("Lead created"); },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.crmLeads.update.useMutation({
    onSuccess: () => { utils.crmLeads.list.invalidate(); toast.success("Status updated"); },
    onError: (e) => toast.error(e.message),
  });

  const convert = trpc.crmLeads.convert.useMutation({
    onSuccess: () => { utils.crmLeads.list.invalidate(); utils.crmDeals.list.invalidate(); setConvertingId(null); toast.success("Lead converted to contact + deal"); },
    onError: (e) => { setConvertingId(null); toast.error(e.message); },
  });

  const del = trpc.crmLeads.delete.useMutation({
    onSuccess: () => { utils.crmLeads.list.invalidate(); toast.success("Lead deleted"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Leads"
        description="Capture and qualify prospective clients."
        action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Lead</Button>}
      />

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {["ALL", ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Leads table */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <UserPlus className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No leads yet</p>
          <p className="text-sm text-muted-foreground">Add leads to start tracking your sales pipeline.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Lead</Button>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Company</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Source</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Value</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                    {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.companyName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.source.replace("_", " ")}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {lead.estimatedValue ? fmt(Number(lead.estimatedValue)) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Select value={lead.status} onValueChange={(v) => updateStatus.mutate({ id: lead.id, status: v as typeof STATUSES[number] })}>
                      <SelectTrigger className="h-6 w-auto border-0 p-0 shadow-none focus:ring-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[lead.status]}`}>{lead.status.replace("_", " ")}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {lead.status === "QUALIFIED" && (
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs"
                          disabled={convertingId === lead.id}
                          onClick={() => { setConvertingId(lead.id); convert.mutate({ id: lead.id }); }}
                        >
                          {convertingId === lead.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ArrowRight className="h-3 w-3 mr-1" />}
                          Convert
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ id: lead.id })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Lead</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>First name <span className="text-destructive">*</span></Label>
                <Input placeholder="Jane" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Last name <span className="text-destructive">*</span></Label>
                <Input placeholder="Doe" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="jane@example.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+1 555 0100" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input placeholder="Acme Corp" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Job title</Label>
                <Input placeholder="CEO" value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Estimated value</Label>
                <Input type="number" min="0" step="100" placeholder="0" value={form.estimatedValue} onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead source</Label>
                <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v as typeof form.source }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="Any context about this lead…" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.firstName || !form.lastName || create.isPending}
              onClick={() => create.mutate({
                firstName: form.firstName, lastName: form.lastName,
                email: form.email || undefined, phone: form.phone || undefined,
                companyName: form.companyName || undefined, jobTitle: form.jobTitle || undefined,
                estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
                source: form.source, notes: form.notes || undefined,
              })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
