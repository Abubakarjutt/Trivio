/**
 * PdfStatementService
 * Extracts text from PDF files using pdfjs-dist, then uses the Gemini API
 * to parse transaction rows from the extracted text.
 */
import type { RawTransaction } from "./statement-parser.service";
import { redactPii } from "./pii-redaction.service";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = process.env.GEMINI_MODEL   ?? "gemini-2.5-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// pdfjs-dist v5 doesn't export NodeCMapReaderFactory, so we provide one that
// reads from the bundled cmaps/ directory using the local filesystem. This
// prevents pdfjs from making any outgoing network requests when loading CMaps,
// which would fail in Node.js with "network error".
class LocalCMapReaderFactory {
  private cmapDir: string;
  constructor({ baseUrl }: { baseUrl: string; isCompressed?: boolean }) {
    this.cmapDir = baseUrl;
  }
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const data = await readFile(join(this.cmapDir, `${name}.bcmap`));
    return { cMapData: new Uint8Array(data), isCompressed: true };
  }
}

async function initPdfJs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  const { join } = await import("path");

  // pdfjs v5 requires a truthy workerSrc even in Node.js.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(pdfjsLib as any).GlobalWorkerOptions.workerSrc ||
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc === "./pdf.worker.mjs") {
    const workerPath = join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
  }

  const cmapDir = join(process.cwd(), "node_modules/pdfjs-dist/cmaps");
  return { pdfjsLib, cmapDir };
}

/**
 * Extracts text from each page of a PDF, returning one string per page.
 * Use this for per-page processing to keep SSE alive during long PDFs.
 */
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const { pdfjsLib, cmapDir } = await initPdfJs();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CMapReaderFactory: LocalCMapReaderFactory as any,
    cMapUrl: cmapDir + "/",
    cMapPacked: true,
    verbosity: 0,
  });
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
  return pages;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pages = await extractPdfPages(buffer);
  return pages.join("\n\n--- PAGE BREAK ---\n\n");
}

const PARSE_PROMPT = `Given the bank statement text below, return a JSON array of ALL transactions.

Each transaction must have these fields:
- date: convert to YYYY-MM-DD format
- description: payee, merchant, or transaction reference text
- amount: the transaction amount as a positive number (NEVER use the balance/running-total column)
- type: "DEBIT" if money left the account (payments, withdrawals, fees), "CREDIT" if money entered (deposits, refunds, interest)

IMPORTANT rules:
- Bank statements have columns like: Date | Description | Debit | Credit | Balance
- The BALANCE column shows the running account total — IGNORE it, never use it as the amount
- Include EVERY row that has a date: card payments, direct debits, standing orders, transfers, ATM withdrawals, bank fees, service charges, interest charges, interest credits, refunds, foreign-exchange fees
- Exclude ONLY: column header rows and explicit "Opening Balance" / "Closing Balance" summary lines
- If a row has a date and changed the account balance, include it — when in doubt, include it
- amounts must be positive numbers; direction is captured in the "type" field

Statement text:
`;

const PARSE_PROMPT_SUFFIX = `

JSON array:`;

async function callGemini(prompt: string): Promise<RawTransaction[]> {
  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${await response.text().catch(() => "")}`);
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
}

/**
 * Parses transactions from a single PDF page's text.
 * Returns [] for blank pages without throwing.
 */
export async function parsePageTransactions(pageText: string): Promise<RawTransaction[]> {
  if (!GEMINI_API_KEY) {
    console.warn("[pdf-statement.service] GEMINI_API_KEY not set — returning empty transaction list.");
    return [];
  }
  if (!pageText.trim()) return [];

  const { redacted, stats } = redactPii(pageText);
  if (Object.values(stats).some((n) => n > 0)) {
    console.info("[pdf-statement.service] PII redacted before Gemini call:", stats);
  }

  const prompt = `${PARSE_PROMPT}${redacted}${PARSE_PROMPT_SUFFIX}`;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGemini(prompt);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[pdf-statement.service] Page attempt ${attempt} failed, retrying…`, err);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.warn("[pdf-statement.service] Page failed after all attempts, skipping:", err);
      return [];
    }
  }
  return [];
}

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

  const prompt = `${PARSE_PROMPT}${redacted}${PARSE_PROMPT_SUFFIX}`;
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = await callGemini(prompt);
      if (results.length > 0) return results;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[pdf-statement.service] Gemini returned 0 transactions on attempt ${attempt}, retrying…`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      return results;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[pdf-statement.service] Gemini attempt ${attempt} failed, retrying…`, err);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      // All retries exhausted — throw a user-friendly message, not the raw network error
      throw new Error("AI parsing service unavailable after 3 attempts. Please try again in a moment.");
    }
  }

  return [];
}
