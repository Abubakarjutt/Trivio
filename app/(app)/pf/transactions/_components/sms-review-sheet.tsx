"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import type { ParsedSmsTransaction } from "@/server/services/sms/sms-import.service";
import { CategoryPicker } from "./category-picker";

const POLL_MS = 60_000;

export function SmsReviewBanner() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("smsReview") !== "1") return;
    setOpen(true);
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("smsReview");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);
  const { data: count = 0 } = trpc.smsImport.pendingCount.useQuery(undefined, {
    refetchInterval: POLL_MS,
  });
  if (count === 0 && !open) return null;
  return (
    <>
      {count > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm text-blue-800 hover:bg-blue-100"
        >
          <span>
            📱 {count} transaction{count === 1 ? "" : "s"} from SMS to review
          </span>
          <span className="font-semibold">Review</span>
        </button>
      )}
      <SmsReviewSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function SmsReviewSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pending = trpc.smsImport.listItems.useQuery(
    { statuses: ["PENDING_REVIEW"] },
    { enabled: open }
  );
  const skipped = trpc.smsImport.listItems.useQuery(
    { statuses: ["NO_TRANSACTION", "FAILED"] },
    { enabled: open }
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const seen = useRef(new Set<string>());
  // Per-item working copy of the parsed rows. Edits apply to the draft and the
  // whole draft is saved, serialised per item, so quick successive edits never
  // overwrite each other with a stale snapshot.
  const drafts = useRef(new Map<string, ParsedSmsTransaction[]>());
  const chains = useRef(new Map<string, Promise<unknown>>());
  const inflight = useRef(new Map<string, number>());
  const failed = useRef(new Set<string>());
  // Bumped when a save fails; part of the card key, so its uncontrolled inputs
  // remount showing the server's value instead of the edit that didn't stick.
  const [revisions, setRevisions] = useState<Record<string, number>>({});

  // Reseed drafts from the server only for items with no unsaved/in-flight edits.
  useEffect(() => {
    for (const item of pending.data ?? []) {
      if (!inflight.current.get(item.id)) drafts.current.set(item.id, item.parsed);
    }
    rerender();
  }, [pending.data]);

  // New items start selected unless they look like duplicates. Refetches after
  // an edit keep whatever the user ticked or unticked.
  useEffect(() => {
    const items = pending.data;
    if (!items) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => items.some((i) => i.id === id)));
      for (const item of items) {
        if (seen.current.has(item.id)) continue;
        seen.current.add(item.id);
        if (!item.parsed.some((p) => p.possibleDuplicate)) next.add(item.id);
      }
      return next;
    });
  }, [pending.data]);

  const refresh = async () => {
    await Promise.all([
      utils.smsImport.listItems.invalidate(),
      utils.smsImport.pendingCount.invalidate(),
      utils.smsImport.notifications.invalidate(),
      utils.statementTransactions.list.invalidate(),
      utils.statementTransactions.needsCategoryCount.invalidate(),
    ]);
  };
  const update = trpc.smsImport.updateItem.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const approve = trpc.smsImport.approve.useMutation({
    onSuccess: (r) => {
      if (r.transactions === 0) toast.info("Nothing new to add");
      else toast.success(`Added ${r.transactions} transaction${r.transactions === 1 ? "" : "s"}`);
      const also = [
        r.alsoAppliedTo > 0 && `${r.alsoAppliedTo} other SMS`,
        r.alsoAppliedToSaved > 0 &&
          `${r.alsoAppliedToSaved} saved transaction${r.alsoAppliedToSaved === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (also.length > 0) toast.info(`Also applied to ${also.join(" and ")}`);
      void refresh();
    },
    onError: (e) => {
      toast.error(e.message);
      void refresh();
    },
  });
  const dismiss = trpc.smsImport.dismiss.useMutation({
    onSuccess: () => void refresh(),
    onError: (e) => {
      toast.error(e.message);
      void refresh();
    },
  });
  const retry = trpc.smsImport.retry.useMutation({
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(e.message),
  });

  const busy = approve.isPending || dismiss.isPending;
  const ids = [...selected];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const editRow = (
    item: { id: string; parsed: ParsedSmsTransaction[] },
    index: number,
    patch: Partial<ParsedSmsTransaction>
  ) => {
    const id = item.id;
    const rows = (drafts.current.get(id) ?? item.parsed).map((r, i) =>
      i === index ? { ...r, ...patch } : r
    );
    drafts.current.set(id, rows);
    rerender();
    inflight.current.set(id, (inflight.current.get(id) ?? 0) + 1);
    const run = (chains.current.get(id) ?? Promise.resolve())
      .then(() => update.mutateAsync({ id, parsed: rows }))
      .catch(() => {
        failed.current.add(id);
        drafts.current.delete(id);
        setRevisions((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
      })
      .finally(() => {
        const left = (inflight.current.get(id) ?? 1) - 1;
        inflight.current.set(id, left);
        if (left === 0) {
          if (failed.current.has(id)) drafts.current.delete(id);
          void utils.smsImport.listItems.invalidate();
          rerender();
        }
      });
    chains.current.set(id, run);
  };

  // Waits for every queued save of the given items; false if any of them failed.
  const flushSaves = async (itemIds: string[]) => {
    await Promise.all(itemIds.map((id) => chains.current.get(id)));
    const bad = itemIds.some((id) => failed.current.has(id));
    for (const id of itemIds) failed.current.delete(id);
    if (bad) void refresh();
    return !bad;
  };
  const approveSelected = async () => {
    if (await flushSaves(ids)) approve.mutate({ ids });
  };
  const dismissSelected = async () => {
    if (await flushSaves(ids)) dismiss.mutate({ ids });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Transactions from SMS</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto py-4">
          {pending.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing to review.</p>
          )}
          {pending.data?.map((item) => (
            <div
              key={`${item.id}:${revisions[item.id] ?? 0}`}
              className="border-border/60 space-y-2 rounded-xl border p-3"
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  aria-label="Select"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-[11px]">
                    {item.sender} · {new Date(item.receivedAt).toLocaleString()}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs break-words">{item.text}</p>
                </div>
              </div>
              {(drafts.current.get(item.id) ?? item.parsed).map((row, i) => (
                <div key={i} className="grid grid-cols-[7.5rem_1fr_6rem] items-center gap-2 pl-6">
                  <Input
                    type="date"
                    defaultValue={row.date}
                    className="h-7 text-xs"
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== row.date)
                        editRow(item, i, { date: e.target.value });
                    }}
                  />
                  <Input
                    defaultValue={row.merchantName}
                    placeholder={row.type === "DEBIT" ? "Paid to" : "Received from"}
                    aria-label={row.type === "DEBIT" ? "Paid to" : "Received from"}
                    title={row.type === "DEBIT" ? "Paid to" : "Received from"}
                    className="h-7 text-xs"
                    maxLength={200}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== row.merchantName) editRow(item, i, { merchantName: v });
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Switch debit/credit"
                      className={`text-xs font-semibold ${row.type === "DEBIT" ? "text-red-500" : "text-emerald-500"}`}
                      onClick={() =>
                        editRow(item, i, { type: row.type === "DEBIT" ? "CREDIT" : "DEBIT" })
                      }
                    >
                      {row.type === "DEBIT" ? "−" : "+"}
                    </button>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={row.amount}
                      className="h-7 text-xs tabular-nums"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") return;
                        const v = Number(raw);
                        if (Number.isFinite(v) && v > 0 && v < 1e15 && v !== row.amount)
                          editRow(item, i, { amount: v });
                      }}
                    />
                  </div>
                  <label className="col-span-3 block">
                    <span className="text-muted-foreground text-[11px]">Description</span>
                    <textarea
                      defaultValue={row.description}
                      rows={2}
                      maxLength={500}
                      placeholder="What was this for? e.g. Groceries for the week"
                      className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring mt-0.5 block w-full resize-y rounded-md border px-2 py-1 text-xs focus-visible:ring-1 focus-visible:outline-none"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        // A transaction always needs a description: clearing the
                        // box keeps the one read from the SMS.
                        if (!v) e.target.value = row.description;
                        else if (v !== row.description) editRow(item, i, { description: v });
                      }}
                    />
                  </label>
                  <div className="col-span-3 flex flex-wrap items-center gap-2">
                    <CategoryPicker
                      value={row.category}
                      onChange={(c) =>
                        editRow(item, i, {
                          category: c,
                          mccLabel: c,
                          needsCategory: false,
                          userCategorized: true,
                          rememberRule: row.rememberRule ?? true,
                        })
                      }
                      triggerClassName="h-6 px-2 text-xs rounded-full bg-muted"
                    />
                    {row.needsCategory && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Where did this money go?
                      </span>
                    )}
                    {row.ruleApplied && !row.userCategorized && (
                      <span className="text-muted-foreground text-[11px]">remembered</span>
                    )}
                    {row.possibleDuplicate && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Possible duplicate
                      </span>
                    )}
                    {row.ruleKey && row.userCategorized && (
                      <label className="text-muted-foreground flex w-full items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={row.rememberRule !== false}
                          onChange={(e) => editRow(item, i, { rememberRule: e.target.checked })}
                        />
                        Always use {row.category} for {row.ruleKey.label}
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {(skipped.data?.length ?? 0) > 0 && (
            <div className="pt-2">
              <button
                type="button"
                className="text-muted-foreground text-xs font-medium"
                onClick={() => setShowSkipped((v) => !v)}
              >
                {showSkipped ? "▾" : "▸"} Skipped ({skipped.data!.length})
              </button>
              {showSkipped &&
                skipped.data!.map((item) => (
                  <div
                    key={item.id}
                    className="bg-muted/40 mt-2 flex items-start justify-between gap-2 rounded-lg p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-[11px]">
                        {item.status === "FAILED"
                          ? `Couldn't read: ${item.errorMessage ?? "unknown error"}`
                          : "No transaction found"}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs break-words">
                        {item.text}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        disabled={retry.isPending || !item.text}
                        onClick={() => retry.mutate({ id: item.id })}
                      >
                        Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => dismiss.mutate({ ids: [item.id] })}
                      >
                        Hide
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <SheetFooter className="gap-2 border-t pt-3">
          <Button
            variant="outline"
            disabled={busy || ids.length === 0}
            onClick={() => void dismissSelected()}
          >
            Dismiss selected
          </Button>
          <Button disabled={busy || ids.length === 0} onClick={() => void approveSelected()}>
            {approve.isPending ? "Adding…" : `Approve selected (${ids.length})`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
