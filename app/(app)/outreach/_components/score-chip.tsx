import { cn } from "@/lib/utils";
import { parseReason } from "./labels";

// Thresholds from the Python app's _macros.html: 6+ is high, 3+ is mid.
export function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 6
      ? "bg-emerald-100 text-emerald-700"
      : score >= 3
        ? "bg-amber-100 text-amber-700"
        : "bg-muted text-muted-foreground";
  return (
    <span
      title="Fit score"
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm font-semibold tabular-nums",
        tone
      )}
    >
      {score}
    </span>
  );
}

export function ReasonLine({ reason }: { reason: string }) {
  const r = parseReason(reason);
  if (!r) return <p className="text-muted-foreground text-sm">{reason}</p>;
  return (
    <p className="text-sm">
      <span className="bg-muted mr-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium">
        {r.signal} <span className="text-muted-foreground tabular-nums">{r.weight}</span>
      </span>
      <span className="text-muted-foreground">{r.evidence}</span>
    </p>
  );
}
