import { TRPCError } from "@trpc/server";
import { redis } from "@/lib/redis";

/**
 * Redis-backed fixed-window rate limiter.
 * Fails open (allows the request) if Redis is unavailable — keeps the app
 * running during Redis restarts, at the cost of temporary rate-limit bypass.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  return async function check(key: string): Promise<void> {
    try {
      const fullKey = `rl:${key}`;
      const count = await redis.incr(fullKey);
      if (count === 1) await redis.pexpire(fullKey, windowMs);
      if (count > limit) {
        const ttlMs = await redis.pttl(fullKey);
        const retryAfterSec = Math.ceil(Math.max(ttlMs, 0) / 1000);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
        });
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      console.error("[rateLimit] Redis error — failing open:", (err as Error).message);
    }
  };
}

/**
 * Route-handler variant — returns a result object instead of throwing so plain
 * Next.js route handlers can respond with a 429.
 */
export function createRouteRateLimiter(limit: number, windowMs: number) {
  return async function check(key: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
    try {
      const fullKey = `rl:${key}`;
      const count = await redis.incr(fullKey);
      if (count === 1) await redis.pexpire(fullKey, windowMs);
      if (count > limit) {
        const ttlMs = await redis.pttl(fullKey);
        return { allowed: false, retryAfterSec: Math.ceil(Math.max(ttlMs, 0) / 1000) };
      }
      return { allowed: true, retryAfterSec: 0 };
    } catch {
      console.error("[rateLimit] Redis error — failing open");
      return { allowed: true, retryAfterSec: 0 };
    }
  };
}

export const authRateLimiter       = createRateLimiter(10, 60_000);
export const extractionRateLimiter = createRateLimiter(20, 60_000);
export const exportRateLimiter     = createRateLimiter(3, 60 * 60_000);
export const deletionRateLimiter   = createRateLimiter(2, 60 * 60_000);
export const registerRateLimiter   = createRouteRateLimiter(5, 60 * 60 * 1000);
export const chatRateLimiter       = createRateLimiter(20, 60_000);
