"use client";

import { trpc } from "@/lib/trpc/client";

export function NeedsCategoryBanner({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const { data: count = 0 } = trpc.statementTransactions.needsCategoryCount.useQuery();
  if (count === 0 && !active) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
    >
      <span>
        {count} transaction{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a category
      </span>
      <span className="font-semibold">{active ? "Show all" : "Show them"}</span>
    </button>
  );
}
