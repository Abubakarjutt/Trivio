/**
 * Unit tests for pdf-statement.service.ts — parseTransactionsFromText
 *
 * Migrated to use the Anthropic Claude SDK (claude-haiku-4-5-20251001).
 * All tests mock @anthropic-ai/sdk so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/pii-redaction.service", () => ({
  redactPii: (t: string) => ({ redacted: t, stats: { totalRedactions: 0 } }),
  redactPiiText: (t: string) => t,
}));

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

const VALID_TRANSACTIONS_JSON = JSON.stringify([
  { date: "2025-06-01", description: "Starbucks Coffee",   amount: 4.50,   type: "DEBIT"  },
  { date: "2025-06-05", description: "Employer Payroll",   amount: 3000.0, type: "CREDIT" },
  { date: "2025-06-10", description: "Amazon Prime",       amount: 9.99,   type: "DEBIT"  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// parseTransactionsFromText
// ─────────────────────────────────────────────────────────────────────────────
describe("parseTransactionsFromText", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("parses a valid Claude response", async () => {
    mockCreate.mockResolvedValue(claudeResponse(VALID_TRANSACTIONS_JSON));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("statement text here");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ date: "2025-06-01", description: "Starbucks Coffee", amount: 4.5, type: "DEBIT" });
    expect(result[1]).toMatchObject({ type: "CREDIT" });
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    const fenced = "```json\n" + VALID_TRANSACTIONS_JSON + "\n```";
    mockCreate.mockResolvedValue(claudeResponse(fenced));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when Claude returns malformed JSON", async () => {
    mockCreate.mockResolvedValue(claudeResponse("not json at all"));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when Claude returns a non-array JSON", async () => {
    mockCreate.mockResolvedValue(claudeResponse('{"error":"unexpected"}'));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(0);
  });

  it("filters out rows missing required fields", async () => {
    const partial = JSON.stringify([
      { date: "2025-06-01", description: "Valid",    amount: 5.0, type: "DEBIT"   },
      { date: "2025-06-02",                          amount: 5.0, type: "DEBIT"   }, // no description
      {                     description: "No Date",  amount: 5.0, type: "DEBIT"   }, // no date
      { date: "2025-06-04", description: "No Amt",               type: "DEBIT"   }, // no amount
      { date: "2025-06-05", description: "Bad Type", amount: 1.0, type: "UNKNOWN" }, // bad type
    ]);
    mockCreate.mockResolvedValue(claudeResponse(partial));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Valid");
  });

  it("accepts lowercase type and uppercases it", async () => {
    const payload = JSON.stringify([
      { date: "2025-06-01", description: "Coffee", amount: 3.5, type: "debit" },
    ]);
    mockCreate.mockResolvedValue(claudeResponse(payload));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const result = await parseTransactionsFromText("text");
    expect(result[0].type).toBe("DEBIT");
  });

  it("retries when Claude returns 0 transactions and succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    mockCreate
      .mockResolvedValueOnce(claudeResponse("[]"))
      .mockResolvedValueOnce(claudeResponse(VALID_TRANSACTIONS_JSON));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const promise = parseTransactionsFromText("text");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(3);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries on error and succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    mockCreate
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce(claudeResponse(VALID_TRANSACTIONS_JSON));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const promise = parseTransactionsFromText("text");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(3);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws a user-friendly error after all attempts fail", async () => {
    vi.useFakeTimers();
    mockCreate.mockRejectedValue(new Error("API error"));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const promise = parseTransactionsFromText("text");
    const assertion = expect(promise).rejects.toThrow("AI parsing service unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(mockCreate).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("truncates text to 200,000 chars before sending to Claude", async () => {
    mockCreate.mockResolvedValue(claudeResponse(VALID_TRANSACTIONS_JSON));
    const { parseTransactionsFromText } = await import("@/server/services/pdf-statement.service");
    const longText = "x".repeat(201_000);
    await parseTransactionsFromText(longText);
    const sentContent = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(sentContent).not.toContain("x".repeat(201_000));
    expect(sentContent.length).toBeGreaterThan(200_000);
  });
});
