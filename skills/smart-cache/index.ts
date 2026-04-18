/**
 * SmartCache
 * ==========
 * In-memory cache with LRU eviction, TTL expiration, and size-aware limits.
 */

export type SmartCacheConfig = {
  name?: string;
  maxEntries?: number;
  maxMemoryBytes?: number;
  ttlMs?: number;
  pendingTimeoutMs?: number;
};

export type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  entryCount: number;
  currentMemoryBytes: number;
};

export type SmartCacheStats = CacheStats & {
  size: number;
  hitRate: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  sizeBytes: number;
};

export class SmartCache<T> {
  readonly name: string;
  private cache = new Map<string, CacheEntry<T>>();
  private pending = new Map<string, { promise: Promise<T>; createdAt: number }>();
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private currentMemoryBytes = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxEntries: number | undefined;
  private readonly maxMemoryBytes: number | undefined;
  private readonly defaultTtlMs: number | undefined;
  private readonly pendingTimeoutMs: number;

  constructor(config?: SmartCacheConfig | string) {
    if (typeof config === "string") {
      this.name = config;
      this.maxEntries = undefined;
      this.maxMemoryBytes = undefined;
      this.defaultTtlMs = undefined;
      this.pendingTimeoutMs = 30_000;
    } else {
      this.name = config?.name ?? "";
      this.maxEntries = config?.maxEntries;
      this.maxMemoryBytes = config?.maxMemoryBytes;
      this.defaultTtlMs = config?.ttlMs;
      this.pendingTimeoutMs = config?.pendingTimeoutMs ?? 30_000;
    }
  }

  set(key: string, value: T, ttlMs?: number): void {
    const sizeBytes = this.estimateSize(value);
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl ? Date.now() + effectiveTtl : Infinity;

    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
      this.currentMemoryBytes -= existing.sizeBytes;
    }

    if (this.maxMemoryBytes !== undefined && sizeBytes > this.maxMemoryBytes) {
      while (this.currentMemoryBytes > 0 && this.cache.size > 0) {
        this.evictLRU();
      }
    } else {
      while (
        this.maxMemoryBytes !== undefined &&
        this.currentMemoryBytes + sizeBytes > this.maxMemoryBytes &&
        this.cache.size > 0
      ) {
        this.evictLRU();
      }
    }

    if (this.maxEntries !== undefined && this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(key, { value, expiresAt, sizeBytes });
    this.currentMemoryBytes += sizeBytes;
    this.ensureCleanupTimer();
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.cache.delete(key);
    this.currentMemoryBytes -= entry.sizeBytes;
    if (this.cache.size === 0) {
      this.stopCleanupTimer();
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.currentMemoryBytes = 0;
    this.stopCleanupTimer();
  }

  async getOrSet(key: string, factory: () => T | Promise<T>, ttlMs?: number): Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const pendingEntry = this.pending.get(key);
    if (pendingEntry) {
      return pendingEntry.promise;
    }

    const promise = Promise.resolve(factory())
      .then((value) => {
        this.set(key, value, ttlMs);
        this.pending.delete(key);
        return value;
      })
      .catch((err) => {
        this.pending.delete(key);
        throw err;
      });

    this.pending.set(key, { promise, createdAt: Date.now() });
    this.ensurePendingCleanupTimer();
    return promise;
  }

  getStats(): SmartCacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      entryCount: this.cache.size,
      currentMemoryBytes: this.currentMemoryBytes,
      size: this.cache.size,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  destroy(): void {
    this.stopCleanupTimer();
    this.stopPendingCleanupTimer();
    this.cache.clear();
    this.pending.clear();
    this.currentMemoryBytes = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  private estimateSize(value: T): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      // Intentional fail-open: unserializable value contributes 0 bytes to memory accounting.
      return 0;
    }
  }

  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey)!;
      this.cache.delete(firstKey);
      this.currentMemoryBytes -= entry.sizeBytes;
      this.stats.evictions++;
      console.info(`[SmartCache:${this.name}] evicted key="${firstKey}" stats=${JSON.stringify(this.getStats())}`);
    }
  }

  private ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 30000);
    if (typeof (this.cleanupTimer as unknown as NodeJS.Timeout).unref === "function") {
      (this.cleanupTimer as unknown as NodeJS.Timeout).unref();
    }
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let expired = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.delete(key);
        expired++;
      }
    }
    if (expired > 0) {
      console.info(`[SmartCache:${this.name}] cleanupExpired removed ${expired} entries stats=${JSON.stringify(this.getStats())}`);
    }
    if (this.cache.size === 0) {
      this.stopCleanupTimer();
    }
  }

  private ensurePendingCleanupTimer(): void {
    if (this.pendingCleanupTimer) return;
    this.pendingCleanupTimer = setInterval(() => {
      this.cleanupPending();
    }, this.pendingTimeoutMs);
    if (typeof (this.pendingCleanupTimer as unknown as NodeJS.Timeout).unref === "function") {
      (this.pendingCleanupTimer as unknown as NodeJS.Timeout).unref();
    }
  }

  private stopPendingCleanupTimer(): void {
    if (this.pendingCleanupTimer) {
      clearInterval(this.pendingCleanupTimer);
      this.pendingCleanupTimer = null;
    }
  }

  private cleanupPending(): void {
    const now = Date.now();
    let expired = 0;
    for (const [key, entry] of this.pending) {
      if (now - entry.createdAt > this.pendingTimeoutMs) {
        this.pending.delete(key);
        expired++;
      }
    }
    if (expired > 0) {
      console.info(`[SmartCache:${this.name}] cleanupPending removed ${expired} stale pending entries`);
    }
    if (this.pending.size === 0) {
      this.stopPendingCleanupTimer();
    }
  }
}
