import { describe, it, expect, beforeEach } from "vitest";
import { getCached, MAX_API_CACHE_SIZE } from "../../../../web/routes/lib/cache.ts";

describe("API Cache", () => {
  beforeEach(() => {
    // Reset cache module state by re-importing is not trivial with ESM.
    // Instead we rely on unique keys per test.
  });

  it("caches function result and returns it on subsequent calls", () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return `result-${callCount}`;
    };

    const r1 = getCached("key-a", 60_000, fn);
    expect(r1).toBe("result-1");
    expect(callCount).toBe(1);

    const r2 = getCached("key-a", 60_000, fn);
    expect(r2).toBe("result-1");
    expect(callCount).toBe(1);
  });

  it("re-executes fn after TTL expires", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return `v${callCount}`;
    };

    const r1 = getCached("key-b", 10, fn);
    expect(r1).toBe("v1");

    await new Promise((r) => setTimeout(r, 20));

    const r2 = getCached("key-b", 10, fn);
    expect(r2).toBe("v2");
    expect(callCount).toBe(2);
  });

  it("evicts oldest entry when cache exceeds max size", () => {
    let counter = 0;
    const fn = () => `val-${counter++}`;

    // Fill cache to capacity
    for (let i = 0; i < MAX_API_CACHE_SIZE; i++) {
      getCached(`fill-${i}`, 60_000, fn);
    }

    // Add one more — should trigger eviction
    getCached("overflow", 60_000, fn);

    // The oldest key should have been evicted
    const oldestCallCount = counter;
    getCached("fill-0", 60_000, fn);
    expect(counter).toBe(oldestCallCount + 1);
  });

  it("evicts expired entries before evicting live ones", async () => {
    let callCount = 0;
    const fn = () => `live-${callCount++}`;

    // Add an entry with very short TTL
    getCached("short-ttl", 1, () => "expired");
    await new Promise((r) => setTimeout(r, 10));

    // Fill cache with long-lived entries
    for (let i = 0; i < MAX_API_CACHE_SIZE; i++) {
      getCached(`long-${i}`, 60_000, fn);
    }

    // Add one more — expired entry should be removed first
    getCached("new", 60_000, fn);

    // Expired key should have been re-created if accessed
    const r = getCached("short-ttl", 60_000, () => "recreated");
    expect(r).toBe("recreated");
  });
});
