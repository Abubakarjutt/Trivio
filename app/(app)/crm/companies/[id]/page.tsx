"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, ArrowLeft, Globe, Phone, Edit2, Save, X,
  Building2, Handshake, Phone as PhoneIcon, StickyNote,
  Mail, Users, ClipboardCheck,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const SIZES = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: PhoneIcon,
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
  industry: string;
  website: string;
  phone: string;
  size: (typeof SIZES)[number];
  notes: string;
};

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const { data: company, isLoading } = trpc.crmCompanies.get.useQuery({ id });

  const update = trpc.crmCompanies.update.useMutation({
    onSuccess: () => {
      utils.crmCompanies.get.invalidate({ id });
      setEditing(false);
      setEditForm(null);
      toast.success("Company updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = () => {
    if (!company) return;
    setEditForm({
      name: company.name,
      industry: company.industry ?? "",
      website: company.website ?? "",
      phone: company.phone ?? "",
      size: company.size as (typeof SIZES)[number],
      notes: company.notes ?? "",
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
  if (!company) return <div className="p-6 text-muted-foreground">Company not found.</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/crm/companies">
        <Button variant="ghost" size="sm" className="self-start">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Companies
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{company.name}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {company.industry ?? "Company"} · {company.size}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditing(false); setEditForm(null); }}
              >
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
                    industry: editForm.industry || undefined,
                    website: editForm.website || undefined,
                    phone: editForm.phone || undefined,
                    size: editForm.size,
                    notes: editForm.notes || undefined,
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
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Edit2 className="h-4 w-4 mr-1" /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Company details */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Details
          </h2>
          {editing && editForm ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Company name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => f ? { ...f, name: e.target.value } : f)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Input
                    value={editForm.industry}
                    onChange={(e) => setEditForm((f) => f ? { ...f, industry: e.target.value } : f)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Select
                    value={editForm.size}
                    onValueChange={(v) =>
                      setEditForm((f) => f ? { ...f, size: v as (typeof SIZES)[number] } : f)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input
                  placeholder="https://example.com"
                  value={editForm.website}
                  onChange={(e) => setEditForm((f) => f ? { ...f, website: e.target.value } : f)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => f ? { ...f, phone: e.target.value } : f)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[80px]"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => f ? { ...f, notes: e.target.value } : f)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Globe className="h-4 w-4 shrink-0" />
                  <span className="truncate">{company.website}</span>
                </a>
              )}
              {company.phone && (
                <p className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  {company.phone}
                </p>
              )}
              {company.linkedContact && (
                <div className="pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-1.5 font-medium">Linked contact</p>
                  <p className="text-sm font-medium">{company.linkedContact.name}</p>
                  {company.linkedContact.email && (
                    <p className="text-xs text-muted-foreground">{company.linkedContact.email}</p>
                  )}
                </div>
              )}
              {company.notes && (
                <div className="pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-1.5 font-medium">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{company.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Deals */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Deals ({company.deals.length})
            </h2>
          </div>
          {company.deals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No deals associated.
            </p>
          ) : (
            <div className="space-y-1.5">
              {company.deals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/crm/deals/${deal.id}`}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {deal.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{deal.stage.name}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">
                    ${Number(deal.value).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Activities */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Recent activities ({company.activities.length})
          </h2>
          {company.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No activities logged.
            </p>
          ) : (
            <div className="space-y-2">
              {company.activities.slice(0, 8).map((a) => {
                const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                return (
                  <div key={a.id} className="flex items-start gap-2.5 py-1">
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${ACTIVITY_COLOR[a.type]}`}
                    >
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleDateString()}
                        {a.completedAt && " · ✓"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
