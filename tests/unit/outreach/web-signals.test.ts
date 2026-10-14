import { describe, expect, it } from "vitest";
import { findingStatus, mergeSignals } from "@/app/(app)/outreach/_components/web-signals";
import type { Signal } from "@/server/services/outreach/types";

const web: Signal = {
  name: "funding",
  evidence: "Raised $4M seed",
  source: "https://n.example.com/a",
};

describe("mergeSignals", () => {
  it("adds web signals the form lacks and keeps the form's own", () => {
    const pasted: Signal = { name: "funding", evidence: "Said they raised" };
    const hiring: Signal = {
      name: "hiring",
      evidence: "Hiring ML",
      source: "https://j.example.com",
    };
    expect(mergeSignals([pasted], [web, hiring])).toEqual([pasted, hiring]);
    expect(mergeSignals([], [web])).toEqual([web]);
  });
});

describe("findingStatus", () => {
  it("says a finding was added, edited, removed, or that the form's own was kept", () => {
    expect(findingStatus(web, [web])).toBe("Added to your signals above.");
    expect(findingStatus(web, [{ ...web, evidence: "Raised $4M in 2026" }])).toBe(
      "Added to your signals above (edited)."
    );
    expect(findingStatus(web, [])).toBe("Removed from your signals.");
    expect(findingStatus(web, [{ name: "funding", evidence: "From the paste" }])).toBe(
      "You already had this signal; yours is kept."
    );
  });
});
