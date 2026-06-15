import { describe, it, expect, vi } from "vitest";
import { assertCanExtract } from "@/server/middleware/usageGate";
import { TRPCError } from "@trpc/server";

function makePrisma(tier: string, count: number) {
  return {
    organisation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ subscriptionTier: tier, plan: tier }),
    },
    usageRecord: {
      findUnique: vi.fn().mockResolvedValue(count > 0 ? { aiExtractionCount: count } : null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("assertCanExtract", () => {
  it("passes for FREE tier under limit", async () => {
    const prisma = makePrisma("FREE", 2);
    await expect(assertCanExtract(prisma, "org-1")).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN for FREE tier at limit (3)", async () => {
    const prisma = makePrisma("FREE", 3);
    await expect(assertCanExtract(prisma, "org-1")).rejects.toThrow(TRPCError);
  });

  it("throws FORBIDDEN with correct message", async () => {
    const prisma = makePrisma("FREE", 3);
    try {
      await assertCanExtract(prisma, "org-1");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
      expect((e as TRPCError).message).toContain("FREE_TIER_LIMIT_REACHED");
    }
  });

  it("passes for PRO tier at any count", async () => {
    const prisma = makePrisma("PRO", 100);
    await expect(assertCanExtract(prisma, "org-1")).resolves.toBeUndefined();
  });

  it("passes for FREE tier with no usage record", async () => {
    const prisma = makePrisma("FREE", 0);
    await expect(assertCanExtract(prisma, "org-1")).resolves.toBeUndefined();
  });
});
