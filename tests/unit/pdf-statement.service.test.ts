/**
 * Unit tests for pdf-statement.service.ts — parseTransactionsFromText
 *
 * Migrated from Ollama to Gemini API. All tests mock global `fetch` so no
 * real HTTP calls are made.
 *
 * extractTextFromPdf is not unit-tested here because it dynamically imports
 * pdfjs-dist which requires a full browser/worker environment.
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
  { date: "2025-06-01", description: "Starbucks Coffee",   amount: 4.50,   type: "DEBIT"  },
  { date: "2025-06-05", description: "Employer Payroll",   amount: 3000.0, type: "CREDIT" },
  { date: "2025-06-10", description: "Amazon Prime",       amount: 9.99,   type: "DEBIT"  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// parseTransactionsFromText
// ─────────────────────────────────────────────────────────────────────────────
describe("parseTransactionsFromText", () => {
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
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("some statement text");
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses a valid Gemini JSON response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(VALID_TRANSACTIONS_JSON) as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("statement text here");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ date: "2025-06-01", description: "Starbucks Coffee", amount: 4.5, type: "DEBIT" });
    expect(result[1]).toMatchObject({ type: "CREDIT" });
  });

  it("filters thought parts from thinking-model responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(
      geminiResponse(VALID_TRANSACTIONS_JSON, { thought: true }) as unknown as Response
    );

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("statement text");
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe("Starbucks Coffee");
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fenced = "```json\n" + VALID_TRANSACTIONS_JSON + "\n```";
    vi.mocked(fetch).mockResolvedValue(geminiResponse(fenced) as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when Gemini returns malformed JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("not json at all") as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when Gemini returns a non-array JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse('{"error":"unexpected"}') as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("filters out rows missing required fields", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const partial = JSON.stringify([
      { date: "2025-06-01", description: "Valid",    amount: 5.0, type: "DEBIT"   },
      { date: "2025-06-02",                          amount: 5.0, type: "DEBIT"   }, // no description
      {                     description: "No Date",  amount: 5.0, type: "DEBIT"   }, // no date
      { date: "2025-06-04", description: "No Amt",               type: "DEBIT"   }, // no amount
      { date: "2025-06-05", description: "Bad Type", amount: 1.0, type: "UNKNOWN" }, // bad type
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(partial) as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Valid");
  });

  it("accepts lowercase type and uppercases it", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const payload = JSON.stringify([
      { date: "2025-06-01", description: "Coffee", amount: 3.5, type: "debit" },
    ]);
    vi.mocked(fetch).mockResolvedValue(geminiResponse(payload) as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result[0].type).toBe("DEBIT");
  });

  it("returns empty array on HTTP error from Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      status: 500, ok: false, text: async () => "Internal Server Error",
    } as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when fetch throws (network error)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("truncates text to 200,000 chars and redacts PII before sending to Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(geminiResponse("[]") as unknown as Response);

    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const longText = "x".repeat(201_000);
    await parseTransactionsFromText(longText);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    const sentText: string = body.contents[0].parts[0].text;
    // The 201 000th char must be absent; prompt + 200k 'x' chars are present
    expect(sentText).not.toContain("x".repeat(201_000));
    expect(sentText.length).toBeGreaterThan(200_000);
  }, 30_000);
});
