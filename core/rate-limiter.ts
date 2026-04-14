/**
 * Distributed Rate Limiter
 * ========================
 * Redis-backed sliding window rate limiter with in-memory fallback.
 */

import { getRedis } from "./redis.ts";

type RateLimitResult = { allowed: boolean; remaining: number; retryAfter: number };

const memoryMap = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Date.now();
  const redisKey = `ratelimit:${key}`;

  if (redis) {
    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, now - windowMs);
      pipeline.zcard(redisKey);
      pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
      pipeline.pexpire(redisKey, windowMs);
      const [, countRes] = await pipeline.exec() as [unknown, [Error | null, number]];
      const count = countRes[1];
      const remaining = Math.max(0, maxRequests - count - 1);
      if (count >= maxRequests) {
        const ttl = await redis.pttl(redisKey);
        return { allowed: false, remaining: 0, retryAfter: Math.ceil(Math.max(ttl, 0) / 1000) };
      }
      return { allowed: true, remaining, retryAfter: 0 };
    } catch {
      // fall through to memory fallback
    }
  }

  const bucket = memoryMap.get(key);
  if (!bucket || now > bucket.resetAt) {
    memoryMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
  }
  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, remaining: maxRequests - bucket.count, retryAfter: 0 };
}
