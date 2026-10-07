// Display text for Outreach values. Pure, so pages and tests share it.
import type { ActionKind, OutreachEventKind } from "@/server/services/outreach/pipeline";
import type { DraftKind, SignalName, Stage } from "@/server/services/outreach/types";

export const STAGES: Stage[] = [
  "QUEUED",
  "REQUEST_SENT",
  "CONNECTED",
  "VALUE_SENT",
  "ENGAGED",
  "TEARDOWN",
  "PILOT",
  "WON",
  "LOST",
  "NURTURE",
  "DNC",
];

export const STAGE_LABEL: Record<Stage, string> = {
  QUEUED: "Queued",
  REQUEST_SENT: "Request sent",
  CONNECTED: "Connected",
  VALUE_SENT: "Value sent",
  ENGAGED: "Engaged",
  TEARDOWN: "Teardown",
  PILOT: "Pilot",
  WON: "Won",
  LOST: "Lost",
  NURTURE: "Nurture",
  DNC: "Do not contact",
};

// Same palette as the CRM lead statuses (app/(app)/crm/leads/page.tsx STATUS_STYLE).
export const STAGE_TONE: Record<Stage, string> = {
  QUEUED: "bg-slate-100 text-slate-600 border-slate-200",
  REQUEST_SENT: "bg-blue-100 text-blue-700 border-blue-200",
  CONNECTED: "bg-blue-100 text-blue-700 border-blue-200",
  VALUE_SENT: "bg-amber-100 text-amber-700 border-amber-200",
  ENGAGED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  TEARDOWN: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PILOT: "bg-purple-100 text-purple-700 border-purple-200",
  WON: "bg-purple-100 text-purple-700 border-purple-200",
  LOST: "bg-slate-100 text-slate-500 border-slate-200",
  NURTURE: "bg-amber-50 text-amber-700 border-amber-200",
  DNC: "bg-red-100 text-red-700 border-red-200",
};

export const EVENT_LABEL: Record<OutreachEventKind, string> = {
  request_sent: "Sent connection request",
  accepted: "They accepted",
  withdrawn: "Withdrew request",
  message_sent: "Sent a message",
  light_touch: "Light touch",
  replied: "They replied",
  teardown_booked: "Teardown booked",
  pilot_started: "Pilot started",
  won: "Won",
  lost: "Lost",
  to_nurture: "Moved to nurture",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  send_request: "Send a connection request",
  withdraw: "Withdraw the request",
  send_value: "Send the value message",
  light_touch: "Light touch: like or comment on a post",
  second_value: "Send a second value message",
  follow_up: "Follow up",
  teardown_followup: "Follow up after the teardown",
  reply: "Reply to them",
  move_to_nurture: "Move to nurture",
  nurture_touch: "Nurture touch",
};

export const SIGNAL_LABEL: Record<SignalName, string> = {
  hiring: "Hiring for AI",
  pain_post: "Posted about a pain",
  funding: "Recently funded",
  demo_stage: "Demo stage",
  warm_path: "Warm path",
  stack_match: "Stack match",
};

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  CONNECTION_NOTE: "Connection note",
  VALUE_MESSAGE: "Value message",
  REPLY: "Reply",
};

export const ENRICHMENT_LABEL: Record<string, string> = {
  checked: "Website checked",
  unreachable: "Website not checked or unreachable",
  no_website: "No website",
  refused: "Website not checked (blocked address)",
};

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Due today", "Overdue by 2 days", "Due in 3 days": calendar days in local time. */
export function dueText(dueAt: Date | string, now: Date): string {
  const days = Math.round((startOfDay(new Date(dueAt)) - startOfDay(now)) / DAY);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
}

const REASON = /^([a-z_]+) \(([+-]?\d+)\): ([\s\S]*)$/;

/** Scoring reasons arrive as "pain_post (+3): evidence" (scoreSignals, Task 3). */
export function parseReason(
  r: string
): { signal: string; weight: string; evidence: string } | null {
  const m = REASON.exec(r);
  if (!m) return null;
  return {
    signal: SIGNAL_LABEL[m[1] as SignalName] ?? m[1].replace(/_/g, " "),
    weight: m[2],
    evidence: m[3],
  };
}
