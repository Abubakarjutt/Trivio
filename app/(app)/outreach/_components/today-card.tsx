"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, ExternalLink, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VOICE_EVENTS } from "@/server/services/outreach/voice";
import { DraftList } from "./draft-list";
import { ACTION_LABEL, dueText } from "./labels";
import { ReasonLine, ScoreChip } from "./score-chip";
import { Textarea } from "./textarea";
import type { TodayItem } from "./types";

export function TodayCard({ item }: { item: TodayItem }) {
  const utils = trpc.useUtils();
  const { prospect: p, action, event, draftKind, drafts } = item;
  const [sent, setSent] = useState("");
  const [showSent, setShowSent] = useState(false);
  const refresh = () => utils.outreachToday.get.invalidate();
  const done = trpc.outreachProspects.logEvent.useMutation({ onSuccess: refresh });
  const generate = trpc.outreachDrafts.generate.useMutation({ onSuccess: refresh });
  const savesVoice = (VOICE_EVENTS as readonly string[]).includes(event);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <ScoreChip score={p.score} />
          <div className="min-w-0 flex-1">
            <Link href={`/outreach/prospects/${p.id}`} className="font-semibold hover:underline">
              {p.name}
            </Link>
            <p className="text-muted-foreground truncate text-sm">
              {[p.title, p.company].filter(Boolean).join(" at ")}
            </p>
          </div>
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
            <Clock className="h-3.5 w-3.5" />
            {ACTION_LABEL[action.kind]} · {dueText(action.dueAt, new Date())}
          </span>
        </div>

        {p.scoreReasons[0] && <ReasonLine reason={p.scoreReasons[0]} />}

        {draftKind && (
          <DraftList
            kind={draftKind}
            drafts={drafts}
            busy={generate.isPending}
            error={generate.error?.message}
            onGenerate={() => generate.mutate({ id: p.id, kind: draftKind })}
          />
        )}

        {savesVoice && showSent && (
          <Textarea
            maxLength={5000}
            placeholder="Paste what you actually sent. It becomes a voice example, with their name removed."
            value={sent}
            onChange={(e) => setSent(e.target.value)}
          />
        )}
        {done.error && <p className="text-destructive text-sm">{done.error.message}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={done.isPending}
            onClick={() => done.mutate({ id: p.id, event, sentText: sent.trim() || null })}
          >
            {done.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 h-3.5 w-3.5" />
            )}
            Mark done
          </Button>
          {savesVoice && !showSent && (
            <Button size="sm" variant="ghost" onClick={() => setShowSent(true)}>
              I changed the wording
            </Button>
          )}
          <a
            href={p.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            Open in Sales Navigator <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
