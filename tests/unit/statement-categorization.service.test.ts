/**
 * Unit tests for statement-categorization.service.ts
 *
 * Migrated from Ollama to Gemini API. All tests mock global `fetch` so no
 * real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapMccToCategory,
  buildCategorizationPrompt,
} from "@/server/services/statement-categorization.service";

// ── helpers ──────────────────────────────────────────────────────────────────

function geminiResponse(text: string, opts: { thought?: boolean; httpStatus?: number } = {}) {
  const parts = opts.thought
    ? [
        { text: "Let me think about this...", thought: true },
        { text, thought: false },
      ]
    : [{ text }];
  return {
    status: opts.httpStatus ?? 200,
    ok: (opts.httpStatus ?? 200) < 400,
    json: async () => ({ candidates: [{ content: { parts } }] }),
    text: async () => "error",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mapMccToCategory
// ─────────────────────────────────────────────────────────────────────────────
describe("mapMccToCategory", () => {
  it("maps grocery store MCC to Food & Dining", () => {
expect(mapMccToCategory("5411")).toBe("Food & Dining");
  });

  it("maps restaurant MCC to Food & Dining", () => {
expect(mapMccToCategory("5812")).toBe("Food & Dining");
  });

  it("maps transport MCC to Transport", () => {
expect(mapMccToCategory("4121")).toBe("Transport");
  });

  it("maps airline MCC to Travel", () => {
expect(mapMccToCategory("3001")).toBe("Travel");
  });

  it("maps utility MCC to Utilities", () => {
expect(mapMccToCategory("4911")).toBe("Utilities");
  });

  it("maps software MCC to Business Services", () => {
expect(mapMccToCategory("7372")).toBe("Business Services");
  });

  it("maps financial MCC to Financial", () => {
expect(mapMccToCategory("6010")).toBe("Financial");
  });

  it("returns Other for unknown MCC", () => {
expect(mapMccToCategory("9999")).toBe("Other");
  });

  it("returns Other for 0000 fallback code", () => {
expect(mapMccToCategory("0000")).toBe("Other");
  });

  it("returns Other for non-numeric string", () => {
expect(mapMccToCategory("ABCD")).toBe("Other");
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

  it("parses a successful Gemini response and maps MCC to category", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Eating Places/Restaurants" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(apiPayload) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["STARBUCKS"]);
    expect(result).toHaveLength(1);
    expect(result[0].merchantName).toBe("Starbucks");
    expect(result[0].mccCode).toBe("5812");
    expect(result[0].category).toBe("Food & Dining");
  });

  it("filters thought parts from thinking-model responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "NETFLIX.COM", merchantName: "Netflix", mccCode: "5735", mccLabel: "Record Stores" },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      geminiResponse(apiPayload, { thought: true }) as unknown as Response
    );

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["NETFLIX.COM"]);
    expect(result[0].merchantName).toBe("Netflix");
  });

  it("handles JSON wrapped in markdown fences", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const wrapped = "```json\n" + JSON.stringify([
      { description: "UBER", merchantName: "Uber", mccCode: "4111", mccLabel: "Local/Suburban Commuter" },
    ]) + "\n```";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(wrapped) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["UBER"]);
    expect(result[0].category).toBe("Transport");
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

  it("falls back for items missing mccCode in Gemini response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "Mystery Store", merchantName: "Mystery", mccLabel: "Unknown" }, // no mccCode
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

  it("falls back when fetch throws (network error)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["Waitrose"]);
    expect(result[0].category).toBe("Other");
  });

  it("categorizes multiple items correctly in one batch", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const apiPayload = JSON.stringify([
      { description: "STARBUCKS", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Restaurants" },
      { description: "DELTA AIR", merchantName: "Delta Air",  mccCode: "3058", mccLabel: "Airlines"    },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(apiPayload) as unknown as Response);

    const { categorizeBatch } = await import("@/server/services/statement-categorization.service");
    const result = await categorizeBatch(["STARBUCKS", "DELTA AIR"]);
    expect(result[0].category).toBe("Food & Dining");
    expect(result[1].category).toBe("Travel");
  });
});
