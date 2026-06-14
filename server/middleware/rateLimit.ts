import { TRPCError } from "@trpc/server";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Creates a simple in-memory rate limiter.
 *
 * Usage in a tRPC procedure:
 *   const limiter = createRateLimiter(10, 60_000); // 10 req/min
 *   limiter(`${ctx.session.user.id}:myProcedure`);
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  // Periodically clean up expired buckets to avoid memory leaks
  if (typeof setInterval !== "undefined") {
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
      }
    }, windowMs * 2);
  }

  return function check(key: string): void {
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    existing.count += 1;
    if (existing.count > limit) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. Try again in ${Math.ceil((existing.resetAt - now) / 1000)}s.`,
      });
    }
  };
}

/**
 * Route-handler limiter: returns a boolean result instead of throwing, so plain
 * Next.js route handlers can respond with a 429. Use in app/api/** routes.
 */
export function createRouteRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  if (typeof setInterval !== "undefined") {
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
      }
    }, windowMs * 2);
  }

  return function check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    existing.count += 1;
    if (existing.count > limit) {
      return { allowed: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  };
}

// Shared limiters for common use cases
export const authRateLimiter = createRateLimiter(10, 60_000);           // 10/min for auth
export const extractionRateLimiter = createRateLimiter(20, 60_000);     // 20/min for AI extraction
export const exportRateLimiter = createRateLimiter(3, 60 * 60_000);     // 3/hour for data export
export const deletionRateLimiter = createRateLimiter(2, 60 * 60_000);   // 2/hour for account deletion
// 5 registrations per hour per IP — prevents bcrypt amplification and account flooding
export const registerRateLimiter = createRouteRateLimiter(5, 60 * 60 * 1000);
// 30 AI chat calls per hour per org — prevents unbounded Gemini API cost amplification
export const chatRateLimiter = createRateLimiter(30, 60 * 60 * 1000);
