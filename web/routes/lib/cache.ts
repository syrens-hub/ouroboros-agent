/**
 * Simple In-Memory Cache
 * ======================
 */

type CacheEntry = { data: unknown; expiresAt: number };
const apiCache = new Map<string, CacheEntry>();
export const MAX_API_CACHE_SIZE = 100;

export function getCached<T>(key: string, ttlMs: number, fn: () => T): T {
  const now = Date.now();
  const entry = apiCache.get(key);
  if (entry && entry.expiresAt >= now) return entry.data as T;

  if (apiCache.size >= MAX_API_CACHE_SIZE) {
    for (const [k, e] of apiCache.entries()) {
      if (e.expiresAt < now) apiCache.delete(k);
    }
    if (apiCache.size >= MAX_API_CACHE_SIZE) {
      const firstKey = apiCache.keys().next().value;
      if (firstKey !== undefined) apiCache.delete(firstKey);
    }
  }

  const data = fn();
  apiCache.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

export type { CacheEntry };
