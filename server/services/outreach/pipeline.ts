// Port of linkedin-outreach/outreach/pipeline.py and conversation.valid_sequence.
import { OutreachError, type Cadence, type ProspectState, type Stage } from "./types";

export const EVENTS = [
  "request_sent",
  "accepted",
  "withdrawn",
  "message_sent",
  "light_touch",
  "replied",
  "teardown_booked",
  "pilot_started",
  "won",
  "lost",
  "to_nurture",
] as const;
export type OutreachEventKind = (typeof EVENTS)[number];
export const MAX_UNANSWERED = 2;

const ACTIVE: readonly Stage[] = [
  "QUEUED",
  "REQUEST_SENT",
  "CONNECTED",
  "VALUE_SENT",
  "ENGAGED",
  "TEARDOWN",
  "NURTURE",
  "PILOT",
];

// event -> stages it's allowed from, and target stage (null = decided in transition() or unchanged)
export const RULES: Record<OutreachEventKind, { from: readonly Stage[]; to: Stage | null }> = {
  request_sent: { from: ["QUEUED"], to: "REQUEST_SENT" },
  accepted: { from: ["REQUEST_SENT"], to: "CONNECTED" },
  withdrawn: { from: ["REQUEST_SENT"], to: "LOST" },
  message_sent: { from: ["CONNECTED", "VALUE_SENT", "ENGAGED", "TEARDOWN"], to: null },
  light_touch: { from: ["VALUE_SENT", "NURTURE"], to: null },
  replied: {
    from: ["REQUEST_SENT", "CONNECTED", "VALUE_SENT", "ENGAGED", "TEARDOWN", "NURTURE"],
    to: null,
  },
  teardown_booked: { from: ["ENGAGED"], to: "TEARDOWN" },
  pilot_started: { from: ["ENGAGED", "TEARDOWN"], to: "PILOT" },
  won: { from: ["PILOT"], to: "WON" },
  lost: { from: ACTIVE, to: "LOST" },
  to_nurture: { from: ["VALUE_SENT", "ENGAGED", "TEARDOWN"], to: "NURTURE" },
};

export class InvalidTransition extends OutreachError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransition";
  }
}

export const isEvent = (e: string): e is OutreachEventKind =>
  (EVENTS as readonly string[]).includes(e);

/** Events that can be logged from this stage, in RULES order. */
export function eventsFor(stage: Stage): OutreachEventKind[] {
  return EVENTS.filter((e) => RULES[e].from.includes(stage));
}

const REPLY_MOVES_TO_ENGAGED: readonly Stage[] = [
  "REQUEST_SENT",
  "CONNECTED",
  "VALUE_SENT",
  "NURTURE",
];

export function transition(p: ProspectState, event: string, now: Date): Partial<ProspectState> {
  if (!isEvent(event)) throw new InvalidTransition(`Unknown event “${event}”.`);
  const rule = RULES[event];
  if (!rule.from.includes(p.stage)) {
    throw new InvalidTransition(
      `Can't log “${event}” while the prospect is ${p.stage.toLowerCase()}.`
    );
  }
  let target = rule.to;
  const updates: Partial<ProspectState> = {};
  if (event === "message_sent") {
    if (p.unansweredCount >= MAX_UNANSWERED) {
      throw new InvalidTransition(
        "Two messages are already unanswered. Move this prospect to nurture instead."
      );
    }
    Object.assign(updates, {
      unansweredCount: p.unansweredCount + 1,
      lastMessageAt: now,
      awaitingReply: false,
      lightTouchDone: false,
    });
    if (p.stage === "CONNECTED") target = "VALUE_SENT";
  } else if (event === "light_touch") {
    Object.assign(updates, { lightTouchDone: true, lastTouchAt: now });
  } else if (event === "replied") {
    Object.assign(updates, { awaitingReply: true, lastReplyAt: now, unansweredCount: 0 });
    if (REPLY_MOVES_TO_ENGAGED.includes(p.stage)) target = "ENGAGED";
  } else if (event === "teardown_booked" || event === "to_nurture") {
    Object.assign(updates, { awaitingReply: false, unansweredCount: 0 });
  }
  if (target !== null && target !== p.stage)
    Object.assign(updates, { stage: target, stageChangedAt: now });
  return updates;
}

export type ActionKind =
  | "send_request"
  | "withdraw"
  | "send_value"
  | "light_touch"
  | "second_value"
  | "follow_up"
  | "teardown_followup"
  | "reply"
  | "move_to_nurture"
  | "nurture_touch";
export type Action = { kind: ActionKind; dueAt: Date };

// What "Mark done" records for each action.
export const ACTION_EVENT: Record<ActionKind, OutreachEventKind> = {
  send_request: "request_sent",
  withdraw: "withdrawn",
  send_value: "message_sent",
  light_touch: "light_touch",
  second_value: "message_sent",
  follow_up: "message_sent",
  teardown_followup: "message_sent",
  reply: "message_sent",
  move_to_nurture: "to_nurture",
  nurture_touch: "light_touch",
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function nextAction(p: ProspectState, c: Cadence): Action | null {
  if (p.stage === "PILOT" || p.stage === "WON" || p.stage === "LOST" || p.stage === "DNC")
    return null;
  if (p.awaitingReply) return { kind: "reply", dueAt: p.lastReplyAt ?? p.stageChangedAt };
  if (p.stage === "QUEUED") return { kind: "send_request", dueAt: p.stageChangedAt };
  if (p.stage === "REQUEST_SENT")
    return { kind: "withdraw", dueAt: addDays(p.stageChangedAt, c.withdrawAfter) };
  if (p.stage === "CONNECTED") return { kind: "send_value", dueAt: p.stageChangedAt };
  if (p.stage === "NURTURE")
    return {
      kind: "nurture_touch",
      dueAt: addDays(p.lastTouchAt ?? p.stageChangedAt, c.nurtureEvery),
    };

  const last = p.lastMessageAt ?? p.stageChangedAt;
  if (p.unansweredCount >= MAX_UNANSWERED)
    return { kind: "move_to_nurture", dueAt: addDays(last, c.nurtureAfterSecond) };
  if (p.stage === "VALUE_SENT") {
    return p.lightTouchDone
      ? { kind: "second_value", dueAt: addDays(last, c.secondValue) }
      : { kind: "light_touch", dueAt: addDays(last, c.lightTouch) };
  }
  if (p.stage === "ENGAGED") return { kind: "follow_up", dueAt: addDays(last, c.secondValue) };
  if (p.stage === "TEARDOWN")
    return { kind: "teardown_followup", dueAt: addDays(last, c.teardownFollowUp) };
  return null;
}

/** Keep the suggested events that are valid, applying each one to a copy of the prospect. */
export function validSequence(p: ProspectState, events: string[], now: Date): OutreachEventKind[] {
  let sim: ProspectState = { ...p };
  const kept: OutreachEventKind[] = [];
  for (const event of events) {
    try {
      sim = { ...sim, ...transition(sim, event, now) };
      kept.push(event as OutreachEventKind);
    } catch (e) {
      if (!(e instanceof InvalidTransition)) throw e;
    }
  }
  return kept;
}
