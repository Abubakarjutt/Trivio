import { describe, it, expect } from "vitest";
import { resolvePfCategory } from "@/server/services/pf-categories.service";

describe("resolvePfCategory", () => {
  const own = ["Petrol", "Stocks/Savings Fund"];

  it("prefers the user's own category, so their budget counts the transaction", () => {
    expect(resolvePfCategory("savings", own)).toBe("Stocks/Savings Fund");
    expect(resolvePfCategory("petrol", own)).toBe("Petrol");
    // Without own categories it snaps to built-in names as before.
    expect(resolvePfCategory("savings")).toBe("Other");
    expect(resolvePfCategory("fuel", own)).toBe("Fuel & Gas");
  });

  it("an exact built-in name beats a partial match on an own category", () => {
    expect(resolvePfCategory("Groceries", ["Groceries for Mum"])).toBe("Groceries");
  });

  it("falls back to Other for empty, too-short or unknown names", () => {
    expect(resolvePfCategory("", own)).toBe("Other");
    expect(resolvePfCategory("st", own)).toBe("Other");
    expect(resolvePfCategory("xyzzy", own)).toBe("Other");
  });
});
