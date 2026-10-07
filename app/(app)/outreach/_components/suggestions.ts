import type { OutreachEventKind } from "@/server/services/outreach/pipeline";

export type Suggestion = { i: number; event: OutreachEventKind };

/**
 * Rows still to confirm after Apply. `applyEvents` applies the picked events in order and stops at
 * the first error, so the first `appliedCount` picks (in suggestion order) are done and every other
 * row stays, even when an event kind repeats.
 */
export function remainingAfterApply(
  suggested: Suggestion[],
  picked: number[],
  appliedCount: number
): Suggestion[] {
  const pickedSet = new Set(picked);
  const done = new Set(
    suggested
      .filter((s) => pickedSet.has(s.i))
      .slice(0, appliedCount)
      .map((s) => s.i)
  );
  return suggested.filter((s) => !done.has(s.i));
}

// The thread is written by the prospect, so it can steer the model. Events that start CRM records
// or close the funnel are never pre-ticked: the user ticks them on purpose.
const OPT_IN: ReadonlySet<OutreachEventKind> = new Set([
  "pilot_started",
  "won",
  "lost",
  "withdrawn",
]);

/** Indexes of the suggestions ticked by default. */
export function defaultPicked(events: OutreachEventKind[]): number[] {
  return events.flatMap((e, i) => (OPT_IN.has(e) ? [] : [i]));
}
