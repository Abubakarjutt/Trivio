import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransactionsFromImage } from "@/server/services/image-statement.service";

describe("parseTransactionsFromImage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty array when Ollama is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(result).toEqual([]);
  });

  it("parses valid Ollama vision response into RawTransactions", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)          // health check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify([
              { date: "2026-05-01", description: "Woolworths", amount: 45.20, type: "DEBIT" },
              { date: "2026-05-03", description: "Salary", amount: 4000.00, type: "CREDIT" },
            ]),
          },
        }),
      } as Response);

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-05-01", description: "Woolworths", amount: 45.20, type: "DEBIT" });
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

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
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

    const txns = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe("Uber");
  });

  it("returns empty array on unparseable Ollama response", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "I cannot read this image." } }),
      } as Response);

    const result = await parseTransactionsFromImage(Buffer.from("fake-image"));
    expect(result).toEqual([]);
  });

  it("sends image as base64 in Ollama request body", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "[]" } }),
      } as Response);

    const imageBuffer = Buffer.from("test-image-data");
    await parseTransactionsFromImage(imageBuffer);

    const chatCall = fetchSpy.mock.calls[1];
    const body = JSON.parse(chatCall![1]!.body as string);
    expect(body.messages[0].images).toHaveLength(1);
    expect(body.messages[0].images[0]).toBe(imageBuffer.toString("base64"));
  });
});
