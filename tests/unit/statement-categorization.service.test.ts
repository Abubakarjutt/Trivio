/**
 * Unit tests for statement-categorization.service.ts
 *
 * Migrated to use the Anthropic Claude SDK (claude-haiku-4-5-20251001).
 * All tests mock @anthropic-ai/sdk so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapMccToCategory,
  buildCategorizationPrompt,
} from "@/server/services/statement-categorization.service";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function claudeResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// mapMccToCategory
// ─────────────────────────────────────────────────────────────────────────────
describe("mapMccToCategory", () => {
  it("maps grocery store MCC to Groceries", () => {
    expect(mapMccToCategory("5411")).toBe("Groceries");
  });

  it("maps restaurant MCC to Restaurants & Cafes", () => {
    expect(mapMccToCategory("5812")).toBe("Restaurants & Cafes");
  });

  it("maps taxi MCC to Ride-sharing & Taxis", () => {
    expect(mapMccToCategory("4121")).toBe("Ride-sharing & Taxis");
  });

  it("maps airline MCC to Flights", () => {
    expect(mapMccToCategory("3001")).toBe("Flights");
  });

  it("maps utility MCC to Electricity & Gas", () => {
    expect(mapMccToCategory("4911")).toBe("Electricity & Gas");
  });

  it("maps software MCC to Software & Subscriptions", () => {
    expect(mapMccToCategory("7372")).toBe("Software & Subscriptions");
  });

  it("maps financial MCC to Bank Fees & Charges", () => {
    expect(mapMccToCategory("6010")).toBe("Bank Fees & Charges");
  });

  it("returns empty string for unknown MCC", () => {
    expect(mapMccToCategory("9999")).toBe("");
  });

  it("returns empty string for 0000 fallback code", () => {
    expect(mapMccToCategory("0000")).toBe("");
  });

  it("returns empty string for non-numeric string", () => {
    expect(mapMccToCategory("ABCD")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCategorizationPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe("buildCategorizationPrompt", () => {
  it("includes all descriptions in the prompt", () => {
    const prompt = buildCategorizationPrompt(["Starbucks", "Netflix", "Amazon"]);
    expect(prompt).toContain("Starbucks");
    expect(prompt).toContain("Netflix");
    expect(prompt).toContain("Amazon");
  });

  it("states the correct count of descriptions", () => {
    const prompt = buildCategorizationPrompt(["A", "B", "C"]);
    expect(prompt).toContain("3 objects");
  });

  it("instructs to return a JSON array", () => {
    const prompt = buildCategorizationPrompt(["test"]);
    expect(prompt).toContain("JSON array");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// categorizeBatch
// ─────────────────────────────────────────────────────────────────────────────
describe("categorizeBatch", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns empty array for empty input (no API call)", async () => {
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch([]);
    expect(result).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("parses a successful Claude response", async () => {
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", category: "Restaurants & Cafes" },
    ]);
    mockCreate.mockResolvedValue(claudeResponse(apiPayload));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["STARBUCKS"]);
    expect(result).toHaveLength(1);
    expect(result[0].merchantName).toBe("Starbucks");
    expect(result[0].category).toBe("Restaurants & Cafes");
    expect(result[0].mccCode).toBe("0000");
  });

  it("handles JSON wrapped in markdown fences", async () => {
    const wrapped = "```json\n" + JSON.stringify([
      { description: "UBER", merchantName: "Uber", category: "Ride-sharing & Taxis" },
    ]) + "\n```";
    mockCreate.mockResolvedValue(claudeResponse(wrapped));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["UBER"]);
    expect(result[0].category).toBe("Ride-sharing & Taxis");
  });

  it("falls back to Other when Claude returns malformed JSON", async () => {
    mockCreate.mockResolvedValue(claudeResponse("not valid json at all"));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Amazon"]);
    expect(result[0].category).toBe("Other");
    expect(result[0].merchantName).toBe("Amazon");
  });

  it("falls back when Claude returns non-array JSON", async () => {
    mockCreate.mockResolvedValue(claudeResponse('{"error":"oops"}'));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Spotify"]);
    expect(result[0].category).toBe("Other");
  });

  it("falls back for items with invalid category", async () => {
    const apiPayload = JSON.stringify([
      { description: "Mystery Store", merchantName: "Mystery", category: "Not A Real Category" },
    ]);
    mockCreate.mockResolvedValue(claudeResponse(apiPayload));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Mystery Store"]);
    expect(result[0].category).toBe("Other");
    expect(result[0].merchantName).toBe("Mystery Store");
  });

  it("falls back when Claude API throws", async () => {
    mockCreate.mockRejectedValue(new Error("Network error"));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Waitrose"]);
    expect(result[0].category).toBe("Other");
  });

  it("categorizes multiple items correctly in one batch", async () => {
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", category: "Restaurants & Cafes" },
      { description: "DELTA AIR", merchantName: "Delta Air",  category: "Flights" },
    ]);
    mockCreate.mockResolvedValue(claudeResponse(apiPayload));
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["STARBUCKS", "DELTA AIR"]);
    expect(result[0].category).toBe("Restaurants & Cafes");
    expect(result[1].category).toBe("Flights");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCategorizationPrompt — explicit category rules
// ─────────────────────────────────────────────────────────────────────────────
describe("buildCategorizationPrompt — explicit category rules", () => {
  it("maps Upwork to Professional Services", () => {
    const prompt = buildCategorizationPrompt(["Upwork Pro membership"]);
    expect(prompt).toContain("Upwork");
    expect(prompt).toContain("Professional Services");
  });

  it("maps Fiverr to Professional Services", () => {
    const prompt = buildCategorizationPrompt(["Fiverr gig payment"]);
    expect(prompt).toContain("Fiverr");
    expect(prompt).toContain("Professional Services");
  });

  it("maps Netflix to Movies & Streaming", () => {
    const prompt = buildCategorizationPrompt(["Netflix monthly subscription"]);
    expect(prompt).toContain("Netflix");
    expect(prompt).toContain("Movies & Streaming");
  });

  it("maps Spotify to Movies & Streaming", () => {
    const prompt = buildCategorizationPrompt(["Spotify Premium"]);
    expect(prompt).toContain("Spotify");
    expect(prompt).toContain("Movies & Streaming");
  });

  it("maps ChatGPT to Software & Subscriptions", () => {
    const prompt = buildCategorizationPrompt(["ChatGPT Plus"]);
    expect(prompt).toContain("ChatGPT");
    expect(prompt).toContain("Software & Subscriptions");
  });

  it("maps GitHub Copilot to Software & Subscriptions", () => {
    const prompt = buildCategorizationPrompt(["GitHub Copilot subscription"]);
    expect(prompt).toContain("GitHub Copilot");
    expect(prompt).toContain("Software & Subscriptions");
  });
});
