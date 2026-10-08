import type { Stage } from "@/server/services/outreach/types";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, STAGE_TONE } from "./labels";

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STAGE_TONE[stage]
      )}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
