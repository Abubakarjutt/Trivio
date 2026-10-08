"use client";

import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DraftKind } from "@/server/services/outreach/types";
import { useAiReady } from "./ai-notice";
import { CopyButton } from "./copy-button";
import { DRAFT_KIND_LABEL } from "./labels";
import type { DraftRow } from "./types";

export function DraftList({
  kind,
  drafts,
  onGenerate,
  busy,
  error,
  showTitle = true,
}: {
  kind: DraftKind;
  drafts: DraftRow[];
  onGenerate?: () => void;
  busy?: boolean;
  error?: string | null;
  showTitle?: boolean;
}) {
  const aiReady = useAiReady();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {showTitle && <h3 className="text-sm font-semibold">{DRAFT_KIND_LABEL[kind]}</h3>}
        {onGenerate && (
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={!aiReady || busy}>
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {busy ? "Drafting…" : drafts.length ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!drafts.length && !error && (
        <p className="text-muted-foreground text-sm">Not drafted yet.</p>
      )}
      {drafts.map((d) => (
        <div key={d.variant} className="border-border/60 space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">
              Option {d.variant} · {d.body.length} chars
            </span>
            <CopyButton text={d.body} />
          </div>
          <p className="text-sm whitespace-pre-wrap">{d.body}</p>
          {d.violations.length > 0 && (
            <ul className="space-y-1">
              {d.violations.map((v) => (
                <li key={v} className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {v}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
