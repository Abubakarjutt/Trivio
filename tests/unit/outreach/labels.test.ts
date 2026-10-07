import { describe, expect, it } from "vitest";
import {
  ACTION_LABEL,
  dueText,
  EVENT_LABEL,
  parseReason,
  SIGNAL_LABEL,
  STAGE_LABEL,
  STAGES,
} from "@/app/(app)/outreach/_components/labels";
import { EVENTS } from "@/server/services/outreach/pipeline";
import { SIGNAL_NAMES } from "@/server/services/outreach/types";

const NOW = new Date(2026, 9, 7, 15, 0); // local time, Wednesday 7 Oct 2026, 15:00

describe("labels", () => {
  it("names every stage, event and signal", () => {
    expect(STAGES).toHaveLength(11);
    for (const s of STAGES) expect(STAGE_LABEL[s]).toBeTruthy();
    for (const e of EVENTS) expect(EVENT_LABEL[e]).toBeTruthy();
    for (const s of SIGNAL_NAMES) expect(SIGNAL_LABEL[s]).toBeTruthy();
    expect(ACTION_LABEL.send_request).toBe("Send a connection request");
  });
});

describe("dueText", () => {
  it("counts calendar days in local time, not 24-hour periods", () => {
    expect(dueText(new Date(2026, 9, 7, 9, 0), NOW)).toBe("Due today");
    expect(dueText(new Date(2026, 9, 6, 23, 30), NOW)).toBe("Overdue by 1 day");
    expect(dueText(new Date(2026, 9, 2, 8, 0), NOW)).toBe("Overdue by 5 days");
    expect(dueText(new Date(2026, 9, 8, 0, 30), NOW)).toBe("Due tomorrow");
    expect(dueText(new Date(2026, 9, 12, 0, 30), NOW)).toBe("Due in 5 days");
  });

  it("accepts an ISO string", () => {
    expect(dueText(new Date(2026, 9, 7, 1, 0).toISOString(), NOW)).toBe("Due today");
  });
});

describe("parseReason", () => {
  it("splits a scoring reason into signal, weight and evidence", () => {
    expect(parseReason("pain_post (+3): Post: our agent loops forever")).toEqual({
      signal: "Posted about a pain",
      weight: "+3",
      evidence: "Post: our agent loops forever",
    });
  });

  it("keeps colons inside the evidence", () => {
    expect(parseReason("hiring (+3): Careers: LLM Engineer: Evals")?.evidence).toBe(
      "Careers: LLM Engineer: Evals"
    );
  });

  it("returns null for anything else", () => {
    expect(parseReason("No strong signal")).toBeNull();
  });
});
