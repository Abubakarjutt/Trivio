/**
 * PdfStatementService
 * Extracts text from PDF files using pdfjs-dist, then uses Ollama to parse
 * transaction rows from the extracted text.
 */
import type { RawTransaction } from "./statement-parser.service";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Dynamic import avoids SSR/webpack bundling issues with pdfjs-dist
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  // Disable web worker — not available in Node.js environment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = "";

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
  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[pdf-statement.service] Ollama not reachable — returning empty transaction list.");
    return [];
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: `${PARSE_PROMPT}${text.slice(0, 12000)}` }],
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
    console.warn("[pdf-statement.service] Ollama request failed — returning empty transaction list.");
    return [];
  }
}
