/**
 * ImageStatementService
 * Uses the Gemini API's vision capability to extract transactions from a
 * bank statement image.
 */
import type { RawTransaction } from "./statement-parser.service";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = process.env.GEMINI_MODEL   ?? "gemma-4-26b-a4b-it";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

export async function parseTransactionsFromImage(buffer: Buffer, mimeType = "image/jpeg"): Promise<RawTransaction[]> {
  if (!GEMINI_API_KEY) {
    console.warn("[image-statement.service] GEMINI_API_KEY not set — returning empty transaction list.");
    return [];
  }

  try {
    const base64Image = buffer.toString("base64");

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: IMAGE_PARSE_PROMPT },
            { inlineData: { mimeType, data: base64Image } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      console.warn(`[image-statement.service] Gemini API error ${response.status} — returning empty list.`);
      return [];
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    // Thinking models return thought parts before the answer — skip them.
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = parts.find((p) => !p.thought)?.text ?? "";
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
  } catch (err) {
    console.warn("[image-statement.service] Gemini request failed — returning empty transaction list.", err);
    return [];
  }
}
