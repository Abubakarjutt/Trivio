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

// Shared limiters for common use cases
export const authRateLimiter = createRateLimiter(10, 60_000);      // 10/min for auth
export const extractionRateLimiter = createRateLimiter(20, 60_000); // 20/min for AI extraction
