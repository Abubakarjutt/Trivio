/**
 * ImageStatementService
 * Uses Ollama's vision API to extract transactions from a bank statement image.
 * Mirrors the fallback pattern from pdf-statement.service.ts.
 */
import type { RawTransaction } from "./statement-parser.service";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

const IMAGE_PARSE_PROMPT = `You are a bank statement parser. Extract all financial transactions visible in this bank or credit card statement image.

Return ONLY a valid JSON array. No markdown fences, no commentary.

Required shape:
[{ "date": "YYYY-MM-DD", "description": "merchant or description", "amount": 123.45, "type": "DEBIT" or "CREDIT" }]

Rules:
- date: YYYY-MM-DD format only
- amount: positive number
- type: DEBIT = money leaving account, CREDIT = money entering account
- Skip: header rows, running balance rows, opening/closing balance lines
- If a line is not a transaction, omit it`;

export async function parseTransactionsFromImage(buffer: Buffer): Promise<RawTransaction[]> {
  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[image-statement.service] Ollama not reachable — returning empty transaction list.");
    return [];
  }

  try {
    const base64Image = buffer.toString("base64");

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "user",
            content: IMAGE_PARSE_PROMPT,
            images: [base64Image],
          },
        ],
        stream: false,
        options: { temperature: 0.1, num_predict: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) return [];

    const data = await response.json() as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let parsed: unknown;
    try { parsed = JSON.parse(match[0]); } catch { return []; }
    if (!Array.isArray(parsed)) return [];

    return (parsed as Array<Partial<RawTransaction>>)
      .filter((item) => {
        const t = String(item.type ?? "").toUpperCase();
        return item.date && item.description && item.amount != null && (t === "DEBIT" || t === "CREDIT");
      })
      .map((item) => ({
        date: String(item.date),
        description: String(item.description),
        amount: Number(item.amount),
        type: String(item.type).toUpperCase() as "DEBIT" | "CREDIT",
      }));
  } catch {
    console.warn("[image-statement.service] Ollama request failed — returning empty transaction list.");
    return [];
  }
}
