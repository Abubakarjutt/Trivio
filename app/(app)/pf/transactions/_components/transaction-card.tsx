"use client";

import { Trash2 } from "lucide-react";
import { CategoryPicker } from "./category-picker";

const AVATAR_BG: Record<string, string> = {
  "Food & Dining":     "bg-violet-100 text-violet-600",
  "Transport":         "bg-sky-100 text-sky-600",
  "Shopping":          "bg-amber-100 text-amber-600",
  "Entertainment":     "bg-pink-100 text-pink-600",
  "Health & Fitness":  "bg-emerald-100 text-emerald-600",
  "Utilities":         "bg-yellow-100 text-yellow-600",
  "Travel":            "bg-cyan-100 text-cyan-600",
  "Housing":           "bg-orange-100 text-orange-600",
  "Education":         "bg-indigo-100 text-indigo-600",
  "Personal Care":     "bg-fuchsia-100 text-fuchsia-600",
  "Business Services": "bg-slate-100 text-slate-600",
  "Financial":         "bg-teal-100 text-teal-600",
  "Income":            "bg-green-100 text-green-600",
  "Transfer":          "bg-blue-100 text-blue-600",
  "Other":             "bg-gray-100 text-gray-600",
};

interface Txn {
  id: string;
  date: string | Date;
  merchantName: string;
  description: string | null;
  category: string;
  type: "DEBIT" | "CREDIT";
  amount: number;
}

interface Props {
  txn: Txn;
  onCategoryChange: (id: string, category: string) => void;
  onDelete: (id: string) => void;
  fmt: (n: number) => string;
}

export function TransactionCard({ txn, onCategoryChange, onDelete, fmt }: Props) {
  const avatarClasses = AVATAR_BG[txn.category] ?? AVATAR_BG["Other"];
  const initial = txn.merchantName.charAt(0).toUpperCase();
  const dateStr = new Date(txn.date).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClasses}`}>
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{txn.merchantName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">{dateStr}</span>
          <CategoryPicker
            value={txn.category}
            onChange={(cat) => onCategoryChange(txn.id, cat)}
            triggerClassName="text-xs text-muted-foreground hover:text-foreground transition-colors"
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-sm font-semibold tabular-nums ${txn.type === "DEBIT" ? "text-red-500" : "text-emerald-500"}`}>
          {txn.type === "DEBIT" ? "−" : "+"}{fmt(txn.amount)}
        </span>
        <button
          aria-label="Delete transaction"
          onClick={() => {
            if (confirm("Delete this transaction? This cannot be undone.")) {
              onDelete(txn.id);
            }
          }}
          className="text-muted-foreground/40 hover:text-red-500 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
