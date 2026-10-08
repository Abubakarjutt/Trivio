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
