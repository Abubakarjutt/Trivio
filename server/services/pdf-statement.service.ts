/**
 * PdfStatementService
 * Extracts text from PDF files using pdfjs-dist, then uses the Gemini API
 * to parse transaction rows from the extracted text.
 */
import type { RawTransaction } from "./statement-parser.service";
import { redactPii } from "./pii-redaction.service";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
// Default to gemini-2.0-flash-lite: generous free tier (1500 RPD, 15 RPM),
// much better than the old gemma-4-26b-a4b-it which had very low limits.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

  // Always set workerSrc unconditionally so the correct absolute file:// path
  // is used regardless of what pdfjs defaults to at module load time.
  const workerPath = join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
  console.log("[pdf] workerSrc set to", `file://${workerPath}`);

  const cmapDir = join(process.cwd(), "node_modules/pdfjs-dist/cmaps");
  return { pdfjsLib, cmapDir };
}

/**
 * Extracts text from each page of a PDF, returning one string per page.
 * Use this for per-page processing to keep SSE alive during long PDFs.
 */
const PDF_LOAD_TIMEOUT_MS = 90_000;

export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  console.log("[pdf] extractPdfPages start, buffer size:", buffer.length);
  const { pdfjsLib, cmapDir } = await initPdfJs();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CMapReaderFactory: LocalCMapReaderFactory as any,
    cMapUrl: cmapDir + "/",
    cMapPacked: true,
    verbosity: 0,
  });

  console.log("[pdf] loadingTask created, awaiting promise...");
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    console.error("[pdf] loadingTask.promise timed out after", PDF_LOAD_TIMEOUT_MS / 1000, "seconds — destroying task");
    try { loadingTask.destroy(); } catch { /* ignore */ }
  }, PDF_LOAD_TIMEOUT_MS);

  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    clearTimeout(timeoutId);
    if (timedOut) throw new Error(`PDF processing timed out after ${PDF_LOAD_TIMEOUT_MS / 1000}s. The file may be corrupted or too complex.`);
    throw err;
  }
  clearTimeout(timeoutId);
  console.log("[pdf] PDF loaded, numPages:", pdf.numPages);

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ");
    console.log(`[pdf] page ${i}/${pdf.numPages} extracted, chars: ${text.length}`);
    pages.push(text);
  }
  console.log("[pdf] extractPdfPages done, pages:", pages.length);
  return pages;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pages = await extractPdfPages(buffer);
  return pages.join("\n\n--- PAGE BREAK ---\n\n");
}

const PARSE_PROMPT = `Extract ALL financial transactions from the text below and return a JSON array.

The text may be a bank statement (table format) OR a bank/merchant notification email (prose format). Handle both:

TABLE FORMAT (bank statements):
- Columns like: Date | Description | Debit | Credit | Balance
- IGNORE the Balance/running-total column — never use it as the amount
- Include every row with a date: payments, withdrawals, transfers, ATM, fees, interest, refunds
- Exclude only: column header rows and "Opening Balance" / "Closing Balance" summary lines

NOTIFICATION FORMAT (bank alert or payment confirmation emails):
- Extract the transaction even if it is described in a single sentence
- Examples: "PKR 5,000 debited from your account at XYZ Store on 22-Jun-2026. Available balance: PKR 45,000."
  → { date: "2026-06-22", description: "XYZ Store", amount: 5000, type: "DEBIT" }
  (5000 is the transaction; 45000 is the balance — NEVER use the balance as the amount)
- Examples: "You received Rs. 10,000 from Ali Ahmed"
  → { date: "<today if no date given>", description: "Ali Ahmed", amount: 10000, type: "CREDIT" }
- CRITICAL: "Available balance", "Remaining balance", "Current balance" shown after a transaction — IGNORE completely, it is NOT the transaction amount
- The transaction amount is what was spent/received, always the FIRST amount mentioned

Each transaction MUST have:
- date: YYYY-MM-DD format (use today's date if not mentioned)
- description: payee, merchant, sender, or transaction reference
- amount: positive number (NEVER negative)
- type: "DEBIT" if money left the account, "CREDIT" if money entered

If no financial transaction is present in the text, return an empty array [].

Text:
`;

const PARSE_PROMPT_SUFFIX = `

JSON array:`;

async function callGemini(prompt: string): Promise<RawTransaction[]> {
  if (!GEMINI_API_KEY) {
    console.warn("[pdf-statement.service] GEMINI_API_KEY not set — returning empty list.");
    return [];
  }

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const content = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
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
  if (!pageText.trim()) return [];

  const { redacted, stats } = redactPii(pageText);
  if (Object.values(stats).some((n) => n > 0)) {
    console.info("[pdf-statement.service] PII redacted before Gemini call:", stats);
  }

  const prompt = `${PARSE_PROMPT}${redacted}${PARSE_PROMPT_SUFFIX}`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn("[pdf-statement.service] Page parse failed, skipping:", err);
    return [];
  }
}

export async function parseTransactionsFromText(text: string): Promise<RawTransaction[]> {
  const { redacted, stats } = redactPii(text.slice(0, 200_000));
  if (Object.values(stats).some((n) => n > 0)) {
    console.info("[pdf-statement.service] PII redacted before Gemini call:", stats);
  }

  const prompt = `${PARSE_PROMPT}${redacted}${PARSE_PROMPT_SUFFIX}`;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = await callGemini(prompt);
      if (results.length > 0) return results;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[pdf-statement.service] Gemini returned 0 transactions on attempt ${attempt}, retrying…`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return results;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[pdf-statement.service] Gemini attempt ${attempt} failed, retrying…`, err);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error("AI parsing service unavailable. Please try again in a moment.");
    }
  }

  return [];
}
