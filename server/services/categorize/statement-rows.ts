import type { ExistingTransaction, RawTransaction } from "@/server/services/statement-parser.service";
import type { RuleCategorization } from "./category-rules.service";

export function toStatementRow(txn: RawTransaction, cat: RuleCategorization | undefined) {
  return {
    date: new Date(txn.date),
    description: txn.description,
    merchantName: cat?.merchantName || txn.description,
    amount: txn.amount,
    type: txn.type,
    category: cat?.category ?? "Other",
    mccCode: cat?.mccCode ?? "0000",
    mccLabel: cat?.mccLabel ?? "Uncategorized",
    needsCategory: cat?.needsCategory ?? true,
    ruleKind: cat?.ruleKey?.kind ?? null,
    ruleMatchKey: cat?.ruleKey?.matchKey ?? null,
    ruleLabel: cat?.ruleKey?.label ?? null,
  };
}

// Rows saved before counterparty tokens hold raw numbers; tokenize them the same
// way so an overlapping re-import is still recognised as a duplicate.
export function tokenizeExisting<T extends Pick<ExistingTransaction, "description">>(rows: T[], tokenize: (t: string) => string): T[] {
  return rows.map((r) => ({ ...r, description: tokenize(r.description) }));
}
