/**
 * subscription router unit tests
 *
 * Tests the subscriptionRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma and services — no DB or Stripe connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Set env vars before importing mocks
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_PRO_MONTHLY_PRICE_ID = "price_monthly_fake";
process.env.STRIPE_PRO_ANNUAL_PRICE_ID = "price_annual_fake";
process.env.NEXTAUTH_URL = "http://localhost:3000";

// vi.mock is hoisted — must use literals in factory
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

vi.mock("@/server/services/subscription.service", () => ({
  checkUsageLimits: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

import { createCallerFactory } from "@/server/trpc";
import { subscriptionRouter } from "@/server/routers/subscription";
import {
  checkUsageLimits,
  createCheckoutSession,
  createBillingPortalSession,
} from "@/server/services/subscription.service";

const ORG = "org-1";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(orgOverrides: Record<string, unknown> = {}): any {
  const organisation = { id: ORG, name: "Test Org", subscriptionTier: "FREE" as const, ...orgOverrides };
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, organisationId: ORG, organisation },
    db: {} as any,
    organisationId: ORG,
    organisation,
  };
}

const createCaller = createCallerFactory(subscriptionRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getStatus ────────────────────────────────────────────────────────────────

describe("subscription.getStatus", () => {
  it("returns tier and usage limits by spreading checkUsageLimits result", async () => {
    const { db } = await import("@/lib/db");
    const mockLimits = {
      withinLimits: true,
      aiExtractionCount: 5,
      aiExtractionLimit: 10,
    };
    (checkUsageLimits as any).mockResolvedValue(mockLimits);
    (db.user.findUnique as any).mockResolvedValue({
      id: USER_ID,
      organisationId: ORG,
      organisation: { id: ORG, name: "Test Org", subscriptionTier: "FREE" },
    });

    const caller = createCaller(makeCtx());
    const result = await caller.getStatus();

    expect(result).toEqual({
      tier: "FREE",
      withinLimits: true,
      aiExtractionCount: 5,
      aiExtractionLimit: 10,
    });
  });

  it("passes organisationId to checkUsageLimits", async () => {
    const { db } = await import("@/lib/db");
    const mockLimits = {
      withinLimits: true,
      aiExtractionCount: 0,
      aiExtractionLimit: 3,
    };
    (checkUsageLimits as any).mockResolvedValue(mockLimits);
    (db.user.findUnique as any).mockResolvedValue({
      id: USER_ID,
      organisationId: ORG,
      organisation: { id: ORG, name: "Test Org", subscriptionTier: "FREE" },
    });

    const caller = createCaller(makeCtx());
    await caller.getStatus();

    expect(checkUsageLimits).toHaveBeenCalledWith(expect.anything(), ORG);
  });

  it("returns PRO tier when organisation subscriptionTier is PRO", async () => {
    const { db } = await import("@/lib/db");
    const mockLimits = {
      withinLimits: true,
      aiExtractionCount: 1000,
      aiExtractionLimit: -1,
    };
    (checkUsageLimits as any).mockResolvedValue(mockLimits);
    (db.user.findUnique as any).mockResolvedValue({
      id: USER_ID,
      organisationId: ORG,
      organisation: { id: ORG, name: "Test Org", subscriptionTier: "PRO" },
    });

    const caller = createCaller(makeCtx());
    const result = await caller.getStatus();

    expect(result.tier).toBe("PRO");
    expect(result.aiExtractionLimit).toBe(-1);
  });
});

// ─── createCheckoutSession ────────────────────────────────────────────────────

describe("subscription.createCheckoutSession", () => {
  it("returns { url } for pro_monthly plan", async () => {
    (createCheckoutSession as any).mockResolvedValue("https://stripe.com/checkout/123");

    const caller = createCaller(makeCtx());
    const result = await caller.createCheckoutSession({ plan: "pro_monthly" });

    expect(result).toEqual({ url: "https://stripe.com/checkout/123" });
  });

  it("calls createCheckoutSession with monthly price ID for pro_monthly", async () => {
    (createCheckoutSession as any).mockResolvedValue("https://stripe.com/checkout/123");

    const caller = createCaller(makeCtx());
    await caller.createCheckoutSession({ plan: "pro_monthly" });

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      "price_monthly_fake",
      expect.stringContaining("settings/billing?success=1"),
      expect.stringContaining("settings/billing"),
    );
  });

  it("calls createCheckoutSession with annual price ID for pro_annual", async () => {
    (createCheckoutSession as any).mockResolvedValue("https://stripe.com/checkout/456");

    const caller = createCaller(makeCtx());
    await caller.createCheckoutSession({ plan: "pro_annual" });

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      "price_annual_fake",
      expect.stringContaining("settings/billing?success=1"),
      expect.stringContaining("settings/billing"),
    );
  });

  it("returns { url } for pro_annual plan", async () => {
    (createCheckoutSession as any).mockResolvedValue("https://stripe.com/checkout/456");

    const caller = createCaller(makeCtx());
    const result = await caller.createCheckoutSession({ plan: "pro_annual" });

    expect(result).toEqual({ url: "https://stripe.com/checkout/456" });
  });

  it("throws INTERNAL_SERVER_ERROR when STRIPE_SECRET_KEY is not set", async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const caller = createCaller(makeCtx());
    await expect(caller.createCheckoutSession({ plan: "pro_monthly" })).rejects.toThrow(
      expect.objectContaining({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe is not configured",
      }),
    );

    process.env.STRIPE_SECRET_KEY = originalKey;
  });

  it("throws INTERNAL_SERVER_ERROR when pro_monthly price ID is not configured", async () => {
    const originalId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
    delete process.env.STRIPE_PRO_MONTHLY_PRICE_ID;

    const caller = createCaller(makeCtx());
    await expect(caller.createCheckoutSession({ plan: "pro_monthly" })).rejects.toThrow(
      expect.objectContaining({
        code: "INTERNAL_SERVER_ERROR",
        message: "Price ID not configured",
      }),
    );

    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = originalId;
  });

  it("throws INTERNAL_SERVER_ERROR when pro_annual price ID is not configured", async () => {
    const originalId = process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
    delete process.env.STRIPE_PRO_ANNUAL_PRICE_ID;

    const caller = createCaller(makeCtx());
    await expect(caller.createCheckoutSession({ plan: "pro_annual" })).rejects.toThrow(
      expect.objectContaining({
        code: "INTERNAL_SERVER_ERROR",
        message: "Price ID not configured",
      }),
    );

    process.env.STRIPE_PRO_ANNUAL_PRICE_ID = originalId;
  });

});

// ─── createPortalSession ──────────────────────────────────────────────────────

describe("subscription.createPortalSession", () => {
  it("returns { url } from createBillingPortalSession", async () => {
    (createBillingPortalSession as any).mockResolvedValue("https://stripe.com/portal/123");

    const caller = createCaller(makeCtx());
    const result = await caller.createPortalSession();

    expect(result).toEqual({ url: "https://stripe.com/portal/123" });
  });

  it("calls createBillingPortalSession with correct parameters", async () => {
    (createBillingPortalSession as any).mockResolvedValue("https://stripe.com/portal/123");

    const caller = createCaller(makeCtx());
    await caller.createPortalSession();

    expect(createBillingPortalSession).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.stringContaining("settings/billing"),
    );
  });

  it("throws INTERNAL_SERVER_ERROR when STRIPE_SECRET_KEY is not set", async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const caller = createCaller(makeCtx());
    await expect(caller.createPortalSession()).rejects.toThrow(
      expect.objectContaining({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe is not configured",
      }),
    );

    process.env.STRIPE_SECRET_KEY = originalKey;
  });

});
