"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Category rules</CardTitle>
        <CardDescription>
          Categories Trivio remembers for a transfer recipient or merchant. Changes apply to future imports only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && rules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. When you pick a category for an imported transaction and keep &quot;Always use…&quot; ticked, it appears here.
          </p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">
                {r.kind === "COUNTERPARTY" ? "Transfer" : "Merchant"} · used {r.timesApplied} time{r.timesApplied === 1 ? "" : "s"}
                {r.lastAppliedAt ? ` · last ${new Date(r.lastAppliedAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CategoryPicker value={r.category} onChange={(c) => update.mutate({ id: r.id, category: c })}
                triggerClassName="h-7 px-2 text-xs rounded-full bg-muted" />
              <button type="button" aria-label={`Delete rule for ${r.label}`} disabled={remove.isPending}
                onClick={() => remove.mutate({ id: r.id })} className="text-muted-foreground hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
