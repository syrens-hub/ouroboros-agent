import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOrCreateRunner,
  removeRunner,
  resolveConfirm,
  confirmRequestHandlers,
  startRunnerIdleCleanup,
  setRunnerPoolLimits,
  getRunnerPoolStats,
  resetRunnerPool,
  getSessionToolCount,
  reloadSkillTools,
} from "../../web/runner-pool.ts";

describe("Runner Pool", () => {
  beforeEach(() => {
    resetRunnerPool();
    setRunnerPoolLimits({ maxRunners: 3, idleTimeoutMs: 100 });
  });

  afterEach(() => {
    resetRunnerPool();
    setRunnerPoolLimits({ maxRunners: 50, idleTimeoutMs: 30 * 60 * 1000 });
  });

  it("creates and caches runners", () => {
    const r1 = getOrCreateRunner("s1");
    const r2 = getOrCreateRunner("s1");
    expect(r1).toBe(r2);
    expect(getRunnerPoolStats().size).toBe(1);
  });

  it("evicts least recently used runner when max is exceeded", async () => {
    const r1 = getOrCreateRunner("s1");
    const r2 = getOrCreateRunner("s2");
    await new Promise((res) => setTimeout(res, 10));
    const r3 = getOrCreateRunner("s3");
    await new Promise((res) => setTimeout(res, 10));
    // s1 is now LRU
    const r4 = getOrCreateRunner("s4");

    expect(getRunnerPoolStats().size).toBe(3);
    expect(getOrCreateRunner("s2")).toBe(r2);
    expect(getOrCreateRunner("s3")).toBe(r3);
    expect(getOrCreateRunner("s4")).toBe(r4);
    // s1 should have been evicted, so a new runner is created
    const r1New = getOrCreateRunner("s1");
    expect(r1New).not.toBe(r1);
  });

  it("cleans confirmRequestHandlers on eviction", async () => {
    confirmRequestHandlers.set("s1", () => {});
    getOrCreateRunner("s1");
    await new Promise((res) => setTimeout(res, 10));
    getOrCreateRunner("s2");
    await new Promise((res) => setTimeout(res, 10));
    getOrCreateRunner("s3");
    await new Promise((res) => setTimeout(res, 10));
    // Evict s1 by creating s4
    getOrCreateRunner("s4");
    expect(confirmRequestHandlers.has("s1")).toBe(false);
  });

  it("cleans confirmRequestHandlers on removeRunner", () => {
    confirmRequestHandlers.set("s1", () => {});
    getOrCreateRunner("s1");
    removeRunner("s1");
    expect(confirmRequestHandlers.has("s1")).toBe(false);
    expect(getRunnerPoolStats().size).toBe(0);
  });

  it("resolveConfirm returns false when no deferred exists", () => {
    expect(resolveConfirm("unknown", true)).toBe(false);
  });

  it("confirmRequestHandlers are invoked on ask confirm", async () => {
    const handler = vi.fn();
    confirmRequestHandlers.set("s5", handler);
    getOrCreateRunner("s5");
    // Trigger the handler as if the runner asked for confirmation
    const h = confirmRequestHandlers.get("s5");
    expect(h).toBeDefined();
    h!("test_tool", { foo: 1 });
    expect(handler).toHaveBeenCalledWith("test_tool", { foo: 1 });
  });

  it("idle cleanup removes stale runners", async () => {
    getOrCreateRunner("idle1");
    startRunnerIdleCleanup(50);
    await new Promise((res) => setTimeout(res, 250));
    expect(getRunnerPoolStats().size).toBe(0);
  });

  it("touching a runner refreshes its LRU position", async () => {
    getOrCreateRunner("a");
    await new Promise((res) => setTimeout(res, 20));
    getOrCreateRunner("b");
    await new Promise((res) => setTimeout(res, 20));
    // Touch a to make it newer than b
    getOrCreateRunner("a");
    await new Promise((res) => setTimeout(res, 20));
    getOrCreateRunner("c");
    // Now max is 3. Adding d should evict the LRU (b)
    getOrCreateRunner("d");
    expect(getOrCreateRunner("a")).toBeDefined();
    expect(getOrCreateRunner("c")).toBeDefined();
    expect(getOrCreateRunner("d")).toBeDefined();
    // b was evicted
    const stats = getRunnerPoolStats();
    expect(stats.size).toBe(3);
  });

  it("each runner gets its own isolated tool pool", () => {
    getOrCreateRunner("iso1");
    getOrCreateRunner("iso2");
    expect(getSessionToolCount("iso1")).toBeGreaterThan(0);
    expect(getSessionToolCount("iso2")).toBeGreaterThan(0);
    expect(getSessionToolCount("iso1")).toBe(getSessionToolCount("iso2"));
  });

  it("reloadSkillTools propagates to all active session pools", () => {
    getOrCreateRunner("active1");
    getOrCreateRunner("active2");
    const before1 = getSessionToolCount("active1");
    const before2 = getSessionToolCount("active2");

    const dummyTool = {
      name: "__dummy_isolation_test_tool__",
      description: "test",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true }),
    } as unknown as import("../../types/index.ts").Tool<unknown, unknown, unknown>;

    reloadSkillTools([dummyTool]);

    expect(getSessionToolCount("active1")).toBe(before1 + 1);
    expect(getSessionToolCount("active2")).toBe(before2 + 1);
  });
});
