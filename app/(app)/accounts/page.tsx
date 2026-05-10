"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MoreHorizontal, Loader2, Archive, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expense",
};
const TYPE_COLORS: Record<AccountType, string> = {
  ASSET: "bg-blue-100 text-blue-800", LIABILITY: "bg-red-100 text-red-800",
  EQUITY: "bg-purple-100 text-purple-800", INCOME: "bg-green-100 text-green-800",
  EXPENSE: "bg-orange-100 text-orange-800",
};
const NORMAL_BALANCE_DEFAULT: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT", EXPENSE: "DEBIT", LIABILITY: "CREDIT", EQUITY: "CREDIT", INCOME: "CREDIT",
};

function CreateAccountDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "", name: "", type: "EXPENSE" as AccountType, normalBalance: "DEBIT" as "DEBIT" | "CREDIT", description: "",
  });

  const create = trpc.accounts.create.useMutation({
    onSuccess: () => {
      toast({ title: "Account created" });
      setOpen(false);
      setForm({ code: "", name: "", type: "EXPENSE", normalBalance: "DEBIT", description: "" });
      onCreated();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input placeholder="e.g. 5100" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as AccountType, normalBalance: NORMAL_BALANCE_DEFAULT[v as AccountType] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="e.g. Marketing Expenses" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Normal balance</Label>
            <Select value={form.normalBalance} onValueChange={(v) => setForm((f) => ({ ...f, normalBalance: v as "DEBIT" | "CREDIT" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DEBIT">Debit (Assets, Expenses)</SelectItem>
                <SelectItem value="CREDIT">Credit (Liabilities, Equity, Income)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.code || !form.name || create.isPending} onClick={() => create.mutate({ code: form.code, name: form.name, type: form.type, normalBalance: form.normalBalance, description: form.description || undefined })}>
            {create.isPending && <Loader2 className="animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountDialog({ account, onUpdated }: { account: { id: string; name: string; description?: string | null; isSystem: boolean }; onUpdated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: account.name, description: account.description ?? "" });

  const update = trpc.accounts.update.useMutation({
    onSuccess: () => { toast({ title: "Account updated" }); setOpen(false); onUpdated(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Account</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.name || update.isPending} onClick={() => update.mutate({ id: account.id, name: form.name, description: form.description || undefined })}>
            {update.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountsPage() {
  const { toast } = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts, refetch } = trpc.accounts.list.useQuery({ includeArchived: showArchived });

  const archive = trpc.accounts.archive.useMutation({
    onSuccess: (_, vars) => { toast({ title: vars.archive ? "Account archived" : "Account restored" }); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const grouped = (accounts ?? []).reduce<Record<AccountType, typeof accounts>>((acc, a) => {
    const type = a.type as AccountType;
    if (!acc[type]) acc[type] = [];
    acc[type]!.push(a);
    return acc;
  }, {} as Record<AccountType, typeof accounts>);

  return (
    <div className="min-h-full">
      <div className="border-b border-border/60 bg-white/60 backdrop-blur-sm px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif text-foreground">Chart of Accounts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your account categories</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            <CreateAccountDialog onCreated={() => refetch()} />
          </div>
        </div>
      </div>
      <div className="p-8 space-y-5">

      {ACCOUNT_TYPES.map((type) => {
        const rows = grouped[type] ?? [];
        if (rows.length === 0) return null;
        return (
          <Card key={type}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TYPE_COLORS[type])}>{TYPE_LABELS[type]}</span>
                <span className="text-muted-foreground font-normal text-sm">{rows.length} accounts</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Normal Balance</TableHead>
                    <TableHead className="hidden lg:table-cell">Description</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((account) => (
                    <TableRow key={account.id} className={account.isArchived ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-sm">{account.code}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {account.parent && <span className="text-muted-foreground text-xs">↳</span>}
                          <span className="font-medium">{account.name}</span>
                          {account.isSystem && <Badge variant="secondary" className="text-xs py-0">System</Badge>}
                          {account.isArchived && <Badge variant="outline" className="text-xs py-0">Archived</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm capitalize">
                        {account.normalBalance.toLowerCase()}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm truncate max-w-xs">
                        {account.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!account.isSystem && (
                              <EditAccountDialog
                                account={{ id: account.id, name: account.name, description: account.description, isSystem: account.isSystem }}
                                onUpdated={() => refetch()}
                              />
                            )}
                            {!account.isSystem && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => archive.mutate({ id: account.id, archive: !account.isArchived })}
                              >
                                <Archive className="mr-2 h-3.5 w-3.5" />
                                {account.isArchived ? "Restore" : "Archive"}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
