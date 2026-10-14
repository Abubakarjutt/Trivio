import type { Signal } from "@/server/services/outreach/types";

/** One signal per name; the first list that has a name wins. */
export function mergeSignals(...lists: Signal[][]): Signal[] {
  const seen = new Set<string>();
  return lists.flat().filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

/** What became of a web finding once it was put in the form's signals. */
export function findingStatus(finding: Signal, current: Signal[]): string {
  const now = current.find((s) => s.name === finding.name);
  if (!now) return "Removed from your signals.";
  if (now.source !== finding.source) return "You already had this signal; yours is kept.";
  return now.evidence === finding.evidence
    ? "Added to your signals above."
    : "Added to your signals above (edited).";
}
