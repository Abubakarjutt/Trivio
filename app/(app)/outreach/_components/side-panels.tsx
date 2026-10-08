"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Signal } from "@/server/services/outreach/types";
import { EVENT_LABEL, SIGNAL_LABEL } from "./labels";
import { ReasonLine, ScoreChip } from "./score-chip";
import type { ProspectDetail } from "./types";

export function ScoreCard({ data }: { data: ProspectDetail }) {
  const { prospect: p } = data;
  const utils = trpc.useUtils();
  const signals = p.signals as Signal[];
  const update = trpc.outreachProspects.update.useMutation({
    onSuccess: () => {
      void utils.outreachProspects.get.invalidate({ id: p.id });
      void utils.outreachProspects.list.invalidate();
    },
    onError: () => void utils.outreachProspects.get.invalidate({ id: p.id }),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <ScoreChip score={p.score} />
        <CardTitle className="text-base">Why this score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {p.scoreReasons.length === 0 && (
          <p className="text-muted-foreground text-sm">No signals yet.</p>
        )}
        {p.scoreReasons.map((r) => (
          <ReasonLine key={r} reason={r} />
        ))}
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            {signals.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                disabled={update.isPending}
                className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                title="Remove this signal and re-score"
                aria-label={`Remove signal ${SIGNAL_LABEL[s.name]} and re-score`}
                onClick={() =>
                  update.mutate({ id: p.id, signals: signals.filter((_, j) => j !== i) })
                }
              >
                {SIGNAL_LABEL[s.name]} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
        {update.error && <p className="text-destructive text-sm">{update.error.message}</p>}
      </CardContent>
    </Card>
  );
}

export function EventLog({
  data,
  onHandoffError,
}: {
  data: ProspectDetail;
  onHandoffError: (e: string | null) => void;
}) {
  const id = data.prospect.id;
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.outreachProspects.get.invalidate({ id });
    void utils.outreachToday.get.invalidate();
    void utils.outreachProspects.list.invalidate();
  };
  const log = trpc.outreachProspects.logEvent.useMutation({
    onSuccess: (r, vars) => {
      onHandoffError(r.handoffError);
      toast.success(`Logged: ${EVENT_LABEL[vars.event]}.`);
      refresh();
    },
    // A stale-window refusal means the stage moved; reload it so the buttons match.
    onError: refresh,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Log what happened</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {data.allowedEvents.map((e) => (
            <Button
              key={e}
              size="sm"
              variant="outline"
              disabled={log.isPending}
              onClick={() => log.mutate({ id, event: e })}
            >
              {EVENT_LABEL[e]}
            </Button>
          ))}
          {data.allowedEvents.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing to log at this stage.</p>
          )}
        </div>
        {log.error && <p className="text-destructive text-sm">{log.error.message}</p>}
        <ul className="border-border/60 text-muted-foreground space-y-1 border-t pt-3 text-xs">
          {data.events.map((ev) => (
            <li key={ev.id} className="flex justify-between gap-2">
              <span>{EVENT_LABEL[ev.kind as keyof typeof EVENT_LABEL] ?? ev.kind}</span>
              <span className="tabular-nums">{new Date(ev.at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const LEAD_STAGES = ["TEARDOWN", "PILOT", "WON"];
const DEAL_STAGES = ["PILOT", "WON"];

export function CrmCard({
  data,
  handoffError,
  onHandoffError,
}: {
  data: ProspectDetail;
  handoffError: string | null;
  onHandoffError: (e: string | null) => void;
}) {
  const { prospect: p, crm } = data;
  const utils = trpc.useUtils();
  const retry = trpc.outreachProspects.retryCrmHandoff.useMutation({
    onSuccess: (r) => {
      onHandoffError(r.error);
      if (!r.error) toast.success("CRM handoff done.");
      void utils.outreachProspects.get.invalidate({ id: p.id });
    },
    onError: (e) => {
      onHandoffError(e.message);
      void utils.outreachProspects.get.invalidate({ id: p.id });
    },
  });
  const missing =
    (LEAD_STAGES.includes(p.stage) && !crm.lead) || (DEAL_STAGES.includes(p.stage) && !crm.deal);
  const canRetry = LEAD_STAGES.includes(p.stage) && (missing || handoffError !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CRM</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {crm.lead ? (
          <p>
            Lead:{" "}
            <Link href={`/crm/leads/${crm.lead.id}`} className="underline">
              open in CRM
            </Link>{" "}
            ({crm.lead.status.toLowerCase()})
          </p>
        ) : (
          <p className="text-muted-foreground">A CRM lead is created when a teardown is booked.</p>
        )}
        {crm.deal && (
          <p>
            Deal:{" "}
            <Link href={`/crm/deals/${crm.deal.id}`} className="underline">
              {crm.deal.name}
            </Link>
          </p>
        )}
        {!crm.hasPipeline && DEAL_STAGES.includes(p.stage) && !crm.deal && (
          <p className="text-amber-700">
            Create a pipeline in{" "}
            <Link href="/crm/deals" className="underline">
              CRM
            </Link>
            , then retry.
          </p>
        )}
        {handoffError && (
          <p className="text-destructive">
            The stage changed, but the CRM step failed: {handoffError}
          </p>
        )}
        {canRetry && (
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ id: p.id })}
          >
            {retry.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Retry CRM handoff
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export type Confirm = "dnc" | "delete" | null;

export function PrivacyCard({
  data,
  confirm,
  setConfirm,
}: {
  data: ProspectDetail;
  confirm: Confirm;
  setConfirm: (c: Confirm) => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const id = data.prospect.id;
  const refreshLists = () => {
    void utils.outreachProspects.list.invalidate();
    void utils.outreachToday.get.invalidate();
  };
  const dnc = trpc.outreachProspects.markDnc.useMutation({
    onSuccess: (r) => {
      setConfirm(null);
      refreshLists();
      void utils.outreachProspects.get.invalidate({ id });
      toast.success(
        r.crmLeadId || r.crmDealId
          ? "Marked do not contact. The linked CRM records are kept."
          : "Marked do not contact."
      );
    },
  });
  const del = trpc.outreachProspects.delete.useMutation({
    onSuccess: (r) => {
      setConfirm(null);
      refreshLists();
      toast.success(
        r.crmDealId || r.crmLeadId
          ? "Prospect deleted. The linked CRM records are kept."
          : "Prospect deleted."
      );
      router.push("/outreach/prospects");
    },
  });
  const busy = dnc.isPending || del.isPending;
  const error = confirm === "delete" ? del.error?.message : dnc.error?.message;
  const close = () => {
    if (busy) return;
    setConfirm(null);
    dnc.reset();
    del.reset();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Privacy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {data.prospect.stage !== "DNC" && (
          <Button size="sm" variant="outline" onClick={() => setConfirm("dnc")}>
            Do not contact
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirm("delete")}
        >
          Delete
        </Button>
      </CardContent>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "delete"
                ? `Delete ${data.prospect.name}?`
                : `Stop contacting ${data.prospect.name}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === "delete"
                ? "Their profile, drafts, conversation and documents are erased. Their URL stays on your do-not-contact list so they can't be added again. A linked CRM lead or deal is kept."
                : "They leave Today for good and their URL goes on your do-not-contact list."}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => (confirm === "delete" ? del.mutate({ id }) : dnc.mutate({ id }))}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {confirm === "delete" ? "Delete" : "Do not contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
