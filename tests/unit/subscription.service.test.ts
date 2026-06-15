import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkUsageLimits } from "@/server/services/subscription.service";
import { Prisma } from "@prisma/client";

const ORG_ID = "org-123";

function makePrisma(tier: string, extractionCount: number) {
  const month = new Date().toISOString().slice(0, 7);
  return {
    organisation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ subscriptionTier: tier, plan: tier }),
    },
    usageRecord: {
      findUnique: vi.fn().mockResolvedValue(
        extractionCount > 0 ? { aiExtractionCount: extractionCount } : null
      ),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("checkUsageLimits", () => {
  it("FREE tier: within limits when extractions < 3", async () => {
    const prisma = makePrisma("FREE", 2);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
    expect(result.aiExtractionCount).toBe(2);
    expect(result.aiExtractionLimit).toBe(3);
  });

  it("FREE tier: at limit when extractions = 5", async () => {
    const prisma = makePrisma("FREE", 5);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(false);
    expect(result.aiExtractionCount).toBe(5);
  });

  it("FREE tier: over limit when extractions > 5", async () => {
    const prisma = makePrisma("FREE", 7);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(false);
  });

  it("FREE tier: within limits when no usage record exists (0 extractions)", async () => {
    const prisma = makePrisma("FREE", 0);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
    expect(result.aiExtractionCount).toBe(0);
  });

  it("PRO tier: always within limits regardless of count", async () => {
    const prisma = makePrisma("PRO", 1000);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
    expect(result.aiExtractionLimit).toBe(-1); // unlimited
  });

  it("BUSINESS tier: always within limits", async () => {
    const prisma = makePrisma("BUSINESS", 999);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
  });
});
