"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarCheck, CalendarCog, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Personal Finance months follow the user's pay cycle: the current month stays
// open until they press "Close month" (server/services/pf-cycle.service.ts).

export type PayMonth = {
  key: string;
  from: string;
  to: string | null;
  label: string;
  kind: "calendar" | "closed" | "open";
};

/** "current" follows the open month (also after a close), "all" = all time, else a period key. */
export type PayMonthSelection = "current" | "all" | (string & {});

export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const nice = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function prevDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function nextDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The pay months and the one selected. `period` is undefined for all time. */
export function usePayMonths(initial: PayMonthSelection = "current") {
  const [selection, setSelection] = useState<PayMonthSelection>(initial);
  const { data: periods = [], isLoading } = trpc.pfCycles.list.useQuery();
  const period: PayMonth | undefined =
    selection === "all"
      ? undefined
      : selection === "current"
        ? periods[periods.length - 1]
        : (periods.find((p) => p.key === selection) ?? periods[periods.length - 1]);
  return {
    periods,
    selection,
    setSelection,
    period,
    /** Queries should wait until the periods are known (except for all time). */
    ready: selection === "all" || !!period,
    isLoading,
  };
}

export function PayMonthPicker({
  periods,
  selection,
  setSelection,
  period,
}: Omit<ReturnType<typeof usePayMonths>, "setSelection"> & {
  setSelection: (selection: PayMonthSelection) => void;
}) {
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<"close" | "start" | null>(null);
  const [date, setDate] = useState(localToday());

  const refresh = () => utils.invalidate();
  const reopen = trpc.pfCycles.reopen.useMutation({
    onSuccess: () => {
      toast.success("Month reopened");
      setSelection("current");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const close = trpc.pfCycles.close.useMutation({
    onSuccess: (r) => {
      setDialog(null);
      setSelection("current");
      toast.success(`Month closed. A new month started on ${nice(r.nextStarts)}.`, {
        action: { label: "Undo", onClick: () => reopen.mutate() },
      });
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStart = trpc.pfCycles.setStart.useMutation({
    onSuccess: () => {
      setDialog(null);
      toast.success("Start date changed");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const index = period ? periods.findIndex((p) => p.key === period.key) : -1;
  const open = periods[periods.length - 1];
  const lastClosed = periods.length > 1 ? periods[periods.length - 2] : undefined;
  const go = (i: number) => setSelection(i === periods.length - 1 ? "current" : periods[i].key);
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setSelection(selection === "all" ? "current" : "all")}
          title={selection === "all" ? "Switch to month view" : "Show all time"}
          className={`mr-1 h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
            selection === "all"
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All
        </button>
        <button
          className={btn}
          aria-label="Previous month"
          title="Previous month"
          disabled={selection !== "all" && index <= 0}
          onClick={() => go(selection === "all" ? periods.length - 1 : index - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span
          className="min-w-[170px] text-center text-sm font-semibold text-gray-800"
          data-testid="pay-month-label"
        >
          {selection === "all" ? "All time" : (period?.label ?? "…")}
        </span>
        <button
          className={btn}
          aria-label="Next month"
          title="Next month"
          disabled={selection === "all" || index >= periods.length - 1}
          onClick={() => go(index + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {period?.kind === "open" && (
        <>
          <Button
            size="sm"
            variant="ghost"
            title="Change when this month started"
            aria-label="Change start date"
            onClick={() => {
              setDate(period.from);
              setDialog("start");
            }}
          >
            <CalendarCog className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDate(localToday());
              setDialog("close");
            }}
          >
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            Close month
          </Button>
        </>
      )}
      {period && lastClosed?.kind === "closed" && period.key === lastClosed.key && (
        <Button
          size="sm"
          variant="outline"
          disabled={reopen.isPending}
          onClick={() => reopen.mutate()}
          title="Undo closing this month — it continues until you close it again"
        >
          <Undo2 className="mr-1.5 h-4 w-4" />
          Reopen month
        </Button>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {dialog === "close" && open ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                close.mutate({ startsOn: date });
              }}
            >
              <DialogHeader>
                <DialogTitle>Close this month</DialogTitle>
                <DialogDescription>
                  This month started on {nice(open.from)}. Close it when your salary arrives — the
                  new month starts on pay day.
                </DialogDescription>
              </DialogHeader>
              <div className="my-5 space-y-2">
                {open.from >= localToday() ? (
                  <p className="text-sm">
                    This month only started today. You can close it from tomorrow.
                  </p>
                ) : (
                  <>
                    <Label htmlFor="close-month-date">New month starts on</Label>
                    <Input
                      id="close-month-date"
                      type="date"
                      value={date}
                      min={nextDay(open.from)}
                      max={localToday()}
                      onChange={(e) => setDate(e.target.value)}
                      required
                    />
                    {date && (
                      <p className="text-muted-foreground text-xs">
                        This month ends on {nice(prevDay(date))}. Transactions are placed by their
                        date, so anything dated {nice(date)} or later goes into the new month.
                      </p>
                    )}
                  </>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={close.isPending || !date || open.from >= localToday()}
                >
                  Close month
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === "start" && open ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStart.mutate({ startDate: date });
              }}
            >
              <DialogHeader>
                <DialogTitle>When did this month start?</DialogTitle>
                <DialogDescription>
                  Usually the day your salary arrived.
                  {lastClosed?.kind === "closed" && " The previous month will end the day before."}
                </DialogDescription>
              </DialogHeader>
              <div className="my-5 space-y-2">
                <Label htmlFor="month-start-date">Start date</Label>
                <Input
                  id="month-start-date"
                  type="date"
                  value={date}
                  max={localToday()}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={setStart.isPending || !date}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
