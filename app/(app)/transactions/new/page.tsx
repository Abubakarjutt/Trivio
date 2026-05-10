"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

function AccountSelect({
  label, value, onChange, accounts, filterTypes, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: { id: string; code: string; name: string; type: string }[];
  filterTypes: string[];
  placeholder?: string;
}) {
  const filtered = accounts.filter((a) => filterTypes.includes(a.type));
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? "Select account..."} />
        </SelectTrigger>
        <SelectContent>
          {filtered.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.code} — {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function NewTransactionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const defaultType = searchParams.get("type") === "income" ? "income" : "expense";

  const { data: accounts = [] } = trpc.accounts.listFlat.useQuery();
  const { data: org } = trpc.org.get.useQuery();

  const [tab, setTab] = useState<"income" | "expense">(defaultType);
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    description: "",
    reference: "",
    amount: "",
    taxAmount: "",
    primaryAccountId: "",
    cashAccountId: "",
    taxAccountId: "",
  });

  // Default cash account to first asset account
  useEffect(() => {
    if (accounts.length > 0 && !form.cashAccountId) {
      const cashAcct = accounts.find((a) => a.type === "ASSET" && a.code === "1100");
      if (cashAcct) setForm((f) => ({ ...f, cashAccountId: cashAcct.id }));
    }
  }, [accounts, form.cashAccountId]);

  const createIncome = trpc.transactions.createIncome.useMutation({
    onSuccess: () => { toast({ title: "Income recorded" }); router.push("/transactions"); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const createExpense = trpc.transactions.createExpense.useMutation({
    onSuccess: () => { toast({ title: "Expense recorded" }); router.push("/transactions"); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    const taxAmount = form.taxAmount ? parseFloat(form.taxAmount) : undefined;

    if (tab === "income") {
      createIncome.mutate({
        date: new Date(form.date),
        description: form.description,
        reference: form.reference || undefined,
        amount,
        incomeAccountId: form.primaryAccountId,
        cashAccountId: form.cashAccountId,
        taxAmount,
        taxAccountId: taxAmount && form.taxAccountId ? form.taxAccountId : undefined,
      });
    } else {
      createExpense.mutate({
        date: new Date(form.date),
        description: form.description,
        reference: form.reference || undefined,
        amount,
        expenseAccountId: form.primaryAccountId,
        cashAccountId: form.cashAccountId,
        taxAmount,
        taxAccountId: taxAmount && form.taxAccountId ? form.taxAccountId : undefined,
      });
    }
  };

  const isPending = createIncome.isPending || createExpense.isPending;
  const taxAccount = accounts.find((a) => a.code === "2200");

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/transactions"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Transaction</h1>
          <p className="text-muted-foreground text-sm">Record income or an expense</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as "income" | "expense"); setForm((f) => ({ ...f, primaryAccountId: "" })); }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="income" className="gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" /> Income
          </TabsTrigger>
          <TabsTrigger value="expense" className="gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" /> Expense
          </TabsTrigger>
        </TabsList>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">
              {tab === "income" ? "Record Income" : "Record Expense"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount ({org?.currency ?? "USD"})</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder={tab === "income" ? "e.g. Invoice payment from Client A" : "e.g. Office supplies from Staples"}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reference">Reference / Invoice # <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="reference"
                  placeholder="e.g. INV-001"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                />
              </div>

              <TabsContent value="income" className="mt-0">
                <AccountSelect
                  label="Income account"
                  value={form.primaryAccountId}
                  onChange={(v) => setForm((f) => ({ ...f, primaryAccountId: v }))}
                  accounts={accounts}
                  filterTypes={["INCOME"]}
                  placeholder="Select income account..."
                />
              </TabsContent>
              <TabsContent value="expense" className="mt-0">
                <AccountSelect
                  label="Expense account"
                  value={form.primaryAccountId}
                  onChange={(v) => setForm((f) => ({ ...f, primaryAccountId: v }))}
                  accounts={accounts}
                  filterTypes={["EXPENSE"]}
                  placeholder="Select expense account..."
                />
              </TabsContent>

              <AccountSelect
                label={tab === "income" ? "Received into (bank/cash account)" : "Paid from (bank/cash account)"}
                value={form.cashAccountId}
                onChange={(v) => setForm((f) => ({ ...f, cashAccountId: v }))}
                accounts={accounts}
                filterTypes={["ASSET", "LIABILITY"]}
              />

              {org?.taxRegime && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
                  <p className="text-sm font-medium">Tax ({org.taxRegime.name})</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Tax amount <span className="text-muted-foreground">(optional)</span></Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={form.taxAmount}
                        onChange={(e) => setForm((f) => ({ ...f, taxAmount: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tax account</Label>
                      <Select
                        value={form.taxAccountId || taxAccount?.id || ""}
                        onValueChange={(v) => setForm((f) => ({ ...f, taxAccountId: v }))}
                      >
                        <SelectTrigger><SelectValue placeholder="Tax payable account..." /></SelectTrigger>
                        <SelectContent>
                          {accounts.filter((a) => a.type === "LIABILITY").map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={!form.primaryAccountId || !form.cashAccountId || !form.amount || isPending} className="flex-1">
                  {isPending && <Loader2 className="animate-spin" />}
                  {tab === "income" ? "Record income" : "Record expense"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
