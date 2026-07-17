/**
 * Unit tests for statement-categorization.service.ts
 *
 * Uses the Gemini API (gemini-2.0-flash-lite by default).
 * All tests mock global `fetch` so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapMccToCategory,
  buildCategorizationPrompt,
} from "@/server/services/statement-categorization.service";

// ── helpers ──────────────────────────────────────────────────────────────────

function geminiResponse(text: string, opts: { httpStatus?: number } = {}) {
  return {
    status: opts.httpStatus ?? 200,
    ok: (opts.httpStatus ?? 200) < 400,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    text: async () => "error",
  };
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
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it("returns empty array for empty input (no fetch call)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch([]);
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns fallback results when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("Other");
    expect(result[0].merchantName).toBe("Starbucks");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses a successful Gemini response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", category: "Restaurants & Cafes" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(apiPayload) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["STARBUCKS"]);
    expect(result).toHaveLength(1);
    expect(result[0].merchantName).toBe("Starbucks");
    expect(result[0].category).toBe("Restaurants & Cafes");
    expect(result[0].mccCode).toBe("0000");
  });

  it("handles JSON wrapped in markdown fences", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const wrapped = "```json\n" + JSON.stringify([
      { description: "UBER", merchantName: "Uber", category: "Ride-sharing & Taxis" },
    ]) + "\n```";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(wrapped) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["UBER"]);
    expect(result[0].category).toBe("Ride-sharing & Taxis");
  });

  it("falls back to Other when Gemini returns malformed JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("not valid json at all") as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Amazon"]);
    expect(result[0].category).toBe("Other");
    expect(result[0].merchantName).toBe("Amazon");
  });

  it("falls back when Gemini returns non-array JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse('{"error":"oops"}') as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Spotify"]);
    expect(result[0].category).toBe("Other");
  });

  it("falls back for items with invalid category", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "Mystery Store", merchantName: "Mystery", category: "Not A Real Category" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(apiPayload) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Mystery Store"]);
    expect(result[0].category).toBe("Other");
    expect(result[0].merchantName).toBe("Mystery Store");
  });

  it("falls back on HTTP error from Gemini API", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      status: 429, ok: false, text: async () => "Too Many Requests",
    } as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Tesco"]);
    expect(result[0].category).toBe("Other");
  });

  it("falls back when fetch throws", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Waitrose"]);
    expect(result[0].category).toBe("Other");
  });

  it("categorizes multiple items correctly in one batch", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", category: "Restaurants & Cafes" },
      { description: "DELTA AIR", merchantName: "Delta Air",  category: "Flights" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(apiPayload) as unknown as Response);

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
    expect(buildCategorizationPrompt(["Upwork Pro membership"])).toContain("Professional Services");
  });
  it("maps Fiverr to Professional Services", () => {
    expect(buildCategorizationPrompt(["Fiverr gig payment"])).toContain("Professional Services");
  });
  it("maps Netflix to Movies & Streaming", () => {
    expect(buildCategorizationPrompt(["Netflix monthly subscription"])).toContain("Movies & Streaming");
  });
  it("maps Spotify to Movies & Streaming", () => {
    expect(buildCategorizationPrompt(["Spotify Premium"])).toContain("Movies & Streaming");
  });
  it("maps ChatGPT to Software & Subscriptions", () => {
    expect(buildCategorizationPrompt(["ChatGPT Plus"])).toContain("Software & Subscriptions");
  });
  it("maps GitHub Copilot to Software & Subscriptions", () => {
    expect(buildCategorizationPrompt(["GitHub Copilot subscription"])).toContain("Software & Subscriptions");
  });
});
