import { describe, expect, it } from "vitest";
import {
  eventsFor, InvalidTransition, nextAction, transition, validSequence,
} from "@/server/services/outreach/pipeline";
import { DEFAULT_CADENCE, type ProspectState } from "@/server/services/outreach/types";
import { at, DAY, makeState, NOW } from "./helpers";

const apply = (p: ProspectState, event: string, when: Date) => ({ ...p, ...transition(p, event, when) });

describe("transition", () => {
  it("walks the happy path to teardown", () => {
    let p = apply(makeState(), "request_sent", NOW);
    expect(p.stage).toBe("REQUEST_SENT");
    p = apply(p, "accepted", at(DAY));
    p = apply(p, "message_sent", at(2 * DAY));
    expect([p.stage, p.unansweredCount]).toEqual(["VALUE_SENT", 1]);
    p = apply(p, "replied", at(3 * DAY));
    expect([p.stage, p.awaitingReply, p.unansweredCount]).toEqual(["ENGAGED", true, 0]);
    p = apply(p, "teardown_booked", at(4 * DAY));
    expect([p.stage, p.awaitingReply]).toEqual(["TEARDOWN", false]);
  });

  it("refuses a third unanswered message", () => {
    expect(() => transition(makeState({ stage: "VALUE_SENT", unansweredCount: 2 }), "message_sent", NOW)).toThrow(/nurture/);
  });

  it("resets the unanswered count on a reply", () => {
    expect(apply(makeState({ stage: "VALUE_SENT", unansweredCount: 2 }), "replied", NOW).unansweredCount).toBe(0);
  });

  it("refuses accepted before a request was sent", () => {
    expect(() => transition(makeState({ stage: "QUEUED" }), "accepted", NOW)).toThrow(InvalidTransition);
  });

  it("rejects an unknown event", () => {
    expect(() => transition(makeState(), "teleported", NOW)).toThrow(InvalidTransition);
  });

  it("moves stageChangedAt only when the stage changes", () => {
    expect(transition(makeState({ stage: "ENGAGED" }), "message_sent", at(DAY))).not.toHaveProperty("stageChangedAt");
  });
});

describe("eventsFor", () => {
  it("offers only events valid from the stage, in RULES order", () => {
    const queued = eventsFor("QUEUED");
    expect(queued).toContain("request_sent");
    expect(queued).toContain("lost");
    expect(queued).not.toContain("won");
    expect(queued).not.toContain("accepted");
    expect(eventsFor("DNC")).toEqual([]);
  });
});

describe("nextAction", () => {
  it("asks for a request on a queued prospect", () => {
    expect(nextAction(makeState(), DEFAULT_CADENCE)).toEqual({ kind: "send_request", dueAt: NOW });
  });

  it("makes a pending request due for withdrawal after 21 days", () => {
    expect(nextAction(makeState({ stage: "REQUEST_SENT" }), DEFAULT_CADENCE)).toEqual({ kind: "withdraw", dueAt: at(21 * DAY) });
  });

  it("does a light touch, then a second value message", () => {
    const p = makeState({ stage: "VALUE_SENT", unansweredCount: 1, lastMessageAt: NOW });
    expect(nextAction(p, DEFAULT_CADENCE)).toEqual({ kind: "light_touch", dueAt: at(5 * DAY) });
    expect(nextAction({ ...p, lightTouchDone: true }, DEFAULT_CADENCE)).toEqual({ kind: "second_value", dueAt: at(7 * DAY) });
  });

  it("moves to nurture 7 days after two unanswered messages", () => {
    const p = makeState({ stage: "VALUE_SENT", unansweredCount: 2, lastMessageAt: NOW });
    expect(nextAction(p, DEFAULT_CADENCE)).toEqual({ kind: "move_to_nurture", dueAt: at(7 * DAY) });
  });

  it("puts a waiting reply before everything", () => {
    const p = makeState({ stage: "TEARDOWN", awaitingReply: true, lastReplyAt: NOW });
    expect(nextAction(p, DEFAULT_CADENCE)).toEqual({ kind: "reply", dueAt: NOW });
  });

  it("touches nurture prospects every 30 days", () => {
    expect(nextAction(makeState({ stage: "NURTURE", lastTouchAt: NOW }), DEFAULT_CADENCE)).toEqual({ kind: "nurture_touch", dueAt: at(30 * DAY) });
  });

  it("uses the organisation's cadence", () => {
    expect(nextAction(makeState({ stage: "REQUEST_SENT" }), { ...DEFAULT_CADENCE, withdrawAfter: 10 })?.dueAt).toEqual(at(10 * DAY));
  });

  it.each(["PILOT", "WON", "LOST", "DNC"] as const)("has no action for %s", (stage) => {
    expect(nextAction(makeState({ stage }), DEFAULT_CADENCE)).toBeNull();
  });
});

describe("validSequence", () => {
  it("keeps only events valid in order, without changing the prospect", () => {
    const p = makeState({ stage: "REQUEST_SENT" });
    expect(validSequence(p, ["won", "accepted", "message_sent", "replied", "accepted"], NOW)).toEqual(["accepted", "message_sent", "replied"]);
    expect(p.stage).toBe("REQUEST_SENT");
  });
});
