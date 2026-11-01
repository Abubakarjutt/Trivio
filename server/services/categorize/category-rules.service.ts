// Categorises imported transactions: the user's remembered rules first (no AI
// call), then the Gemini categoriser for the rest, flagging rows whose category
// is a guess so the user is asked "where did this money go?".
import { randomBytes } from "node:crypto";
import type { CategoryRule, PrismaClient } from "@prisma/client";
import { categorizeBatch } from "@/server/services/statement-categorization.service";
import {
  candidateRuleKeys,
  extractRuleKey,
  hasCounterpartyToken,
  tokenizeCounterparties,
  type RuleKey,
} from "./counterparty-token";

type Db = Pick<PrismaClient, "organisation" | "categoryRule">;

export interface CategorizeInput {
  description: string;
  merchantName?: string;
  /** A counterparty token from the surrounding SMS, for when the parsed description lost it. */
  counterpartyHint?: string | null;
}

export interface RuleCategorization {
  merchantName: string;
  category: string;
  mccCode: string;
  mccLabel: string;
  needsCategory: boolean;
  ruleKey: RuleKey | null;
  ruleApplied: boolean;
}

export interface ImportCategorizer {
  tokenize(text: string): string;
  categorize(rows: CategorizeInput[]): Promise<RuleCategorization[]>;
}

const AMBIGUOUS_CATEGORIES = new Set(["Transfers", "Other"]);
const keyOf = (k: { kind: string; matchKey: string }) => `${k.kind}:${k.matchKey}`;

export async function getCounterpartySecret(db: Db, organisationId: string): Promise<string> {
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { counterpartySecret: true },
  });
  if (org?.counterpartySecret) return org.counterpartySecret;
  const secret = randomBytes(32).toString("hex");
  // Only fill an empty secret, then re-read: two first imports racing agree on one.
  await db.organisation.updateMany({
    where: { id: organisationId, counterpartySecret: null },
    data: { counterpartySecret: secret },
  });
  const again = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { counterpartySecret: true },
  });
  return again?.counterpartySecret ?? secret;
}

async function loadRules(
  db: Db,
  organisationId: string,
  keys: RuleKey[],
): Promise<Map<string, CategoryRule>> {
  if (keys.length === 0) return new Map();
  const rules = await db.categoryRule.findMany({
    where: { organisationId, OR: keys.map((k) => ({ kind: k.kind, matchKey: k.matchKey })) },
  });
  return new Map(rules.map((r) => [keyOf(r), r]));
}

function fromRule(rule: CategoryRule, merchantName: string, ruleKey: RuleKey | null): RuleCategorization {
  return {
    merchantName,
    category: rule.category,
    mccCode: "0000",
    mccLabel: rule.category,
    needsCategory: false,
    ruleKey,
    ruleApplied: true,
  };
}

export async function categorizeWithRules(
  db: Db,
  organisationId: string,
  rows: CategorizeInput[],
): Promise<RuleCategorization[]> {
  if (rows.length === 0) return [];
  const out: (RuleCategorization | undefined)[] = new Array(rows.length);
  const used = new Map<string, number>(); // rule id → times applied

  // 1. Rules on what we know before the AI (token, hint, a merchant name if given).
  const before = rows.map((r) => candidateRuleKeys(r.description, r.merchantName ?? "", r.counterpartyHint));
  const rulesBefore = await loadRules(db, organisationId, before.flat());
  rows.forEach((r, i) => {
    const hit = before[i]!.map((k) => rulesBefore.get(keyOf(k))).find(Boolean);
    if (!hit) return;
    used.set(hit.id, (used.get(hit.id) ?? 0) + 1);
    out[i] = fromRule(hit, r.merchantName || r.description, before[i]![0] ?? null);
  });

  // 2. The AI for the rest, then merchant rules on its cleaned merchant names.
  const rest = rows.map((_, i) => i).filter((i) => !out[i]);
  if (rest.length > 0) {
    const ai = await categorizeBatch(rest.map((i) => rows[i]!.description));
    const merchantOf = (j: number) =>
      ai[j]?.merchantName || rows[rest[j]!]!.merchantName || rows[rest[j]!]!.description;
    const after = rest.map((i, j) =>
      extractRuleKey(rows[i]!.description, merchantOf(j), rows[i]!.counterpartyHint),
    );
    const merchantKeys = after.filter((k): k is RuleKey => k?.kind === "MERCHANT");
    const rulesAfter = await loadRules(db, organisationId, merchantKeys);
    rest.forEach((i, j) => {
      const key = after[j] ?? null;
      const hit = key?.kind === "MERCHANT" ? rulesAfter.get(keyOf(key)) : undefined;
      if (hit) {
        used.set(hit.id, (used.get(hit.id) ?? 0) + 1);
        out[i] = fromRule(hit, merchantOf(j), key);
        return;
      }
      const r = ai[j];
      const category = r?.category ?? "Other";
      const tokenised =
        hasCounterpartyToken(rows[i]!.description) || hasCounterpartyToken(rows[i]!.counterpartyHint ?? "");
      out[i] = {
        merchantName: merchantOf(j),
        category,
        mccCode: r?.mccCode ?? "0000",
        mccLabel: r?.mccLabel ?? "Uncategorized",
        needsCategory: !r || r.fallback || AMBIGUOUS_CATEGORIES.has(category) || tokenised,
        ruleKey: key,
        ruleApplied: false,
      };
    });
  }

  const now = new Date();
  for (const [id, n] of used) {
    await db.categoryRule.update({
      where: { id },
      data: { timesApplied: { increment: n }, lastAppliedAt: now },
    });
  }
  return out as RuleCategorization[];
}

export async function createImportCategorizer(db: Db, organisationId: string): Promise<ImportCategorizer> {
  const secret = await getCounterpartySecret(db, organisationId);
  return {
    tokenize: (text) => tokenizeCounterparties(text, secret),
    categorize: (rows) => categorizeWithRules(db, organisationId, rows),
  };
}
