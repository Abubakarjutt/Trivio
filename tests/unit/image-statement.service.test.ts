/**
 * Unit tests for image-statement.service.ts — parseTransactionsFromImage
 *
 * Migrated from Ollama to Gemini API. All tests mock global `fetch` so no
 * real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── helpers ──────────────────────────────────────────────────────────────────

function geminiResponse(text: string, opts: { thought?: boolean; httpStatus?: number } = {}) {
  const parts = opts.thought
    ? [
        { text: "Thinking...", thought: true },
        { text, thought: false },
      ]
    : [{ text }];
  return {
    status: opts.httpStatus ?? 200,
    ok: (opts.httpStatus ?? 200) < 400,
    json: async () => ({ candidates: [{ content: { parts } }] }),
    text: async () => "error body",
  };
}

const VALID_TRANSACTIONS_JSON = JSON.stringify([
  { date: "2025-05-10", description: "BP FUEL",         amount: 60.00, type: "DEBIT"  },
  { date: "2025-05-15", description: "SALARY TRANSFER", amount: 4500,  type: "CREDIT" },
]);

function makeBuffer(content = "fake image data") {
  return Buffer.from(content, "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// parseTransactionsFromImage
// ─────────────────────────────────────────────────────────────────────────────
describe("parseTransactionsFromImage", () => {
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

  it("returns empty array when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses a valid Gemini JSON response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(VALID_TRANSACTIONS_JSON) as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: "2025-05-10", description: "BP FUEL", amount: 60, type: "DEBIT" });
    expect(result[1]).toMatchObject({ type: "CREDIT" });
  });

  it("filters thought parts from thinking-model responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(
      geminiResponse(VALID_TRANSACTIONS_JSON, { thought: true }) as unknown as Response
    );

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(2);
    expect(result[0].description).toBe("BP FUEL");
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fenced = "```json\n" + VALID_TRANSACTIONS_JSON + "\n```";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(fenced) as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(2);
  });

  it("sends image as base64 inlineData with the correct mimeType", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("[]") as unknown as Response);

    const imgBuffer = Buffer.from("PNG_DATA_HERE", "utf-8");
    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    await parseTransactionsFromImage(imgBuffer, "image/png");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    const parts = body.contents[0].parts;
    const inlineDataPart = parts.find((p: { inlineData?: { mimeType: string } }) => p.inlineData);
    expect(inlineDataPart.inlineData.mimeType).toBe("image/png");
    expect(inlineDataPart.inlineData.data).toBe(imgBuffer.toString("base64"));
  });

  it("defaults mimeType to image/jpeg when not specified", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("[]") as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    await parseTransactionsFromImage(makeBuffer());

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    const parts = body.contents[0].parts;
    const inlineDataPart = parts.find((p: { inlineData?: { mimeType: string } }) => p.inlineData);
    expect(inlineDataPart.inlineData.mimeType).toBe("image/jpeg");
  });

  it("returns empty array when Gemini returns malformed JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("not valid json") as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(0);
  });

  it("filters out rows missing required fields", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const partial = JSON.stringify([
      { date: "2025-05-10", description: "Valid",    amount: 5.0,  type: "DEBIT"    },
      { date: "2025-05-11",                          amount: 5.0,  type: "DEBIT"    }, // no description
      {                     description: "No Date",  amount: 5.0,  type: "CREDIT"   }, // no date
      { date: "2025-05-12", description: "Bad Amt",               type: "DEBIT"    }, // no amount
      { date: "2025-05-13", description: "Bad Typ",  amount: 1.0,  type: "TRANSFER" }, // invalid type
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(partial) as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Valid");
  });

  it("uppercases lowercase type strings", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const payload = JSON.stringify([
      { date: "2025-05-10", description: "Test", amount: 10.0, type: "credit" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(payload) as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result[0].type).toBe("CREDIT");
  });

  it("returns empty array on HTTP error from Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      status: 503, ok: false, text: async () => "Service Unavailable",
    } as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(0);
  });

  it("returns empty array when fetch throws (network timeout)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(0);
  });

  it("returns empty array when Gemini returns an empty candidates array", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ candidates: [] }),
    } as unknown as Response);

    const { parseTransactionsFromImage } = await import("@/server/services/image-statement.service");
    const result = await parseTransactionsFromImage(makeBuffer());
    expect(result).toHaveLength(0);
  });
});
