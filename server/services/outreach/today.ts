// Port of linkedin-outreach/outreach/today.py (the pure part; drafts are attached by today-service.ts).
import {
  ACTION_EVENT,
  nextAction,
  type Action,
  type ActionKind,
  type OutreachEventKind,
} from "./pipeline";
import type { Cadence, DraftKind, ProspectState } from "./types";

export const BUCKETS: { title: string; kinds: ActionKind[] }[] = [
  { title: "Replies waiting", kinds: ["reply"] },
  { title: "Teardowns & pilots", kinds: ["teardown_followup"] },
  { title: "New connections", kinds: ["send_value"] },
  { title: "Follow-ups due", kinds: ["light_touch", "second_value", "follow_up", "nurture_touch"] },
  { title: "Connection requests to send", kinds: ["send_request"] },
  { title: "Housekeeping", kinds: ["withdraw", "move_to_nurture"] },
];

export const ACTION_DRAFT_KIND: Partial<Record<ActionKind, DraftKind>> = {
  send_request: "CONNECTION_NOTE",
  send_value: "VALUE_MESSAGE",
  second_value: "VALUE_MESSAGE",
  reply: "REPLY",
};

export type TodayItem<P> = {
  prospect: P;
  action: Action;
  event: OutreachEventKind;
  draftKind: DraftKind | null;
};
export type Bucket<P> = { title: string; items: TodayItem<P>[] };

/** `prospects` must already be sorted by score, highest first. */
export function buildToday<P extends ProspectState>(
  prospects: P[],
  now: Date,
  cadence: Cadence,
  remaining: number
): Bucket<P>[] {
  const due: TodayItem<P>[] = [];
  for (const prospect of prospects) {
    const action = nextAction(prospect, cadence);
    if (!action) continue;
    if (action.kind !== "send_request" && action.dueAt > now) continue;
    due.push({
      prospect,
      action,
      event: ACTION_EVENT[action.kind],
      draftKind: ACTION_DRAFT_KIND[action.kind] ?? null,
    });
  }
  return BUCKETS.map(({ title, kinds }) => {
    const items = due.filter((i) => kinds.includes(i.action.kind));
    if (kinds.includes("send_request"))
      return { title, items: items.slice(0, Math.max(0, remaining)) };
    return {
      title,
      items: items.sort((a, b) => a.action.dueAt.getTime() - b.action.dueAt.getTime()),
    };
  });
}
