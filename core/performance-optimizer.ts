import * as os from "os";
import { SmartCache, type SmartCacheStats } from "./smart-cache.ts";
import { BatchProcessor, type BatchProcessorConfig, type BatchProcessorStats } from "./batch-processor.ts";
import { ConnectionPool } from "./connection-pool.ts";

export interface PerformanceOptimizerConfig {
  reportIntervalMs?: number;
  resourceSampleIntervalMs?: number;
}

export interface ConnectionPoolConfig {
  minConnections?: number;
  maxConnections?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface ConnectionPoolStats {
  activeConnections: number;
  idleConnections: number;
}

export interface PerformanceStats {
  cpuUsage: number;
  memoryUsage: number;
  caches: Record<string, SmartCacheStats>;
  batches: Record<string, BatchProcessorStats>;
  pools: Record<string, ConnectionPoolStats>;
}

type ReportCallback = (stats: PerformanceStats) => void;

function getCpuSnapshot(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    const cpuTotal = t.user + t.nice + t.sys + t.idle + t.irq;
    idle += t.idle;
    total += cpuTotal;
  }
  return { idle, total };
}

export class PerformanceOptimizer {
  private caches = new Map<string, SmartCache<unknown>>();
  private batches = new Map<string, BatchProcessor<unknown, unknown>>();
  private pools = new Map<string, ConnectionPool<unknown>>();
  private reportListeners: ReportCallback[] = [];
  private reportInterval: ReturnType<typeof setInterval> | undefined;
  private resourceInterval: ReturnType<typeof setInterval> | undefined;
  private lastCpu = getCpuSnapshot();
  private cpuUsage = 0;
  private memoryUsage = 0;
  private config: Required<PerformanceOptimizerConfig>;

  constructor(config: PerformanceOptimizerConfig = {}) {
    this.config = {
      reportIntervalMs: config.reportIntervalMs ?? 30000,
      resourceSampleIntervalMs: config.resourceSampleIntervalMs ?? 1000,
    };
  }

  createCache<T>(name: string): SmartCache<T> {
    const existing = this.caches.get(name);
    if (existing) {
      return existing as SmartCache<T>;
    }
    const cache = new SmartCache<T>(name);
    this.caches.set(name, cache as SmartCache<unknown>);
    return cache;
  }

  getCache<T>(name: string): SmartCache<T> | undefined {
    return this.caches.get(name) as SmartCache<T> | undefined;
  }

  createBatchProcessor<T, R>(
    name: string,
    processor: (items: T[]) => Promise<R[]> | R[],
    config?: BatchProcessorConfig,
  ): BatchProcessor<T, R> {
    const existing = this.batches.get(name);
    if (existing) {
      return existing as BatchProcessor<T, R>;
    }
    const batch = new BatchProcessor<T, R>(
      async (items: T[]) => await Promise.resolve(processor(items)),
      config,
    );
    (batch as unknown as { name: string }).name = name;
    this.batches.set(name, batch as BatchProcessor<unknown, unknown>);
    return batch;
  }

  createConnectionPool<T>(
    name: string,
    factory: () => Promise<T> | T,
    closer: (item: T) => Promise<void> | void,
    config?: ConnectionPoolConfig,
    validator?: (item: T) => Promise<boolean> | boolean,
  ): ConnectionPool<T> {
    const existing = this.pools.get(name);
    if (existing) {
      return existing as ConnectionPool<T>;
    }
    const pool = new ConnectionPool<T>(
      () => Promise.resolve(factory()),
      (item: T) => Promise.resolve(closer(item)),
      config,
      validator,
    );
    (pool as unknown as { name: string }).name = name;
    (pool as unknown as { getStats: () => ConnectionPoolStats }).getStats = () => ({
      activeConnections: (pool as unknown as { active: Set<T> }).active.size,
      idleConnections: (pool as unknown as { idle: Array<{ conn: T; since: number }> }).idle.length,
    });
    this.pools.set(name, pool as ConnectionPool<unknown>);
    return pool;
  }

  initialize(): void {
    if (this.resourceInterval) {
      return;
    }
    this.resourceInterval = setInterval(() => {
      const current = getCpuSnapshot();
      const idleDiff = current.idle - this.lastCpu.idle;
      const totalDiff = current.total - this.lastCpu.total;
      this.cpuUsage = totalDiff <= 0 ? 0 : Math.max(0, 100 * (1 - idleDiff / totalDiff));
      this.lastCpu = current;
      this.memoryUsage = (1 - os.freemem() / os.totalmem()) * 100;
    }, this.config.resourceSampleIntervalMs);

    if (this.config.reportIntervalMs > 0) {
      this.reportInterval = setInterval(() => {
        const stats = this.getStats();
        for (const cb of this.reportListeners) {
          try {
            cb(stats);
          } catch {
            // ignore listener errors
          }
        }
      }, this.config.reportIntervalMs);
    }
  }

  onReport(callback: ReportCallback): void {
    this.reportListeners.push(callback);
  }

  getStats(): PerformanceStats {
    const caches: Record<string, SmartCacheStats> = {};
    for (const [name, cache] of this.caches) {
      caches[name] = cache.getStats();
    }
    const batches: Record<string, BatchProcessorStats> = {};
    for (const [name, batch] of this.batches) {
      batches[name] = batch.getStats();
    }
    const pools: Record<string, ConnectionPoolStats> = {};
    for (const [name, pool] of this.pools) {
      pools[name] = (pool as unknown as { getStats: () => ConnectionPoolStats }).getStats();
    }
    return {
      cpuUsage: this.cpuUsage,
      memoryUsage: this.memoryUsage,
      caches,
      batches,
      pools,
    };
  }

  getPrometheusMetrics(): string {
    const lines: string[] = [];

    lines.push(
      "# HELP ouroboros_cache_hit_rate Cache hit rate by name",
      "# TYPE ouroboros_cache_hit_rate gauge",
    );
    for (const [name, cache] of this.caches) {
      lines.push(`ouroboros_cache_hit_rate{name="${name}"} ${cache.getStats().hitRate}`);
    }

    lines.push(
      "",
      "# HELP ouroboros_pool_active_connections Active connections by pool name",
      "# TYPE ouroboros_pool_active_connections gauge",
    );
    for (const [name, pool] of this.pools) {
      const stats = (pool as unknown as { getStats: () => ConnectionPoolStats }).getStats();
      lines.push(`ouroboros_pool_active_connections{name="${name}"} ${stats.activeConnections}`);
    }

    lines.push(
      "",
      "# HELP ouroboros_batch_queue_size Batch queue size by name",
      "# TYPE ouroboros_batch_queue_size gauge",
    );
    for (const [name, batch] of this.batches) {
      lines.push(`ouroboros_batch_queue_size{name="${name}"} ${batch.getStats().queueSize}`);
    }

    lines.push(
      "",
      "# HELP ouroboros_cpu_usage_percent CPU usage percent",
      "# TYPE ouroboros_cpu_usage_percent gauge",
      `ouroboros_cpu_usage_percent ${this.cpuUsage}`,
    );

    lines.push(
      "",
      "# HELP ouroboros_memory_usage_percent Memory usage percent",
      "# TYPE ouroboros_memory_usage_percent gauge",
      `ouroboros_memory_usage_percent ${this.memoryUsage}`,
    );

    return lines.join("\n");
  }

  destroy(): void {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = undefined;
    }
    if (this.resourceInterval) {
      clearInterval(this.resourceInterval);
      this.resourceInterval = undefined;
    }
    for (const cache of this.caches.values()) {
      cache.destroy();
    }
    this.caches.clear();
    for (const batch of this.batches.values()) {
      batch.destroy();
    }
    this.batches.clear();
    for (const pool of this.pools.values()) {
      void pool.drain();
    }
    this.pools.clear();
    this.reportListeners = [];
    this.cpuUsage = 0;
    this.memoryUsage = 0;
  }
}
