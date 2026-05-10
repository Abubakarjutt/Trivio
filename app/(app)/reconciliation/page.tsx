"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Landmark, Plus, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

function AddBankAccountDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [chartAccountId, setChartAccountId] = useState("");

  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");

  const create = trpc.bankAccounts.create.useMutation({
    onSuccess: () => {
      toast({ title: "Bank account added" });
      setOpen(false);
      setName("");
      setChartAccountId("");
      onCreated();
    },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add Bank Account
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bank Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input
                placeholder="e.g. Business Checking"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Chart of Accounts — Asset account</Label>
              <Select value={chartAccountId} onValueChange={setChartAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an asset account…" />
                </SelectTrigger>
                <SelectContent>
                  {assetAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only ASSET accounts are shown. This links the bank account to your ledger.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name || !chartAccountId || create.isPending}
              onClick={() => create.mutate({ name, chartAccountId })}
            >
              {create.isPending && <Loader2 className="animate-spin" />} Add Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ReconciliationPage() {
  const { data: org } = trpc.org.get.useQuery();
  const { data: bankAccounts, refetch, isLoading } = trpc.bankAccounts.list.useQuery();
  const currency = org?.currency ?? "USD";

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif text-foreground">Reconciliation</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Match bank statement lines to your ledger
            </p>
          </div>
          <AddBankAccountDialog onCreated={() => refetch()} />
        </div>
      </div>

      <div className="p-8 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && bankAccounts?.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Landmark className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No bank accounts yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a bank account to start reconciling your transactions.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bankAccounts?.map((account) => {
            const unmatchedCount = account._count.statementLines;
            return (
              <Link
                key={account.id}
                href={`/reconciliation/${account.id}`}
                className="block"
              >
                <Card className="rounded-2xl border border-border/40 shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                          <Landmark className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground leading-tight">
                            {account.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {account.chartAccount.code} — {account.chartAccount.name}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 mt-1 group-hover:text-muted-foreground transition-colors" />
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/40 flex items-end justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                          Balance
                        </p>
                        <p className="font-mono tabular-nums font-semibold text-foreground mt-0.5">
                          {formatCurrency(Number(account.currentBalance), currency)}
                        </p>
                      </div>

                      {unmatchedCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 ring-1 ring-amber-100 text-xs font-medium px-2.5 py-1 rounded-full">
                          <AlertCircle className="h-3 w-3" />
                          {unmatchedCount} unmatched
                        </span>
                      ) : (
                        <span className="inline-flex items-center bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 text-xs font-medium px-2.5 py-1 rounded-full">
                          Reconciled
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
