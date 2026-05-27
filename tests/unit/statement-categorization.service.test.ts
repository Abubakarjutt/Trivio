import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapMccToCategory,
  buildCategorizationPrompt,
  categorizeBatch,
  CATEGORY_DEFINITIONS,
} from "@/server/services/statement-categorization.service";

// ─── mapMccToCategory ─────────────────────────────────────────────────────────

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

  it("returns Other for unknown MCC", () => {
    expect(mapMccToCategory("9999")).toBe("Other");
  });

  it("returns Other for 0000 fallback code", () => {
    expect(mapMccToCategory("0000")).toBe("Other");
  });

  it("returns Other for non-numeric string", () => {
    expect(mapMccToCategory("abcd")).toBe("Other");
  });
});

// ─── CATEGORY_DEFINITIONS ─────────────────────────────────────────────────────

describe("CATEGORY_DEFINITIONS", () => {
  it("has exactly 15 categories", () => {
    expect(CATEGORY_DEFINITIONS).toHaveLength(15);
  });

  it("includes Other as last fallback", () => {
    expect(CATEGORY_DEFINITIONS[14].name).toBe("Other");
  });

  it("every category has a name and icon", () => {
    for (const cat of CATEGORY_DEFINITIONS) {
      expect(cat.name).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });
});

// ─── buildCategorizationPrompt ────────────────────────────────────────────────

describe("buildCategorizationPrompt", () => {
  it("includes the input descriptions in the prompt", () => {
    const prompt = buildCategorizationPrompt(["Starbucks", "Netflix"]);
    expect(prompt).toContain("Starbucks");
    expect(prompt).toContain("Netflix");
  });

  it("mentions the expected count", () => {
    const prompt = buildCategorizationPrompt(["A", "B", "C"]);
    expect(prompt).toContain("3");
  });

  it("requests JSON array output", () => {
    const prompt = buildCategorizationPrompt(["test"]);
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("mccCode");
    expect(prompt).toContain("merchantName");
  });
});

// ─── categorizeBatch ─────────────────────────────────────────────────────────

describe("categorizeBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fallback results when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results).toHaveLength(2);
    expect(results[0].category).toBe("Other");
    expect(results[0].mccCode).toBe("0000");
    expect(results[0].merchantName).toBe("Starbucks");
  });

  it("returns empty array for empty input", async () => {
    const results = await categorizeBatch([]);
    expect(results).toHaveLength(0);
  });

  it("parses valid Ollama JSON response and maps MCC to category", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response) // health check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Eating Places & Restaurants" },
              { description: "Netflix", merchantName: "Netflix", mccCode: "5735", mccLabel: "Record Shops" },
            ]),
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results[0].category).toBe("Food & Dining");
    expect(results[0].mccCode).toBe("5812");
    expect(results[0].merchantName).toBe("Starbucks");
    expect(results[1].category).toBe("Entertainment");
  });

  it("returns fallback for items missing from Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", merchantName: "Starbucks", mccCode: "5812", mccLabel: "Restaurants" },
              // Netflix missing
            ]),
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Starbucks", "Netflix"]);
    expect(results).toHaveLength(2);
    expect(results[1].category).toBe("Other");
  });

  it("strips markdown code fences from Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "```json\n[{\"description\":\"Uber\",\"merchantName\":\"Uber\",\"mccCode\":\"4121\",\"mccLabel\":\"Taxicabs\"}]\n```",
          },
        }),
      } as Response);

    const results = await categorizeBatch(["Uber"]);
    expect(results[0].category).toBe("Transport");
  });
});
