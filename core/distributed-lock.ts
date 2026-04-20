/**
 * Distributed Lock
 * ================
 * Redis-based distributed lock with Redlock-style safety and in-memory fallback.
 * Used to prevent concurrent evolution execution across multiple Ouroboros instances.
 *
 * Safety properties:
 *   - Atomic acquire via SET key value NX PX ttl
 *   - Atomic release via Lua script (only delete if value matches)
 *   - Atomic extend via Lua script (only extend if value matches)
 *   - Timeout protection on all Redis operations (fail-closed)
 *   - Falls back to InMemoryDistributedLock when Redis is unavailable
 */

import { v4 as uuidv4 } from "uuid";
import type { Redis } from "ioredis";
import { getRedis } from "./redis.ts";
import { logger } from "./logger.ts";

const REDIS_OP_TIMEOUT_MS = 5000;

export interface LockToken {
  key: string;
  value: string;
  acquiredAt: number;
}

export interface DistributedLock {
  acquire(lockKey: string, ttlMs: number): Promise<LockToken | null>;
  release(token: LockToken): Promise<boolean>;
  extend(token: LockToken, ttlMs: number): Promise<boolean>;
}

// Lua script: only delete if value matches (prevents releasing someone else's lock)
const RELEASE_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// Lua script: only extend TTL if value matches
const EXTEND_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

function withTimeout<T>(promise: Promise<T>, operation: string, lockKey: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Redis lock operation timed out: ${operation} on ${lockKey}`));
      }, REDIS_OP_TIMEOUT_MS);
    }),
  ]);
}

export class RedisDistributedLock implements DistributedLock {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async acquire(lockKey: string, ttlMs: number): Promise<LockToken | null> {
    try {
      const value = uuidv4();
      const result = await withTimeout(
        this.redis.set(lockKey, value, "PX", ttlMs, "NX"),
        "acquire",
        lockKey
      );
      if (result === "OK") {
        return { key: lockKey, value, acquiredAt: Date.now() };
      }
      return null;
    } catch (err) {
      logger.error("Redis lock acquire failed", { lockKey, error: String(err) });
      return null;
    }
  }

  async release(token: LockToken): Promise<boolean> {
    try {
      const result = (await withTimeout(
        this.redis.eval(RELEASE_LUA, 1, token.key, token.value),
        "release",
        token.key
      )) as number;
      return result === 1;
    } catch (err) {
      logger.error("Redis lock release failed", { lockKey: token.key, error: String(err) });
      return false;
    }
  }

  async extend(token: LockToken, ttlMs: number): Promise<boolean> {
    try {
      const result = (await withTimeout(
        this.redis.eval(EXTEND_LUA, 1, token.key, token.value, String(ttlMs)),
        "extend",
        token.key
      )) as number;
      return result === 1;
    } catch (err) {
      logger.error("Redis lock extend failed", { lockKey: token.key, error: String(err) });
      return false;
    }
  }
}

export class InMemoryDistributedLock implements DistributedLock {
  private locks = new Map<string, { value: string; expiresAt: number }>();

  async acquire(lockKey: string, ttlMs: number): Promise<LockToken | null> {
    this.cleanup();
    const existing = this.locks.get(lockKey);
    if (existing && existing.expiresAt > Date.now()) {
      return null;
    }
    const value = uuidv4();
    this.locks.set(lockKey, { value, expiresAt: Date.now() + ttlMs });
    return { key: lockKey, value, acquiredAt: Date.now() };
  }

  async release(token: LockToken): Promise<boolean> {
    const existing = this.locks.get(token.key);
    if (existing && existing.value === token.value) {
      this.locks.delete(token.key);
      return true;
    }
    return false;
  }

  async extend(token: LockToken, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(token.key);
    if (existing && existing.value === token.value) {
      this.locks.set(token.key, { value: token.value, expiresAt: Date.now() + ttlMs });
      return true;
    }
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks.entries()) {
      if (entry.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}

let distributedLockInstance: DistributedLock | null = null;

export function getDistributedLock(): DistributedLock {
  if (!distributedLockInstance) {
    distributedLockInstance = createDistributedLock();
  }
  return distributedLockInstance;
}

export function createDistributedLock(): DistributedLock {
  const redis = getRedis();
  if (redis) {
    return new RedisDistributedLock(redis);
  }
  return new InMemoryDistributedLock();
}

/** Reset the singleton instance (useful for testing). */
export function resetDistributedLock(): void {
  distributedLockInstance = null;
}
