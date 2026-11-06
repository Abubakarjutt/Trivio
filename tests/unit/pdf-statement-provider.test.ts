import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateJson = vi.fn();
vi.mock("@/server/services/outreach/llm", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/llm")>()),
  createLlm: () => ({ generateJson }),
}));

import { parseTransactionsFromText } from "@/server/services/pdf-statement.service";
import { OutreachAiError } from "@/server/services/outreach/llm";

const SMS = "PKR 5,000.00 has been debited at 20:36 on 02-Nov-2026";

describe("parseTransactionsFromText provider routing", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    generateJson.mockReset();
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses with the local model when the provider is ollama, never calling Gemini", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    generateJson.mockResolvedValue({
      transactions: [{ date: "2026-11-02", description: "Debit", amount: 5000, type: "DEBIT" }],
    });
    await expect(parseTransactionsFromText(SMS)).resolves.toEqual([
      { date: "2026-11-02", description: "Debit", amount: 5000, type: "DEBIT" },
    ]);
    expect(generateJson.mock.calls[0][1].user).toContain("has been debited");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("defaults to the local model when no provider or Gemini key is configured", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    generateJson.mockResolvedValue({ transactions: [] });
    await expect(parseTransactionsFromText(SMS)).resolves.toEqual([]);
    expect(generateJson).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the local engine's own error through instead of a generic one", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    generateJson.mockRejectedValue(new OutreachAiError("Model not found. Pull gemma4:e4b in Settings first."));
    await expect(parseTransactionsFromText(SMS)).rejects.toThrow(/Pull gemma4:e4b/);
  }, 10_000);

  it("fails instead of reporting no transactions when Gemini is chosen without a key", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(parseTransactionsFromText(SMS)).rejects.toThrow(/unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 10_000);
});
