/**
 * Distributed Rate Limiter
 * ========================
 * Redis-backed sliding window rate limiter with in-memory fallback.
 */

import { getRedis } from "../../core/redis.ts";

type RateLimitResult = { allowed: boolean; remaining: number; retryAfter: number };

const memoryMap = new Map<string, { count: number; resetAt: number }>();
const MAX_MEMORY_ENTRIES = 10000; // 防止内存无限增长

// Periodically clean up expired entries to prevent unbounded memory growth.
// This is safe to run on a timer since it only removes entries past their expiry.
const MEMORY_CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let _memoryCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startMemoryCleanup(): void {
  if (_memoryCleanupTimer) return;
  _memoryCleanupTimer = setInterval(() => {
    const now = Date.now();
    // 清理过期条目
    for (const [key, bucket] of memoryMap.entries()) {
      if (now > bucket.resetAt) {
        memoryMap.delete(key);
      }
    }
    // 如果超过最大条目数，清理最老的
    if (memoryMap.size > MAX_MEMORY_ENTRIES) {
      const entries = Array.from(memoryMap.entries());
      entries.sort((a, b) => a[1].resetAt - b[1].resetAt);
      const toDelete = entries.slice(0, entries.length - MAX_MEMORY_ENTRIES);
      for (const [key] of toDelete) {
        memoryMap.delete(key);
      }
    }
  }, MEMORY_CLEANUP_INTERVAL_MS);
  if (typeof (_memoryCleanupTimer as unknown as NodeJS.Timeout).unref === "function") {
    (_memoryCleanupTimer as unknown as NodeJS.Timeout).unref();
  }
}

export function stopRateLimiterCleanup(): void {
  if (_memoryCleanupTimer) {
    clearInterval(_memoryCleanupTimer);
    _memoryCleanupTimer = null;
  }
}

startMemoryCleanup();

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
      const results = await pipeline.exec();
      const countRes = results?.[1];
      const count = Array.isArray(countRes) ? (countRes[1] as number) : 0;
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
