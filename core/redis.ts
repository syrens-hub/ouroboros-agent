/**
 * Redis Client
 * ============
 * Shared Redis connection for distributed rate limiting and caching.
 */

import { Redis } from "ioredis";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";

let redisInstance: Redis | null = null;
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;

function createRedis(): Redis | null {
  if (!appConfig.redis.url) return null;
  const client = new Redis(appConfig.redis.url, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });
  client.on("error", (err) => {
    logger.error("Redis error", { error: String(err) });
  });
  return client;
}

export function getRedis(): Redis | null {
  if (!redisInstance) {
    redisInstance = createRedis();
  }
  return redisInstance;
}

export function getRedisPub(): Redis | null {
  if (!redisPub) {
    redisPub = createRedis();
  }
  return redisPub;
}

export function getRedisSub(): Redis | null {
  if (!redisSub) {
    redisSub = createRedis();
  }
  return redisSub;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
  if (redisPub) {
    await redisPub.quit();
    redisPub = null;
  }
  if (redisSub) {
    await redisSub.quit();
    redisSub = null;
  }
}
