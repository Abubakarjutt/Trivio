"use client";

import { useState } from "react";
import { Ban, Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConversationAnalysis } from "@/server/services/outreach/schemas";
import { DraftList } from "./draft-list";
import { EVENT_LABEL } from "./labels";
import { Textarea } from "./textarea";
import { remainingAfterApply, type Suggestion } from "./suggestions";
import type { DraftRow, ProspectDetail } from "./types";

export function ConversationPanel({
  data,
  onHandoffError,
  onDnc,
}: {
  data: ProspectDetail;
  onHandoffError: (e: string | null) => void;
  onDnc: () => void;
}) {
  const id = data.prospect.id;
  const utils = trpc.useUtils();
  const [thread, setThread] = useState(data.conversation?.thread ?? "");
  const [analysed, setAnalysed] = useState(false);
  const [suggested, setSuggested] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const analysis = (data.conversation?.analysis ?? null) as ConversationAnalysis | null;
  const replies: DraftRow[] = data.drafts.filter((d) => d.kind === "REPLY");

  const refresh = () => {
    void utils.outreachProspects.get.invalidate({ id });
    void utils.outreachToday.get.invalidate();
    void utils.outreachProspects.list.invalidate();
  };

  const analyse = trpc.outreachDocs.analyseConversation.useMutation({
    onSuccess: (r) => {
      setAnalysed(true);
      setSuggested(r.events.map((event, i) => ({ i, event })));
      setPicked(r.events.map((_, i) => i));
      setApplyError(null);
      void utils.outreachProspects.get.invalidate({ id });
    },
  });
  const apply = trpc.outreachProspects.applySuggestions.useMutation({
    onSuccess: (r) => {
      onHandoffError(r.handoffError);
      // Keep whatever did not get applied so the person can fix the cause and try again.
      const left = remainingAfterApply(suggested, picked, r.applied.length);
      setSuggested(left);
      setPicked(picked.filter((i) => left.some((s) => s.i === i)));
      if (!r.error) setAnalysed(false); // what was applied is in the toast and the event log
      setApplyError(r.error);
      if (r.applied.length > 0) {
        toast.success(
          `Applied ${r.applied.length} update${r.applied.length === 1 ? "" : "s"}.${r.error ? " Some were not applied." : ""}`
        );
      }
      refresh();
    },
    onError: (e) => {
      setApplyError(e.message);
      // A stale-window error means the stage moved; reload it.
      refresh();
    },
  });

  const toggle = (i: number, on: boolean) =>
    setPicked(suggested.filter((s) => (s.i === i ? on : picked.includes(s.i))).map((s) => s.i));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          className="min-h-[160px]"
          maxLength={50_000}
          value={thread}
          aria-label="Conversation thread"
          placeholder="Paste the LinkedIn conversation thread here."
          onChange={(e) => setThread(e.target.value)}
        />
        {analyse.error && <p className="text-destructive text-sm">{analyse.error.message}</p>}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={analyse.isPending || !thread.trim()}
            onClick={() => analyse.mutate({ id, thread })}
          >
            {analyse.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessagesSquare className="mr-1 h-3.5 w-3.5" />
            )}
            {analyse.isPending ? "Analysing…" : "Analyse"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Analysing never changes the stage. Only Apply does.
          </span>
        </div>

        {analysis && (
          <div className="bg-muted/50 space-y-2 rounded-lg p-3 text-sm">
            <p>{analysis.summary}</p>
            {analysis.reason && <p className="text-muted-foreground">{analysis.reason}</p>}
          </div>
        )}

        {analysis?.optedOut && data.prospect.stage !== "DNC" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <span>They asked not to be contacted.</span>
            <Button size="sm" variant="destructive" onClick={onDnc}>
              <Ban className="mr-1 h-3.5 w-3.5" /> Do not contact
            </Button>
          </div>
        )}

        {analysed && suggested.length === 0 && !applyError && !analyse.isPending && (
          <p className="text-muted-foreground text-sm">No stage updates suggested.</p>
        )}

        {suggested.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Suggested updates. Tick what really happened:</p>
            {suggested.map((s) => (
              <label key={s.i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(s.i)}
                  disabled={apply.isPending}
                  onChange={(ev) => toggle(s.i, ev.target.checked)}
                />
                {EVENT_LABEL[s.event]}
              </label>
            ))}
            <Button
              size="sm"
              disabled={apply.isPending || picked.length === 0}
              onClick={() => apply.mutate({
                  id,
                  events: suggested.filter((s) => picked.includes(s.i)).map((s) => s.event),
                })}
            >
              {apply.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Apply
            </Button>
          </div>
        )}
        {applyError && <p className="text-destructive text-sm">{applyError}</p>}

        {replies.length > 0 && <DraftList kind="REPLY" drafts={replies} />}
      </CardContent>
    </Card>
  );
}
