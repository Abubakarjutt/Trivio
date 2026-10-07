import { describe, expect, it } from "vitest";
import { buildToday } from "@/server/services/outreach/today";
import { DEFAULT_CADENCE } from "@/server/services/outreach/types";
import { at, DAY, makeState, NOW } from "./helpers";

const p = (id: string, o: Parameters<typeof makeState>[0] = {}) => ({ id, ...makeState(o) });

describe("buildToday", () => {
  it("keeps the bucket order from the spec", () => {
    expect(buildToday([], NOW, DEFAULT_CADENCE, 20).map((b) => b.title)).toEqual([
      "Replies waiting",
      "Teardowns & pilots",
      "New connections",
      "Follow-ups due",
      "Connection requests to send",
      "Housekeeping",
    ]);
  });

  it("lists queued prospects in the given (score) order, limited by the remaining cap", () => {
    const requests = buildToday([p("high"), p("low")], NOW, DEFAULT_CADENCE, 1)[4].items;
    expect(requests.map((i) => i.prospect.id)).toEqual(["high"]);
    expect(requests[0].event).toBe("request_sent");
    expect(requests[0].draftKind).toBe("CONNECTION_NOTE");
  });

  it("shows no requests when the cap is used up", () => {
    expect(buildToday([p("a")], NOW, DEFAULT_CADENCE, 0)[4].items).toEqual([]);
  });

  it("puts replies first and hides items that aren't due yet", () => {
    const a = p("a", { stage: "ENGAGED", awaitingReply: true, lastReplyAt: NOW });
    const b = p("b", { stage: "REQUEST_SENT" });
    const buckets = buildToday([a, b], NOW, DEFAULT_CADENCE, 20);
    expect(buckets[0].items.map((i) => i.prospect.id)).toEqual(["a"]);
    expect(buckets[0].items[0].draftKind).toBe("REPLY");
    expect(buckets[5].items).toEqual([]);
    const later = buildToday([a, b], at(22 * DAY), DEFAULT_CADENCE, 20);
    expect(later[5].items.map((i) => i.prospect.id)).toEqual(["b"]);
  });

  it("sorts non-request buckets by due date", () => {
    const early = p("early", {
      stage: "VALUE_SENT",
      unansweredCount: 1,
      lastMessageAt: at(-10 * DAY),
    });
    const late = p("late", {
      stage: "VALUE_SENT",
      unansweredCount: 1,
      lastMessageAt: at(-6 * DAY),
    });
    expect(
      buildToday([late, early], NOW, DEFAULT_CADENCE, 20)[3].items.map((i) => i.prospect.id)
    ).toEqual(["early", "late"]);
  });

  it("never shows do-not-contact prospects", () => {
    expect(
      buildToday([p("a", { stage: "DNC" })], NOW, DEFAULT_CADENCE, 20).every(
        (b) => b.items.length === 0
      )
    ).toBe(true);
  });
});
