import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SmartCache } from "../../core/smart-cache.ts";

describe("SmartCache", () => {
  let cache: SmartCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cache?.destroy();
    vi.useRealTimers();
  });

  it("set/get basic flow", () => {
    cache = new SmartCache<string>();
    cache.set("a", "hello");
    expect(cache.get("a")).toBe("hello");
    expect(cache.has("a")).toBe(true);
  });

  it("returns undefined for missing keys", () => {
    cache = new SmartCache<string>();
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
    expect(cache.getStats().misses).toBe(1);
  });

  it("delete removes entry", () => {
    cache = new SmartCache<string>();
    cache.set("a", "hello");
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("a")).toBe(false);
  });

  it("clear removes all entries", () => {
    cache = new SmartCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.getStats().entryCount).toBe(0);
  });

  it("TTL expiration via get", () => {
    cache = new SmartCache<string>({ ttlMs: 1000 });
    cache.set("a", "hello");
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe("hello");
    vi.advanceTimersByTime(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
  });

  it("TTL expiration via periodic cleanup", () => {
    cache = new SmartCache<string>({ ttlMs: 1000 });
    cache.set("a", "hello");
    vi.advanceTimersByTime(30000);
    expect(cache.has("a")).toBe(false);
    expect(cache.getStats().entryCount).toBe(0);
  });

  it("overrides default TTL with per-entry TTL", () => {
    cache = new SmartCache<string>({ ttlMs: 1000 });
    cache.set("a", "hello", 5000);
    vi.advanceTimersByTime(2000);
    expect(cache.get("a")).toBe("hello");
  });

  it("LRU eviction by maxEntries", () => {
    cache = new SmartCache<string>({ maxEntries: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("LRU eviction by maxEntries updates order on get", () => {
    cache = new SmartCache<string>({ maxEntries: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  it("LRU eviction by maxMemoryBytes", () => {
    cache = new SmartCache<string>({ maxMemoryBytes: 10 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  it("LRU eviction by maxMemoryBytes updates order on get", () => {
    cache = new SmartCache<string>({ maxMemoryBytes: 6 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  it("getOrSet factory only called once", async () => {
    cache = new SmartCache<string>();
    const factory = vi.fn().mockReturnValue("computed");
    const result1 = await cache.getOrSet("a", factory);
    const result2 = await cache.getOrSet("a", factory);
    expect(result1).toBe("computed");
    expect(result2).toBe("computed");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("getOrSet supports async factory", async () => {
    cache = new SmartCache<string>();
    const factory = vi.fn().mockResolvedValue("async-value");
    const result = await cache.getOrSet("a", factory);
    expect(result).toBe("async-value");
  });

  it("stats accuracy", () => {
    cache = new SmartCache<string>({ maxEntries: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.get("a");
    cache.get("missing");
    cache.set("c", "3");
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(stats.entryCount).toBe(2);
    expect(stats.currentMemoryBytes).toBeGreaterThan(0);
  });

  it("destroy clears everything and stops timer", () => {
    cache = new SmartCache<string>({ ttlMs: 1000 });
    cache.set("a", "hello");
    cache.destroy();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.getStats().entryCount).toBe(0);
    expect(cache.getStats().currentMemoryBytes).toBe(0);
  });
});
