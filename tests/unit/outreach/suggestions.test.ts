import { describe, expect, it } from "vitest";
import { remainingAfterApply } from "@/app/(app)/outreach/_components/suggestions";

const s = [
  { i: 0, event: "message_sent" as const },
  { i: 1, event: "replied" as const },
  { i: 2, event: "message_sent" as const },
];

describe("remainingAfterApply", () => {
  it("keeps everything when nothing was applied", () => {
    expect(remainingAfterApply(s, [0, 1, 2], 0)).toEqual(s);
  });
  it("drops only the first applied picks, so a repeated event is not lost", () => {
    // picked rows 0 and 2 (both message_sent); only the first was applied.
    expect(remainingAfterApply(s, [0, 2], 1)).toEqual([s[1], s[2]]);
  });
  it("applies picks in suggestion order regardless of pick order", () => {
    expect(remainingAfterApply(s, [2, 0], 1)).toEqual([s[1], s[2]]);
  });
  it("keeps unpicked rows on a partial apply", () => {
    expect(remainingAfterApply(s, [1, 2], 1)).toEqual([s[0], s[2]]);
  });
  it("returns only the unpicked rows after a full apply", () => {
    expect(remainingAfterApply(s, [0, 1, 2], 3)).toEqual([]);
    expect(remainingAfterApply(s, [0, 2], 2)).toEqual([s[1]]);
  });
});
