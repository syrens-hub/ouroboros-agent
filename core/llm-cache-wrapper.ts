/**
 * LLM Cache Wrapper
 * =================
 * Wraps raw LLM calls with semantic caching. Cache failures are
 * fail-open: they degrade to the raw API call without surfacing errors.
 */

import type { SemanticCache } from "./semantic-cache.ts";
import { InMemorySemanticCache } from "./semantic-cache.ts";
import { semanticCacheConfig } from "./config-extension.ts";
import { getDbAsync } from "./db-manager.ts";
import { DbSemanticCache } from "./semantic-cache.ts";
import { logger } from "./logger.ts";

let globalCache: SemanticCache | null = null;
let cacheInitPromise: Promise<SemanticCache> | null = null;

export async function getSemanticCache(): Promise<SemanticCache> {
  if (globalCache) return globalCache;
  if (cacheInitPromise) return cacheInitPromise;

  cacheInitPromise = (async () => {
    if (!semanticCacheConfig.enabled) {
      globalCache = new InMemorySemanticCache(semanticCacheConfig.maxEntries);
      return globalCache;
    }
    try {
      const db = await getDbAsync();
      globalCache = new DbSemanticCache(db);
    } catch (e) {
      logger.warn("[semantic-cache] Failed to initialize DbSemanticCache, falling back to InMemorySemanticCache", {
        error: String(e),
      });
      globalCache = new InMemorySemanticCache(semanticCacheConfig.maxEntries);
    }
    return globalCache;
  })();

  return cacheInitPromise;
}

/** Reset the singleton (useful in tests). */
export function resetSemanticCache(): void {
  globalCache = null;
  cacheInitPromise = null;
}

export interface CachedLlmCallOpts {
  useCache?: boolean;
  threshold?: number;
  model?: string;
  ttlMs?: number;
}

/**
 * Wrap a raw LLM call with semantic caching.
 *
 * The `query` and `embedding` are used as the cache key. If a cached entry
 * with cosine similarity above `threshold` is found, the cached response is
 * returned directly. Otherwise the `rawCall` function is invoked and its
 * result is stored in the cache.
 *
 * Cache failures are always fail-open: if anything goes wrong with the
 * cache read or write, the raw call proceeds normally.
 */
export async function cachedLlmCall(
  query: string,
  embedding: number[],
  rawCall: () => Promise<string>,
  opts?: CachedLlmCallOpts
): Promise<string> {
  const useCache = opts?.useCache ?? semanticCacheConfig.enabled;
  if (!useCache) {
    return rawCall();
  }

  const cache = await getSemanticCache();
  const threshold = opts?.threshold ?? semanticCacheConfig.threshold;
  const model = opts?.model ?? semanticCacheConfig.defaultModel;
  const ttlMs = opts?.ttlMs ?? semanticCacheConfig.ttlMs;

  try {
    const hit = await cache.get(query, embedding, { threshold, model });
    if (hit) {
      logger.debug("[semantic-cache] Cache hit", {
        similarity: hit.similarity,
        model,
        query: query.slice(0, 100),
      });
      return hit.response;
    }
  } catch (e) {
    logger.info("[semantic-cache] Cache read failed, falling through to raw call", {
      error: String(e),
    });
  }

  const response = await rawCall();

  try {
    await cache.set(query, embedding, response, { ttlMs, model });
  } catch (e) {
    logger.info("[semantic-cache] Cache write failed, ignoring", { error: String(e) });
  }

  return response;
}
