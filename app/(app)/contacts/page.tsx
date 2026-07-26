"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, MoreHorizontal, Pencil, Archive, Loader2, Users } from "lucide-react";

type ContactType = "CUSTOMER" | "SUPPLIER" | "BOTH";

const TYPE_COLORS: Record<ContactType, string> = {
  CUSTOMER: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  SUPPLIER: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  BOTH: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
};

const TYPE_LABELS: Record<ContactType, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Customer & Supplier",
};

function ContactForm({ initial, onSave, onCancel, loading }: {
  initial?: { type: string; name: string; email: string; phone: string; address: string; taxNumber: string };
  onSave: (data: { type: ContactType; name: string; email: string; phone: string; address: string; taxNumber: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    type: (initial?.type ?? "CUSTOMER") as ContactType,
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    address: initial?.address ?? "",
    taxNumber: initial?.taxNumber ?? "",
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label>Type</Label>
          <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v as ContactType }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CUSTOMER">Customer</SelectItem>
              <SelectItem value="SUPPLIER">Supplier</SelectItem>
              <SelectItem value="BOTH">Customer & Supplier</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label>Name *</Label>
          <Input placeholder="Business or person name" value={form.name} onChange={f("name")} required />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" placeholder="contact@example.com" value={form.email} onChange={f("email")} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input placeholder="+1 555 000 0000" value={form.phone} onChange={f("phone")} />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label>Address</Label>
          <Input placeholder="Street, City, Country" value={form.address} onChange={f("address")} />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label>Tax / VAT number</Label>
          <Input placeholder="e.g. GB123456789" value={form.taxNumber} onChange={f("taxNumber")} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={!form.name || loading} onClick={() => onSave(form)}>
          {loading && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function ContactsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"all" | "CUSTOMER" | "SUPPLIER">("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; type: string; name: string; email: string; phone: string; address: string; taxNumber: string } | null>(null);

  const { data: contacts = [], refetch } = trpc.contacts.list.useQuery({ type: tab, search: search || undefined });

  const create = trpc.contacts.create.useMutation({
    onSuccess: () => { toast({ title: "Contact created" }); setCreateOpen(false); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const update = trpc.contacts.update.useMutation({
    onSuccess: () => { toast({ title: "Contact updated" }); setEditTarget(null); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const archive = trpc.contacts.archive.useMutation({
    onSuccess: (_, v) => { toast({ title: v.archive ? "Contact archived" : "Contact restored" }); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border/40 backdrop-blur-sm bg-background/95 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Contacts</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Customers and suppliers</p>
          </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" /> New Contact</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Contact</DialogTitle></DialogHeader>
            <ContactForm
              onSave={(data) => create.mutate(data)}
              onCancel={() => setCreateOpen(false)}
              loading={create.isPending}
            />
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <div className="p-8 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="CUSTOMER">Customers</TabsTrigger>
            <TabsTrigger value="SUPPLIER">Suppliers</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell">Phone</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Invoices</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="h-8 w-8" />
                      <p>No contacts yet. <button onClick={() => setCreateOpen(true)} className="text-primary hover:underline">Add one</button></p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[c.type as ContactType]}`}>
                      {TYPE_LABELS[c.type as ContactType]}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground text-sm">{c.email ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">{c._count.invoices}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditTarget({ id: c.id, type: c.type, name: c.name, email: c.email ?? "", phone: c.phone ?? "", address: c.address ?? "", taxNumber: c.taxNumber ?? "" })}>
                          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => archive.mutate({ id: c.id, archive: !c.isArchived })}>
                          <Archive className="mr-2 h-3.5 w-3.5" /> {c.isArchived ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          {editTarget && (
            <ContactForm
              initial={editTarget}
              onSave={(data) => update.mutate({ id: editTarget.id, ...data })}
              onCancel={() => setEditTarget(null)}
              loading={update.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
