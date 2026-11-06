"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/utils";

const POLL_MS = 60_000;

// Bottom-right stack of SMS transaction notifications. The × (top-left) is the
// only way one goes away — approving, dismissing or restarting leaves it.
export function SmsNotifications() {
  const utils = trpc.useUtils();
  const { data: source } = trpc.smsImport.getSource.useQuery(undefined, { staleTime: 5 * 60_000 });
  const supported = source?.platformSupported ?? false;
  const { data: org } = trpc.org.get.useQuery(undefined, { staleTime: 60_000, enabled: supported });
  const { data: items = [] } = trpc.smsImport.notifications.useQuery(undefined, {
    enabled: supported,
    refetchInterval: POLL_MS,
  });
  const close = trpc.smsImport.closeNotification.useMutation({
    onMutate: async ({ id }) => {
      await utils.smsImport.notifications.cancel();
      utils.smsImport.notifications.setData(undefined, (old) => old?.filter((n) => n.id !== id));
    },
    onError: (e) => toast.error(e.message || "Could not close the notification"),
    // Success or failure, refetch: a failed close brings the card back.
    onSettled: () => void utils.smsImport.notifications.invalidate(),
  });
  if (!supported || items.length === 0) return null;
  const fmt = (n: number) => formatCurrency(n, org?.currency ?? "USD");

  return (
    <div
      className="fixed right-6 bottom-24 z-40 flex max-h-[min(28rem,70vh)] w-80 flex-col gap-2 overflow-y-auto"
      aria-live="polite"
    >
      {items.map((n) => {
        const body = n.flagged
          ? `${fmt(n.amount)} · ${n.counterpartyLabel ?? n.merchantName} — where did this go?`
          : n.ruleApplied
            ? `${fmt(n.amount)} · ${n.category} (remembered)`
            : `${fmt(n.amount)} · ${n.merchantName} · ${n.type === "DEBIT" ? "Debit" : "Credit"}`;
        return (
          <div
            key={n.id}
            className="border-border bg-background text-foreground relative shrink-0 rounded-xl border p-3 pl-9 text-sm shadow-lg"
          >
            <button
              type="button"
              aria-label="Close notification"
              onClick={() => close.mutate({ id: n.id })}
              className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2 left-2 rounded p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="font-medium">📱 New SMS transaction</p>
            <p className="text-muted-foreground">{body}</p>
            {n.extraRows > 0 && (
              <p className="text-muted-foreground text-xs">and {n.extraRows} more</p>
            )}
            <Link
              href="/pf/transactions?smsReview=1"
              className="text-primary mt-1 inline-block text-xs font-semibold hover:underline"
            >
              Review →
            </Link>
          </div>
        );
      })}
    </div>
  );
}
