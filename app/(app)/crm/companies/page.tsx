"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Building2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const SIZES = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

const emptyForm = { name: "", industry: "", website: "", phone: "", size: "SMALL" as const };

export default function CompaniesPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: companies = [], isLoading } = trpc.crmCompanies.list.useQuery();

  const create = trpc.crmCompanies.create.useMutation({
    onSuccess: () => { utils.crmCompanies.list.invalidate(); setOpen(false); setForm(emptyForm); toast.success("Company created"); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.crmCompanies.delete.useMutation({
    onSuccess: () => { utils.crmCompanies.list.invalidate(); toast.success("Company deleted"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Companies"
        description="Manage CRM company records."
        action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Company</Button>}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">No companies yet</p>
          <p className="text-sm text-muted-foreground">Create company records to organise your clients.</p>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Company</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((c) => (
            <div key={c.id} className="rounded-xl border bg-card p-5 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/crm/companies/${c.id}`} className="font-semibold hover:underline truncate block">{c.name}</Link>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.industry ?? "—"} · {c.size}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => del.mutate({ id: c.id })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                  {c._count.deals} deal{c._count.deals !== 1 ? "s" : ""}
                </span>
                {c.linkedContact && (
                  <span className="text-xs text-indigo-600 font-medium">{c.linkedContact.name}</span>
                )}
              </div>
              {c.website && (
                <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate">{c.website}</a>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Company</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Company name <span className="text-destructive">*</span></Label>
              <Input placeholder="Acme Corp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Industry</Label>
                <Input placeholder="SaaS" value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Select value={form.size} onValueChange={(v) => setForm((f) => ({ ...f, size: v as typeof form.size }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input placeholder="https://example.com" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+1 555 0100" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || create.isPending}
              onClick={() => create.mutate({ name: form.name, industry: form.industry || undefined, website: form.website || undefined, phone: form.phone || undefined, size: form.size })}
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
