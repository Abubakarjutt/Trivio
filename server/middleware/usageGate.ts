import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

export async function assertCanExtract(prisma: PrismaClient, organisationId: string): Promise<void> {
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisationId },
    select: { subscriptionTier: true },
  });

  if (org.subscriptionTier !== "FREE") return; // PRO / BUSINESS — unlimited

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const usage = await prisma.usageRecord.findUnique({
    where: { organisationId_month: { organisationId, month } },
    select: { aiExtractionCount: true },
  });

  const count = usage?.aiExtractionCount ?? 0;
  if (count >= 5) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FREE_TIER_LIMIT_REACHED:ai_extraction",
    });
  }
}
