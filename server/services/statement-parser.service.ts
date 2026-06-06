/**
 * StatementParserService — pure CSV parsing and duplicate detection.
 * No external dependencies; fully unit-testable without mocking.
 */

export type StatementTransactionType = "DEBIT" | "CREDIT";

export interface ColumnMap {
  date: number;
  description: number;
  amount?: number;   // undefined when no combined amount column exists
  debit?: number;
  credit?: number;
}

export interface RawTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  type: StatementTransactionType;
}

export interface ExistingTransaction {
  id: string;
  date: Date | string;
  description: string;
  amount: number;
}

export interface DuplicateMatch {
  incoming: RawTransaction;
  existingId: string;
  similarity: number;
}

export interface DedupeResult {
  safe: RawTransaction[];
  duplicates: DuplicateMatch[];
}

const DATE_HEADERS = ["date", "txn date", "transaction date", "posted date", "value date", "trans date", "posting date"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "txn amount", "net amount"];
const DEBIT_HEADERS = ["debit", "debit amount", "withdrawal", "withdrawals", "dr", "out"];
const CREDIT_HEADERS = ["credit", "credit amount", "deposit", "deposits", "cr", "in"];
const DESC_HEADERS = ["description", "memo", "narration", "particulars", "details", "reference", "transaction details", "payee", "narrative"];

/**
 * Match a header `h` against a pattern `p`.
 * Short patterns (≤ 3 chars, e.g. "cr", "dr", "in") must be whole-word matches
 * to avoid false positives like "description".includes("cr").
 * Longer patterns use substring matching as before.
 */
function headerMatches(h: string, p: string): boolean {
  if (p.length <= 3) {
    // exact or whole-word (split on non-alpha boundaries like spaces, slashes, underscores)
    return h === p || h.split(/[^a-z]+/).includes(p);
  }
  return h.includes(p);
}

export function autoDetectColumns(headers: string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase().trim());

  const dateIdx   = lower.findIndex((h) => DATE_HEADERS.some((d)   => headerMatches(h, d)));
  const descIdx   = lower.findIndex((h) => DESC_HEADERS.some((d)   => headerMatches(h, d)));
  const amountIdx = lower.findIndex((h) => AMOUNT_HEADERS.some((a) => headerMatches(h, a)));
  const debitIdx  = lower.findIndex((h) => DEBIT_HEADERS.some((d)  => headerMatches(h, d)));
  const creditIdx = lower.findIndex((h) => CREDIT_HEADERS.some((c) => headerMatches(h, c)));

  if (dateIdx === -1)
    throw new Error("Could not detect date column. Expected headers like: date, txn date, transaction date");
  if (descIdx === -1)
    throw new Error("Could not detect description column. Expected headers like: description, memo, narration, payee");
  if (amountIdx === -1 && (debitIdx === -1 || creditIdx === -1))
    throw new Error("Could not detect amount column(s). Expected: 'amount', or both 'debit' + 'credit' columns");

  return {
    date: dateIdx,
    description: descIdx,
    ...(amountIdx !== -1 ? { amount: amountIdx } : {}),
    ...(debitIdx !== -1 ? { debit: debitIdx } : {}),
    ...(creditIdx !== -1 ? { credit: creditIdx } : {}),
  };
}

export function normalizeAmount(raw: string): { amount: number; type: StatementTransactionType } {
  const trimmed = raw.trim();
  const isParenNeg = /^\([\d,$.]+\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[$(),\s]/g, "");
  const isNeg = cleaned.startsWith("-") || isParenNeg;
  const abs = Math.abs(parseFloat(cleaned.replace("-", "")));
  if (isNaN(abs)) throw new Error(`Cannot parse amount: "${raw}"`);
  return { amount: abs, type: isNeg ? "DEBIT" : "CREDIT" };
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === "," && !inQuotes) { cols.push(current.trim()); current = ""; }
    else { current += c; }
  }
  cols.push(current.trim());
  return cols.map((c) => c.replace(/^"|"$/g, ""));
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const dmonY = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmonY) {
    const M: Record<string, string> = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
    const m = M[dmonY[2].toLowerCase()];
    if (m) return `${dmonY[3]}-${m}-${dmonY[1].padStart(2, "0")}`;
  }
  return null;
}

export function parseCsvBuffer(buffer: Buffer, columnMap: ColumnMap): RawTransaction[] {
  const lines = buffer.toString("utf-8").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const result: RawTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawDate = cols[columnMap.date]?.trim();
    const rawDesc = cols[columnMap.description]?.trim();
    if (!rawDate || !rawDesc) continue;

    const date = parseDate(rawDate);
    if (!date) continue;

    let amount: number;
    let type: StatementTransactionType;

    if (columnMap.amount !== undefined) {
      const raw = cols[columnMap.amount]?.trim();
      if (!raw) continue;
      try { ({ amount, type } = normalizeAmount(raw)); } catch { continue; }
    } else if (columnMap.debit !== undefined && columnMap.credit !== undefined) {
      const rawD = cols[columnMap.debit]?.trim();
      const rawC = cols[columnMap.credit]?.trim();
      if (rawD && rawD !== "" && rawD !== "0" && rawD !== "0.00") {
        try { ({ amount } = normalizeAmount(rawD)); type = "DEBIT"; } catch { continue; }
      } else if (rawC && rawC !== "" && rawC !== "0" && rawC !== "0.00") {
        try { ({ amount } = normalizeAmount(rawC)); type = "CREDIT"; } catch { continue; }
      } else { continue; }
    } else { continue; }

    result.push({ date, description: rawDesc, amount, type });
  }
  return result;
}

export function levenshteinSimilarity(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  const max = Math.max(la.length, lb.length);
  if (max === 0) return 1;
  const dp = Array.from({ length: la.length + 1 }, (_, i) =>
    Array.from({ length: lb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la.length; i++)
    for (let j = 1; j <= lb.length; j++)
      dp[i][j] = la[i-1] === lb[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[la.length][lb.length] / max;
}

function descriptionMatches(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  // Direct Levenshtein similarity
  if (levenshteinSimilarity(la, lb) > 0.8) return true;
  // One contains the other (handles "Netflix" vs "NETFLIX.COM" style variants)
  if (la.includes(lb) || lb.includes(la)) return true;
  return false;
}

export function deduplicateIncoming(transactions: RawTransaction[]): RawTransaction[] {
  const seen: RawTransaction[] = [];
  for (const txn of transactions) {
    // Within a single AI parse, only deduplicate on high Levenshtein similarity —
    // the includes() check used in detectDuplicates is too broad here and can
    // incorrectly drop real transactions with short descriptions (e.g. "PURCHASE"
    // matching "PURCHASE REF 12345" on the same date and amount).
    const isDupe = seen.some(
      (s) =>
        s.date === txn.date &&
        Math.abs(s.amount - txn.amount) <= 0.001 &&
        levenshteinSimilarity(s.description.toLowerCase(), txn.description.toLowerCase()) > 0.8
    );
    if (!isDupe) seen.push(txn);
  }
  return seen;
}

export function detectDuplicates(incoming: RawTransaction[], existing: ExistingTransaction[]): DedupeResult {
  const safe: RawTransaction[] = [];
  const duplicates: DuplicateMatch[] = [];

  for (const txn of incoming) {
    const match = existing.find((ex) => {
      const exDate = ex.date instanceof Date
        ? ex.date.toISOString().slice(0, 10)
        : String(ex.date).slice(0, 10);
      if (exDate !== txn.date) return false;
      if (Math.abs(Number(ex.amount) - txn.amount) > 0.001) return false;
      return descriptionMatches(ex.description, txn.description);
    });
    if (match) {
      duplicates.push({ incoming: txn, existingId: match.id, similarity: levenshteinSimilarity(match.description, txn.description) });
    } else {
      safe.push(txn);
    }
  }
  return { safe, duplicates };
}
