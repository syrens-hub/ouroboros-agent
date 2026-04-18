/**
 * Query Cache
 * ===========
 * Simple LRU cache for search results to avoid redundant computation.
 */

import type { EngraphSearchResponse } from "./types.ts";

interface CacheEntry {
  result: EngraphSearchResponse;
  expiresAt: number;
}

const MAX_SIZE = 100;
const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, CacheEntry>();

function makeKey(queryText: string, filters?: Record<string, unknown>): string {
  return JSON.stringify({ q: queryText, f: filters });
}

export function getCachedSearch(
  queryText: string,
  filters?: Record<string, unknown>
): EngraphSearchResponse | undefined {
  const key = makeKey(queryText, filters);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

export function setCachedSearch(
  queryText: string,
  result: EngraphSearchResponse,
  filters?: Record<string, unknown>,
  ttlMs = DEFAULT_TTL_MS
): void {
  // Evict oldest if at capacity
  if (cache.size >= MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  const key = makeKey(queryText, filters);
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

export function clearSearchCache(): void {
  cache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}
