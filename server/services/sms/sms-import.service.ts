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
import { categorizeBatch } from "@/server/services/statement-categorization.service";

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
}

export type ProcessSmsResult =
  | { status: "PENDING_REVIEW"; redactedText: string; parsed: ParsedSmsTransaction[] }
  | { status: "NO_TRANSACTION"; redactedText: string; parsed: [] }
  | { status: "FAILED"; redactedText: string; parsed: []; error: string };

const MAX_DATE_DRIFT_DAYS = 3;
const DEDUP_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Bank SMS often omit the year ("on 30-Oct"), so the AI can guess wrong.
// Trust the parsed date only when it is a real date close to when the SMS arrived.
export function resolveDate(parsed: string, receivedAt: Date): string {
  const fallback = localDateString(receivedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return fallback;
  const t = Date.parse(`${parsed}T12:00:00`);
  if (Number.isNaN(t)) return fallback;
  return Math.abs(t - receivedAt.getTime()) / DAY_MS > MAX_DATE_DRIFT_DAYS ? fallback : parsed;
}

export async function processSms(
  text: string,
  receivedAt: Date,
  existing: ExistingTransaction[],
): Promise<ProcessSmsResult> {
  const redactedText = redactPiiText(text);
  try {
    const raw = deduplicateIncoming(await parseTransactionsFromText(redactedText));
    if (raw.length === 0) return { status: "NO_TRANSACTION", redactedText, parsed: [] };

    const dated = raw.map((t) => ({ ...t, date: resolveDate(t.date, receivedAt) }));
    const dupes = new Set(detectDuplicates(dated, existing).duplicates.map((d) => d.incoming));
    const categories = await categorizeBatch(dated.map((t) => t.description));

    const parsed = dated.map((t, i): ParsedSmsTransaction => ({
      date: t.date,
      description: t.description,
      merchantName: categories[i]?.merchantName ?? t.description,
      amount: t.amount,
      type: t.type,
      category: categories[i]?.category ?? "Other",
      mccCode: categories[i]?.mccCode ?? "0000",
      mccLabel: categories[i]?.mccLabel ?? "Uncategorized",
      possibleDuplicate: dupes.has(t),
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
