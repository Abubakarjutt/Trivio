"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, UserPlus, ArrowRight, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;
const SOURCES = ["WEBSITE", "REFERRAL", "SOCIAL_MEDIA", "COLD_OUTREACH", "EVENT", "ADVERTISING", "OTHER"] as const;

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700 border-blue-200",
  CONTACTED: "bg-amber-100 text-amber-700 border-amber-200",
  QUALIFIED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  UNQUALIFIED: "bg-slate-100 text-slate-600 border-slate-200",
  CONVERTED: "bg-purple-100 text-purple-700 border-purple-200",
};

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(" ");
  const letters =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold shrink-0 select-none">
      {letters}
    </div>
  );
}

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  estimatedValue: "",
  source: "OTHER" as const,
  notes: "",
};

export default function LeadsPage() {
  const utils = trpc.useUtils();
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";
  const fmt = (n: number) => formatCurrency(n, currency);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const { data: leads = [], isLoading } = trpc.crmLeads.list.useQuery({
    ...(statusFilter !== "ALL" ? { status: statusFilter as (typeof STATUSES)[number] } : {}),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.companyName?.toLowerCase().includes(q),
    );
  }, [leads, search]);

  const create = trpc.crmLeads.create.useMutation({
    onSuccess: () => {
      utils.crmLeads.list.invalidate();
      setOpen(false);
      setForm(emptyForm);
      toast.success("Lead created");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.crmLeads.update.useMutation({
    onSuccess: () => { utils.crmLeads.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const convert = trpc.crmLeads.convert.useMutation({
    onSuccess: () => {
      utils.crmLeads.list.invalidate();
      utils.crmDeals.list.invalidate();
      setConvertingId(null);
      toast.success("Lead converted to contact + deal");
    },
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
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Lead
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search name, email or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["ALL", ...STATUSES] as string[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {s === "ALL" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <UserPlus className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">
            {search ? "No leads match your search" : "No leads yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {search
              ? "Try a different search term."
              : "Add leads to start tracking your sales pipeline."}
          </p>
          {!search && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Lead
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Lead</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Company</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Source</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Value</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <Link href={`/crm/leads/${lead.id}`} className="flex items-center gap-3">
                      <Initials name={`${lead.firstName} ${lead.lastName}`} />
                      <div className="min-w-0">
                        <p className="font-medium group-hover:text-primary transition-colors">
                          {lead.firstName} {lead.lastName}
                        </p>
                        {lead.email && (
                          <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {lead.companyName ? (
                      <div>
                        <p className="text-muted-foreground">{lead.companyName}</p>
                        {lead.jobTitle && (
                          <p className="text-xs text-muted-foreground/70">{lead.jobTitle}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {lead.source.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                    {lead.estimatedValue ? (
                      <span className="font-medium">{fmt(Number(lead.estimatedValue))}</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={lead.status}
                      onValueChange={(v) =>
                        updateStatus.mutate({ id: lead.id, status: v as (typeof STATUSES)[number] })
                      }
                    >
                      <SelectTrigger className="h-7 w-auto border-0 p-0 shadow-none focus:ring-0 bg-transparent">
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLE[lead.status]}`}
                        >
                          {lead.status.replace(/_/g, " ")}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {lead.status === "QUALIFIED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={convertingId === lead.id}
                          onClick={() => {
                            setConvertingId(lead.id);
                            convert.mutate({ id: lead.id });
                          }}
                        >
                          {convertingId === lead.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <ArrowRight className="h-3 w-3 mr-1" />
                          )}
                          Convert
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => del.mutate({ id: lead.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
            {filtered.length !== leads.length && ` (of ${leads.length})`}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  First name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="Jane"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Last name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="Doe"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="jane@example.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  placeholder="+1 555 0100"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input
                  placeholder="Acme Corp"
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Job title</Label>
                <Input
                  placeholder="CEO"
                  value={form.jobTitle}
                  onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Estimated value</Label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  placeholder="0"
                  value={form.estimatedValue}
                  onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lead source</Label>
                <Select
                  value={form.source}
                  onValueChange={(v) => setForm((f) => ({ ...f, source: v as typeof form.source }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[80px]"
                placeholder="Any context about this lead…"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.firstName || !form.lastName || create.isPending}
              onClick={() =>
                create.mutate({
                  firstName: form.firstName,
                  lastName: form.lastName,
                  email: form.email || undefined,
                  phone: form.phone || undefined,
                  companyName: form.companyName || undefined,
                  jobTitle: form.jobTitle || undefined,
                  estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
                  source: form.source,
                  notes: form.notes || undefined,
                })
              }
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
