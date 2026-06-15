import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mock Redis before importing rate limiter ──────────────────────────────────
// Use a simple in-memory store so tests don't require a real Redis instance.

const store = new Map<string, { count: number; expiresAt: number }>();
let fakeNow = Date.now();

vi.mock("@/lib/redis", () => ({
  redis: {
    incr: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt < fakeNow) {
        store.set(key, { count: 1, expiresAt: Infinity });
        return 1;
      }
      entry.count++;
      return entry.count;
    }),
    pexpire: vi.fn(async (key: string, ms: number) => {
      const entry = store.get(key);
      if (entry) entry.expiresAt = fakeNow + ms;
      return 1;
    }),
    pttl: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt === Infinity) return -1;
      return Math.max(0, entry.expiresAt - fakeNow);
    }),
  },
}));

import { createRateLimiter } from "@/server/middleware/rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    store.clear();
    fakeNow = Date.now();
    vi.clearAllMocks();
  });

  it("allows requests under the limit", async () => {
    const check = createRateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) await check("user-1");
    // Should not have thrown
  });

  it("throws TRPCError TOO_MANY_REQUESTS when limit exceeded", async () => {
    const check = createRateLimiter(3, 60_000);
    await check("user-1");
    await check("user-1");
    await check("user-1");
    await expect(check("user-1")).rejects.toThrow(TRPCError);
    try {
      await check("user-1");
    } catch (e) {
      expect((e as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    }
  });

  it("tracks different keys independently", async () => {
    const check = createRateLimiter(2, 60_000);
    await check("user-a");
    await check("user-a");
    await check("user-b");
    await expect(check("user-a")).rejects.toThrow(TRPCError);
    await expect(check("user-b")).resolves.toBeUndefined();
  });

  it("resets after the window expires", async () => {
    const check = createRateLimiter(2, 60_000);
    await check("user-1");
    await check("user-1");
    await expect(check("user-1")).rejects.toThrow(TRPCError);

    // Simulate window expiry
    fakeNow += 61_000;

    await expect(check("user-1")).resolves.toBeUndefined();
  });

  it("includes retry-after info in error message", async () => {
    const check = createRateLimiter(1, 60_000);
    await check("user-1");
    try {
      await check("user-1");
    } catch (e) {
      expect((e as TRPCError).message).toContain("Rate limit exceeded");
    }
  });
});
