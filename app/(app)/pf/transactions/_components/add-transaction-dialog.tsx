"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { CategoryPicker } from "./category-picker";

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddTransactionDialog({
  open,
  onOpenChange,
  onComplete,
}: AddTransactionDialogProps) {
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [category, setCategory] = useState("Other");

  const create = trpc.statementTransactions.create.useMutation({
    onSuccess: () => {
      toast.success("Transaction added");
      onComplete();
      onOpenChange(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });

  function reset() {
    setDate(todayISO());
    setDescription("");
    setAmount("");
    setType("DEBIT");
    setCategory("Other");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!description.trim() || !parsedAmount || parsedAmount <= 0) return;
    create.mutate({
      date,
      description: description.trim(),
      merchantName: description.trim(),
      amount: parsedAmount,
      type,
      category,
    });
  }

  const canSubmit = description.trim().length > 0 && Number(amount) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="fixed !top-auto !right-0 !bottom-0 !left-0 max-h-[90vh] w-full !translate-x-0 !translate-y-0 overflow-y-auto rounded-t-2xl bg-white p-0 sm:!top-[50%] sm:!right-auto sm:!bottom-auto sm:!left-[50%] sm:max-w-md sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:rounded-lg">
        <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
          <DialogHeader>
            <DialogTitle>Add Transaction</DialogTitle>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="txn-date">Date</Label>
              <Input
                id="txn-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="txn-desc">Description</Label>
              <Input
                id="txn-desc"
                placeholder="e.g. Coffee shop"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="txn-amount">Amount</Label>
                <Input
                  id="txn-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="txn-type">Type</Label>
                <div className="flex h-9 overflow-hidden rounded-md border">
                  <button
                    type="button"
                    onClick={() => setType("DEBIT")}
                    className={`flex-1 text-sm font-medium transition-colors ${type === "DEBIT" ? "bg-red-100 text-red-700" : "text-muted-foreground hover:bg-muted bg-transparent"}`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setType("CREDIT")}
                    className={`flex-1 text-sm font-medium transition-colors ${type === "CREDIT" ? "bg-green-100 text-green-700" : "text-muted-foreground hover:bg-muted bg-transparent"}`}
                  >
                    Income
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <div className="rounded-md border px-3 py-2 text-sm">
                <CategoryPicker value={category} onChange={setCategory} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || create.isPending}>
                {create.isPending ? "Adding…" : "Add Transaction"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
