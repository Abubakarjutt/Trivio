import { db } from "@/lib/db";

export const FREE_AI_LIMIT = 2;
export const FREE_TX_LIMIT = 50;

export type PlanType = "FREE" | "PRO";

export function isPro(plan: PlanType): boolean {
  return plan === "PRO";
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function checkAiExtractionLimit(
  orgId: string,
  plan: PlanType
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const used = await db.statementImportBatch.count({
    where: {
      organisationId: orgId,
      createdAt: { gte: startOfMonth() },
    },
  });
  if (plan === "PRO") return { allowed: true, used, limit: null };
  return { allowed: used < FREE_AI_LIMIT, used, limit: FREE_AI_LIMIT };
}

export async function checkTransactionLimit(
  orgId: string,
  plan: PlanType
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const used = await db.statementTransaction.count({
    where: {
      organisationId: orgId,
      createdAt: { gte: startOfMonth() },
    },
  });
  if (plan === "PRO") return { allowed: true, used, limit: null };
  return { allowed: used < FREE_TX_LIMIT, used, limit: FREE_TX_LIMIT };
}
