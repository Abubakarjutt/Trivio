"use client";

import { ExternalLink, Globe, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { Signal } from "@/server/services/outreach/types";
import { SIGNAL_LABEL } from "./labels";
import { Textarea } from "./textarea";

export type WebFinding = { signal: Signal; picked: boolean };
export type WebResearchState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "skipped"; message: string }
  | { phase: "done"; findings: WebFinding[]; note: string; sources: string[] };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-muted-foreground inline-flex items-center gap-0.5 text-xs underline-offset-2 hover:underline"
    >
      {host(url)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/**
 * Web findings for the new-prospect form: the ticked signals and the note are saved with it.
 * A finding whose signal is already in the form (`known`) isn't saved; the form's one wins.
 */
export function WebResearchPanel({
  state,
  onChange,
  known,
}: {
  state: WebResearchState;
  onChange: (s: WebResearchState) => void;
  known: string[];
}) {
  if (state.phase === "idle") return null;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="h-4 w-4" /> Web research
      </p>
      {state.phase === "running" && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Researching the web… Saving now skips it.
        </p>
      )}
      {state.phase === "skipped" && (
        <p className="text-muted-foreground text-sm">{state.message}</p>
      )}
      {state.phase === "done" && (
        <>
          {state.findings.length === 0 && (
            <p className="text-muted-foreground text-sm">No new signals on the web.</p>
          )}
          {state.findings.map((f, i) => {
            const inList = known.includes(f.signal.name);
            return (
              <div key={f.signal.name} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`web-${f.signal.name}`}
                  className="mt-1"
                  checked={f.picked && !inList}
                  disabled={inList}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      findings: state.findings.map((o, j) =>
                        j === i ? { ...o, picked: e.target.checked } : o
                      ),
                    })
                  }
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`web-${f.signal.name}`} className="text-sm font-normal">
                    <span className="bg-muted mr-1.5 rounded px-1 py-0.5 text-[10px] uppercase">
                      web
                    </span>
                    {SIGNAL_LABEL[f.signal.name]}: {f.signal.evidence}
                  </Label>
                  {inList && (
                    <p className="text-muted-foreground text-xs">
                      Already in your signals; that one is kept.
                    </p>
                  )}
                  {f.signal.source && <SourceLink url={f.signal.source} />}
                </div>
              </div>
            );
          })}
          <div className="space-y-1.5">
            <Label htmlFor="research-note">Research note</Label>
            <Textarea
              id="research-note"
              className="min-h-[90px]"
              maxLength={4000}
              value={state.note}
              onChange={(e) => onChange({ ...state, note: e.target.value })}
            />
            {state.sources.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {state.sources.map((u) => (
                  <SourceLink key={u} url={u} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
