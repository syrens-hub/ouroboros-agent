/**
 * SmartCache (Skill Re-export)
 * =============================
 * The canonical implementation now lives in core/smart-cache.ts.
 * This file re-exports for backward compatibility with existing skill imports.
 */

export { SmartCache } from "../../core/smart-cache.ts";
export type { SmartCacheConfig, CacheStats, SmartCacheStats } from "../../core/smart-cache.ts";
