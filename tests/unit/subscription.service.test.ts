import { describe, it, expect } from "vitest";
import { checkUsageLimits } from "@/server/services/subscription.service";

const ORG_ID = "org-123";

function makePrisma(extractionCount: number) {
  const month = new Date().toISOString().slice(0, 7);
  return {
    usageRecord: {
      findUnique: async ({ where }: { where: { organisationId_month: { organisationId: string; month: string } } }) => {
        if (where.organisationId_month.organisationId !== ORG_ID || where.organisationId_month.month !== month) return null;
        return extractionCount > 0 ? { aiExtractionCount: extractionCount } : null;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Trivio is open-source — every organisation gets unlimited usage regardless
// of count or (now vestigial) plan/tier.
describe("checkUsageLimits", () => {
  it("is always within limits with no usage recorded", async () => {
    const prisma = makePrisma(0);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
    expect(result.aiExtractionCount).toBe(0);
    expect(result.aiExtractionLimit).toBe(-1);
  });

  it("is always within limits regardless of how much usage was recorded", async () => {
    const prisma = makePrisma(1000);
    const result = await checkUsageLimits(prisma, ORG_ID);
    expect(result.withinLimits).toBe(true);
    expect(result.aiExtractionCount).toBe(1000);
    expect(result.aiExtractionLimit).toBe(-1);
  });
});
