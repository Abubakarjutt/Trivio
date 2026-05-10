import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "@/server/middleware/rateLimit";
import { TRPCError } from "@trpc/server";

describe("createRateLimiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows requests under the limit", () => {
    const check = createRateLimiter(5, 60_000);
    expect(() => {
      for (let i = 0; i < 5; i++) check("user-1");
    }).not.toThrow();
  });

  it("throws TRPCError TOO_MANY_REQUESTS when limit exceeded", () => {
    const check = createRateLimiter(3, 60_000);
    check("user-1");
    check("user-1");
    check("user-1");
    expect(() => check("user-1")).toThrow(TRPCError);
    try {
      check("user-1");
    } catch (e) {
      expect((e as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    }
  });

  it("tracks different keys independently", () => {
    const check = createRateLimiter(2, 60_000);
    check("user-a");
    check("user-a");
    check("user-b"); // Should not throw — different key
    expect(() => check("user-a")).toThrow(TRPCError);
    expect(() => check("user-b")).not.toThrow(); // user-b still has 1 left
  });

  it("resets after the window expires", () => {
    const check = createRateLimiter(2, 60_000);
    check("user-1");
    check("user-1");
    expect(() => check("user-1")).toThrow(TRPCError);

    // Advance time past window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    expect(() => check("user-1")).not.toThrow();
  });

  it("includes retry-after info in error message", () => {
    const check = createRateLimiter(1, 60_000);
    check("user-1");
    try {
      check("user-1");
    } catch (e) {
      expect((e as TRPCError).message).toContain("Rate limit exceeded");
    }
  });
});
