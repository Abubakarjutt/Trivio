import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransactionsFromText } from "@/server/services/pdf-statement.service";

// Note: extractTextFromPdf is not unit-tested here because it requires
// pdfjs-dist loading real PDF binary data — it is covered by integration tests.

describe("parseTransactionsFromText", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty array when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await parseTransactionsFromText("some statement text");
    expect(result).toEqual([]);
  });

  it("parses valid Ollama response into RawTransactions", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" },
              { date: "2026-05-02", description: "Payroll", amount: 3200.00, type: "CREDIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("statement text");
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Starbucks", amount: 6.40, type: "DEBIT" });
    expect(txns[1]).toMatchObject({ type: "CREDIT" });
  });

  it("strips markdown fences from response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "```json\n[{\"date\":\"2026-05-01\",\"description\":\"Uber\",\"amount\":18.90,\"type\":\"DEBIT\"}]\n```",
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("text");
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("filters out items with missing required fields", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { description: "Starbucks", amount: 6.40, type: "DEBIT" }, // missing date
              { date: "2026-05-01", description: "Uber", amount: 18.90, type: "DEBIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromText("text");
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("returns empty array on unparseable Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "I cannot parse this document." } }),
      } as Response);

    const result = await parseTransactionsFromText("text");
    expect(result).toEqual([]);
  });
});
