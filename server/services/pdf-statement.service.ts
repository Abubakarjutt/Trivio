/**
 * PdfStatementService
 * Extracts text from PDF files using pdfjs-dist, then uses the Gemini API
 * to parse transaction rows from the extracted text.
 */
import type { RawTransaction } from "./statement-parser.service";
import { redactPii } from "./pii-redaction.service";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = process.env.GEMINI_MODEL   ?? "gemma-4-26b-a4b-it";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Dynamic import avoids SSR/webpack bundling issues with pdfjs-dist
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);

  // pdfjs v5 requires a truthy workerSrc even in Node.js — an empty string is
  // falsy and causes "Setting up fake worker failed: No GlobalWorkerOptions.workerSrc".
  // Resolve the bundled worker file as an absolute file:// URL so Node.js can load it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(pdfjsLib as any).GlobalWorkerOptions.workerSrc ||
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc === "./pdf.worker.mjs") {
    const { join } = await import("path");
    const workerPath = join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ");
    pages.push(text);
  }

  return pages.join("\n\n--- PAGE BREAK ---\n\n");
}

const PARSE_PROMPT = `You are a bank statement parser. Extract all financial transactions from the text below.

Return ONLY a valid JSON array. No markdown fences, no commentary.

Required shape:
[{ "date": "YYYY-MM-DD", "description": "merchant or description", "amount": 123.45, "type": "DEBIT" or "CREDIT" }]

Rules:
- date: YYYY-MM-DD format only
- amount: positive number
- type: DEBIT = money leaving account, CREDIT = money entering account
- Skip: header rows, running balance rows, opening/closing balance lines
- If a line is not a transaction, omit it

Statement text:
`;

export async function parseTransactionsFromText(text: string): Promise<RawTransaction[]> {
  if (!GEMINI_API_KEY) {
    console.warn("[pdf-statement.service] GEMINI_API_KEY not set — returning empty transaction list.");
    return [];
  }

  // Redact PII (account numbers, IBANs, card numbers, emails, phones) before
  // sending to the external Gemini API. Transaction rows are unaffected.
  const { redacted, stats } = redactPii(text.slice(0, 200_000));
  const piiFound = Object.values(stats).some((n) => n > 0);
  if (piiFound) {
    console.info("[pdf-statement.service] PII redacted before Gemini call:", stats);
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PARSE_PROMPT}${redacted}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      console.warn(`[pdf-statement.service] Gemini API error ${response.status} — returning empty list.`);
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
    console.warn("[pdf-statement.service] Gemini request failed — returning empty transaction list.", err);
    return [];
  }
}
