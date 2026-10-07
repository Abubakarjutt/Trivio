import { describe, expect, it } from "vitest";
import { scoreSignals } from "@/server/services/outreach/scoring";
import { DEFAULT_WEIGHTS, SIGNAL_NAMES, type SignalName } from "@/server/services/outreach/types";

const sig = (name: SignalName, evidence = "e") => ({ name, evidence });

describe("scoreSignals", () => {
  it("scores hiring + pain_post at 6 with hiring primary (order breaks the tie)", () => {
    const r = scoreSignals(
      [sig("pain_post", "post about hallucinations"), sig("hiring", "Senior LLM Engineer role")],
      DEFAULT_WEIGHTS
    );
    expect(r.score).toBe(6);
    expect(r.primary?.name).toBe("hiring");
    expect(r.reasons).toEqual([
      "hiring (+3): Senior LLM Engineer role",
      "pain_post (+3): post about hallucinations",
    ]);
  });

  it("counts a duplicate signal once and keeps the first evidence", () => {
    const r = scoreSignals(
      [sig("funding", "Seed, Aug 2026"), sig("funding", "other")],
      DEFAULT_WEIGHTS
    );
    expect(r.score).toBe(2);
    expect(r.reasons).toEqual(["funding (+2): Seed, Aug 2026"]);
  });

  it("maxes out at 13 with every signal", () => {
    expect(
      scoreSignals(
        SIGNAL_NAMES.map((n) => sig(n)),
        DEFAULT_WEIGHTS
      ).score
    ).toBe(13);
  });

  it("scores zero with no primary when there are no signals", () => {
    expect(scoreSignals([], DEFAULT_WEIGHTS)).toEqual({ score: 0, primary: null, reasons: [] });
  });

  it("lets custom weights change the primary signal", () => {
    expect(
      scoreSignals([sig("hiring"), sig("stack_match")], { ...DEFAULT_WEIGHTS, stack_match: 5 })
        .primary?.name
    ).toBe("stack_match");
  });
});
