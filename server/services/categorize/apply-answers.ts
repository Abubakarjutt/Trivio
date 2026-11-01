// "Always use…" answers fill in everything else still waiting for a category
// with the same rule key: rows in the same approval, SMS waiting for review,
// and saved transactions. Shared by smsImport.approve and
// statementTransactions.updateCategory so both surfaces behave the same.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ParsedSmsTransaction } from "@/server/services/sms/sms-import.service";
import type { RuleKind } from "./counterparty-token";

/** `${kind}:${matchKey}` → category. */
export type RuleAnswers = Map<string, string>;

type Db = Pick<PrismaClient, "smsImportItem" | "statementTransaction">;

export const answerKey = (k: { kind: string; matchKey: string }) => `${k.kind}:${k.matchKey}`;

/** Rows that still need a category and weren't answered by the user take the answer for their key. */
export function applyAnswersToRows(
  rows: ParsedSmsTransaction[],
  answers: RuleAnswers
): { rows: ParsedSmsTransaction[]; changed: number } {
  let changed = 0;
  const out = rows.map((p) => {
    const category =
      p.ruleKey && p.needsCategory && !p.userCategorized
        ? answers.get(answerKey(p.ruleKey))
        : undefined;
    if (category === undefined) return p;
    changed++;
    return { ...p, category, mccLabel: category, needsCategory: false, ruleApplied: true };
  });
  return { rows: out, changed };
}

/** Fills in SMS waiting for review. Returns how many SMS changed. */
export async function applyAnswersToPendingSms(
  db: Db,
  organisationId: string,
  answers: RuleAnswers
): Promise<number> {
  if (answers.size === 0) return 0;
  const pending = await db.smsImportItem.findMany({
    where: { organisationId, status: "PENDING_REVIEW" },
    select: { id: true, parsedJson: true },
  });
  let updated = 0;
  for (const item of pending) {
    if (!Array.isArray(item.parsedJson)) continue;
    const { rows, changed } = applyAnswersToRows(
      item.parsedJson as unknown as ParsedSmsTransaction[],
      answers
    );
    if (changed === 0) continue;
    await db.smsImportItem.updateMany({
      where: { id: item.id, organisationId, status: "PENDING_REVIEW" },
      data: { parsedJson: rows as unknown as Prisma.InputJsonValue },
    });
    updated++;
  }
  return updated;
}

/** Fills in saved transactions still flagged for the same key. Returns how many rows changed. */
export async function applyAnswersToFlaggedTransactions(
  db: Db,
  organisationId: string,
  answers: RuleAnswers,
  excludeId?: string
): Promise<number> {
  let updated = 0;
  for (const [key, category] of answers) {
    const sep = key.indexOf(":");
    const res = await db.statementTransaction.updateMany({
      where: {
        organisationId,
        ruleKind: key.slice(0, sep) as RuleKind,
        ruleMatchKey: key.slice(sep + 1),
        needsCategory: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { category, mccLabel: category, needsCategory: false },
    });
    updated += res.count;
  }
  return updated;
}
