"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, ArrowLeft, ArrowRight, Edit2, Save, X,
  Phone, Mail, Building2, Briefcase, DollarSign, Tag, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;

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
    <div className="h-14 w-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-semibold shrink-0 select-none">
      {letters}
    </div>
  );
}

type EditForm = {
  status: (typeof STATUSES)[number];
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  estimatedValue: string;
  notes: string;
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const { data: lead, isLoading } = trpc.crmLeads.get.useQuery({ id });

  const update = trpc.crmLeads.update.useMutation({
    onSuccess: () => {
      utils.crmLeads.get.invalidate({ id });
      setEditing(false);
      setEditForm(null);
      toast.success("Lead updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const convert = trpc.crmLeads.convert.useMutation({
    onSuccess: (data) => {
      utils.crmLeads.get.invalidate({ id });
      toast.success("Converted! Deal created.");
      router.push(`/crm/deals/${data.dealId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = () => {
    if (!lead) return;
    setEditForm({
      status: lead.status as (typeof STATUSES)[number],
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      companyName: lead.companyName ?? "",
      jobTitle: lead.jobTitle ?? "",
      estimatedValue: lead.estimatedValue ? String(Number(lead.estimatedValue)) : "",
      notes: lead.notes ?? "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!editForm) return;
    update.mutate({
      id,
      status: editForm.status,
      email: editForm.email || undefined,
      phone: editForm.phone || undefined,
      companyName: editForm.companyName || undefined,
      jobTitle: editForm.jobTitle || undefined,
      estimatedValue: editForm.estimatedValue ? parseFloat(editForm.estimatedValue) : undefined,
      notes: editForm.notes || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (!lead) return <div className="p-6 text-muted-foreground">Lead not found.</div>;

  const fullName = `${lead.firstName} ${lead.lastName}`;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <Link href="/crm/leads">
        <Button variant="ghost" size="sm" className="self-start">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Leads
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Initials name={fullName} />
          <div>
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {lead.companyName ?? "Individual lead"}
            </p>
            {!editing && (
              <span
                className={`mt-2 inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_STYLE[lead.status]}`}
              >
                {lead.status.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditing(false); setEditForm(null); }}
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" disabled={update.isPending} onClick={saveEdit}>
                {update.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save changes
              </Button>
            </>
          ) : (
            <>
              {lead.status === "QUALIFIED" && !lead.convertedContactId && (
                <Button
                  size="sm"
                  disabled={convert.isPending}
                  onClick={() => convert.mutate({ id: lead.id })}
                >
                  {convert.isPending ? (
                    <Loader2 className="animate-spin h-4 w-4 mr-1" />
                  ) : (
                    <ArrowRight className="h-4 w-4 mr-1" />
                  )}
                  Convert to contact
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Edit2 className="h-4 w-4 mr-1" /> Edit
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Details */}
        <div className="md:col-span-2 rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Lead details
          </h2>

          {editing && editForm ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) =>
                    setEditForm((f) => f ? { ...f, status: v as (typeof STATUSES)[number] } : f)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => f ? { ...f, email: e.target.value } : f)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => f ? { ...f, phone: e.target.value } : f)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Company</Label>
                  <Input
                    value={editForm.companyName}
                    onChange={(e) => setEditForm((f) => f ? { ...f, companyName: e.target.value } : f)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Job title</Label>
                  <Input
                    value={editForm.jobTitle}
                    onChange={(e) => setEditForm((f) => f ? { ...f, jobTitle: e.target.value } : f)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Estimated value ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={editForm.estimatedValue}
                  onChange={(e) =>
                    setEditForm((f) => f ? { ...f, estimatedValue: e.target.value } : f)
                  }
                />
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {[
                { icon: Mail, label: "Email", value: lead.email },
                { icon: Phone, label: "Phone", value: lead.phone },
                { icon: Building2, label: "Company", value: lead.companyName },
                { icon: Briefcase, label: "Job title", value: lead.jobTitle },
                {
                  icon: DollarSign,
                  label: "Est. value",
                  value: lead.estimatedValue
                    ? `$${Number(lead.estimatedValue).toLocaleString()}`
                    : null,
                },
                {
                  icon: Tag,
                  label: "Source",
                  value: lead.source.replace(/_/g, " "),
                },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 py-2.5 text-sm">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                  <span className={value ? "" : "text-muted-foreground/40 italic"}>
                    {value ?? "not set"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes + conversion sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Notes
            </h2>
            {editing && editForm ? (
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[120px]"
                placeholder="Add notes…"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => f ? { ...f, notes: e.target.value } : f)}
              />
            ) : (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {lead.notes || "No notes added."}
              </p>
            )}
          </div>

          {lead.convertedContactId && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700">Converted</p>
              </div>
              {lead.convertedAt && (
                <p className="text-xs text-emerald-600">
                  {new Date(lead.convertedAt).toLocaleDateString()}
                </p>
              )}
              <Link
                href="/contacts"
                className="text-sm text-emerald-700 hover:underline font-medium"
              >
                View contact →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
