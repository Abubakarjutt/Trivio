"use client";

import { Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { CategoryPicker } from "../../pf/transactions/_components/category-picker";

export function CategoryRulesCard() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.categoryRules.list.useQuery();
  const update = trpc.categoryRules.update.useMutation({
    onSuccess: () => void utils.categoryRules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.categoryRules.delete.useMutation({
    onSuccess: () => void utils.categoryRules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="bg-card shadow-card border-border/40 space-y-4 rounded-2xl border p-6">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
          <Tags className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Category rules</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Categories Trivio remembers for a transfer recipient or merchant. Changes apply to
            future imports only.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
        {!isLoading && rules.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No rules yet. When you pick a category for an imported transaction and keep &quot;Always
            use…&quot; ticked, it appears here.
          </p>
        )}
        {rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{r.label}</p>
              <p className="text-muted-foreground text-xs">
                {r.kind === "COUNTERPARTY" ? "Transfer" : "Merchant"} · used {r.timesApplied} time
                {r.timesApplied === 1 ? "" : "s"}
                {r.lastAppliedAt ? ` · last ${new Date(r.lastAppliedAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CategoryPicker
                value={r.category}
                onChange={(c) => update.mutate({ id: r.id, category: c })}
                triggerClassName="h-7 px-2 text-xs rounded-full bg-muted"
              />
              <button
                type="button"
                aria-label={`Delete rule for ${r.label}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: r.id })}
                className="text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
