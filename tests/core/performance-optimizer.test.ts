import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PerformanceOptimizer } from "../../core/performance-optimizer.ts";

describe("PerformanceOptimizer", () => {
  let optimizer: PerformanceOptimizer;

  beforeEach(() => {
    optimizer = new PerformanceOptimizer({
      reportIntervalMs: 100,
      resourceSampleIntervalMs: 100,
    });
  });

  afterEach(() => {
    optimizer.destroy();
  });

  it("creates and gets a cache", () => {
    const cache = optimizer.createCache<string>("test-cache");
    expect(cache).toBeDefined();
    expect(cache.name).toBe("test-cache");
    expect(optimizer.getCache<string>("test-cache")).toBe(cache);
    expect(optimizer.getCache("missing")).toBeUndefined();
  });

  it("creates a batch processor", () => {
    const processor = async (items: number[]) => items.map((x) => x * 2);
    const batch = optimizer.createBatchProcessor<number, number>(
      "test-batch",
      processor,
    );
    expect(batch).toBeDefined();
    expect((batch as unknown as { name: string }).name).toBe("test-batch");
  });

  it("initializes and starts monitoring", async () => {
    optimizer.initialize();
    await new Promise((r) => setTimeout(r, 150));
    const stats = optimizer.getStats();
    expect(typeof stats.cpuUsage).toBe("number");
    expect(typeof stats.memoryUsage).toBe("number");
    expect(stats.memoryUsage).toBeGreaterThanOrEqual(0);
    expect(stats.memoryUsage).toBeLessThanOrEqual(100);
  });

  it("getStats returns plausible numbers after usage", () => {
    const cache = optimizer.createCache<string>("stats-cache");
    cache.set("a", "1");
    cache.get("a");
    cache.get("b"); // miss

    const batch = optimizer.createBatchProcessor<number, number>(
      "stats-batch",
      (items) => items,
    );
    batch.add(1).catch(() => {});
    batch.add(2).catch(() => {});

    optimizer.createConnectionPool<number>(
      "stats-pool",
      () => Promise.resolve(1),
      () => Promise.resolve(),
    );

    optimizer.initialize();
    const stats = optimizer.getStats();
    expect(stats.caches["stats-cache"].hitRate).toBe(0.5);
    expect(stats.batches["stats-batch"].queueSize).toBe(2);
    expect(stats.pools["stats-pool"].activeConnections).toBe(0);
  });

  it("getPrometheusMetrics contains expected metric lines", () => {
    optimizer.createCache<string>("prom-cache");
    optimizer.createBatchProcessor<number, number>("prom-batch", (items) => items);
    optimizer.createConnectionPool<number>(
      "prom-pool",
      () => Promise.resolve(1),
      () => Promise.resolve(),
    );

    const metrics = optimizer.getPrometheusMetrics();
    expect(metrics).toContain('ouroboros_cache_hit_rate{name="prom-cache"} 0');
    expect(metrics).toContain(
      'ouroboros_pool_active_connections{name="prom-pool"} 0',
    );
    expect(metrics).toContain(
      'ouroboros_batch_queue_size{name="prom-batch"} 0',
    );
    expect(metrics).toContain("ouroboros_cpu_usage_percent");
    expect(metrics).toContain("ouroboros_memory_usage_percent");
  });

  it("onReport registers listener and receives reports", async () => {
    const listener = vi.fn();
    optimizer.onReport(listener);
    optimizer.initialize();
    await new Promise((r) => setTimeout(r, 250));
    expect(listener).toHaveBeenCalled();
    const callArg = listener.mock.calls[0][0];
    expect(typeof callArg.cpuUsage).toBe("number");
  });

  it("destroy cleans up timers and resources", async () => {
    optimizer.initialize();
    const listener = vi.fn();
    optimizer.onReport(listener);

    optimizer.createCache<string>("destroy-cache");
    optimizer.createBatchProcessor<number, number>(
      "destroy-batch",
      (items) => items,
    );
    const pool = optimizer.createConnectionPool<number>(
      "destroy-pool",
      () => Promise.resolve(1),
      () => Promise.resolve(),
    );

    const conn = await pool.acquire();
    pool.release(conn);

    optimizer.destroy();

    // Stats should be empty / zeroed
    const stats = optimizer.getStats();
    expect(Object.keys(stats.caches).length).toBe(0);
    expect(Object.keys(stats.batches).length).toBe(0);
    expect(Object.keys(stats.pools).length).toBe(0);
    expect(stats.cpuUsage).toBe(0);
    expect(stats.memoryUsage).toBe(0);

    // Wait to ensure no more reports fire
    await new Promise((r) => setTimeout(r, 200));
    expect(listener).not.toHaveBeenCalled();
  });
});
