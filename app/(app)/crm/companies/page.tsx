"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Building2, Trash2, Search, Globe, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const SIZES = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

const SIZE_STYLE: Record<string, string> = {
  SOLO: "bg-slate-100 text-slate-600",
  SMALL: "bg-blue-100 text-blue-700",
  MEDIUM: "bg-indigo-100 text-indigo-700",
  LARGE: "bg-violet-100 text-violet-700",
  ENTERPRISE: "bg-purple-100 text-purple-700",
};

function Initials({ name }: { name: string }) {
  const words = name.trim().split(/\s+/);
  const letters =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0 select-none">
      {letters}
    </div>
  );
}

const emptyForm = {
  name: "",
  industry: "",
  website: "",
  phone: "",
  size: "SMALL" as (typeof SIZES)[number],
};

export default function CompaniesPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const { data: companies = [], isLoading } = trpc.crmCompanies.list.useQuery();

  const filtered = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q),
    );
  }, [companies, search]);

  const create = trpc.crmCompanies.create.useMutation({
    onSuccess: () => {
      utils.crmCompanies.list.invalidate();
      setOpen(false);
      setForm(emptyForm);
      toast.success("Company created");
    },
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
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Company
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Search name or industry…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium">
            {search ? "No companies match your search" : "No companies yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {search
              ? "Try a different search term."
              : "Create company records to organise your clients."}
          </p>
          {!search && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Company
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Company</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Industry</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Size</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Contact</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Deals</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Website</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <Link href={`/crm/companies/${c.id}`} className="flex items-center gap-3">
                      <Initials name={c.name} />
                      <span className="font-medium group-hover:text-primary transition-colors">
                        {c.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {c.industry ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${SIZE_STYLE[c.size]}`}
                    >
                      {c.size}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {c.linkedContact ? (
                      <span className="text-indigo-600 font-medium">{c.linkedContact.name}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                      {c._count.deals}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    {c.website ? (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Globe className="h-3 w-3" />
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => del.mutate({ id: c.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {filtered.length} compan{filtered.length !== 1 ? "ies" : "y"}
            {filtered.length !== companies.length && ` (of ${companies.length})`}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Company name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Acme Corp"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Industry</Label>
                <Input
                  placeholder="SaaS"
                  value={form.industry}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Select
                  value={form.size}
                  onValueChange={(v) => setForm((f) => ({ ...f, size: v as typeof form.size }))}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input
                  placeholder="https://example.com"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.name || create.isPending}
              onClick={() =>
                create.mutate({
                  name: form.name,
                  industry: form.industry || undefined,
                  website: form.website || undefined,
                  phone: form.phone || undefined,
                  size: form.size,
                })
              }
            >
              {create.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
