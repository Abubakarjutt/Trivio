// One SMS → zero or more transactions for the review queue. Reuses the same
// redact → parse → dedupe → categorise steps as statement imports. Nothing here
// writes StatementTransactions: approval does (smsImport.approve).
import type { PrismaClient } from "@prisma/client";
import { redactPiiText } from "@/server/services/pii-redaction.service";
import { parseTransactionsFromText } from "@/server/services/pdf-statement.service";
import {
  deduplicateIncoming,
  detectDuplicates,
  type ExistingTransaction,
} from "@/server/services/statement-parser.service";
import type { ImportCategorizer } from "@/server/services/categorize/category-rules.service";
import { findTokens, type RuleKey } from "@/server/services/categorize/counterparty-token";

export interface ParsedSmsTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  merchantName: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category: string;
  mccCode: string;
  mccLabel: string;
  possibleDuplicate: boolean;
  /** The category is a guess; the review asks "where did this money go?". */
  needsCategory?: boolean;
  /** What "Always use…" applies to. Set by the server only. */
  ruleKey?: RuleKey | null;
  /** A remembered rule set this row's category. Set by the server only. */
  ruleApplied?: boolean;
  /** "Always use…" checkbox; defaults to true. */
  rememberRule?: boolean;
  /** The user picked this row's category in review. */
  userCategorized?: boolean;
}

export type ProcessSmsResult =
  | { status: "PENDING_REVIEW"; redactedText: string; parsed: ParsedSmsTransaction[] }
  | { status: "NO_TRANSACTION"; redactedText: string; parsed: [] }
  | { status: "FAILED"; redactedText: string; parsed: []; error: string };

const MAX_DATE_DRIFT_DAYS = 3;
const DEDUP_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
// Above NUMERIC(19,4)'s 15 integer digits.
export const MAX_AMOUNT = 1e15;

export function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// YYYY-MM-DD that names a day on the calendar ("2026-02-30" does not).
export function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Bank SMS often omit the year ("on 30-Oct"), so the AI can guess wrong.
// Trust the parsed date only when it is a real date close to when the SMS arrived.
export function resolveDate(parsed: string, receivedAt: Date): string {
  const fallback = localDateString(receivedAt);
  if (!isRealIsoDate(parsed)) return fallback;
  const t = Date.parse(`${parsed}T12:00:00`);
  if (Number.isNaN(t)) return fallback;
  return Math.abs(t - receivedAt.getTime()) / DAY_MS > MAX_DATE_DRIFT_DAYS ? fallback : parsed;
}

export async function processSms(
  text: string,
  receivedAt: Date,
  existing: ExistingTransaction[],
  categorizer: ImportCategorizer,
): Promise<ProcessSmsResult> {
  const redactedText = redactPiiText(categorizer.tokenize(text));
  try {
    const raw = deduplicateIncoming(await parseTransactionsFromText(redactedText))
      .filter((t) => Number.isFinite(t.amount) && Math.abs(t.amount) < MAX_AMOUNT)
      .map((t) => ({ ...t, amount: Math.abs(t.amount) }));
    if (raw.length === 0) return { status: "NO_TRANSACTION", redactedText, parsed: [] };

    const dated = raw.map((t) => ({ ...t, date: resolveDate(t.date, receivedAt) }));
    // Existing rows imported before tokens hold raw numbers; tokenize them the same way so they still match.
    const comparable = existing.map((e) => ({ ...e, description: categorizer.tokenize(e.description) }));
    const dupes = new Set(detectDuplicates(dated, comparable).duplicates.map((d) => d.incoming));
    // One SMS is (almost always) one transaction: if it names exactly one counterparty,
    // that's who the money went to even if the parser's description dropped the token.
    // A single phone wins over account numbers (a transfer names both).
    const tokens = [...new Set(findTokens(redactedText))];
    const phones = tokens.filter((t) => t.startsWith("[PHONE "));
    const hint = phones.length === 1 ? phones[0]! : tokens.length === 1 ? tokens[0]! : null;
    const categories = await categorizer.categorize(
      dated.map((t) => (hint && !t.description.includes(hint) ? { description: t.description, counterpartyHint: hint } : { description: t.description })),
    );

    const parsed = dated.map((t, i): ParsedSmsTransaction => ({
      date: t.date,
      description: t.description,
      merchantName: categories[i]?.merchantName || t.description,
      amount: t.amount,
      type: t.type,
      category: categories[i]?.category ?? "Other",
      mccCode: categories[i]?.mccCode ?? "0000",
      mccLabel: categories[i]?.mccLabel ?? "Uncategorized",
      possibleDuplicate: dupes.has(t),
      needsCategory: categories[i]?.needsCategory ?? true,
      ruleKey: categories[i]?.ruleKey ?? null,
      ruleApplied: categories[i]?.ruleApplied ?? false,
      rememberRule: true,
      userCategorized: false,
    }));
    return { status: "PENDING_REVIEW", redactedText, parsed };
  } catch (err) {
    return {
      status: "FAILED",
      redactedText,
      parsed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loadExistingForDedup(
  db: Pick<PrismaClient, "statementTransaction">,
  organisationId: string,
  now: Date,
): Promise<ExistingTransaction[]> {
  const rows = await db.statementTransaction.findMany({
    where: { organisationId, date: { gte: new Date(now.getTime() - DEDUP_WINDOW_DAYS * DAY_MS) } },
    select: { id: true, date: true, description: true, amount: true },
  });
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}
