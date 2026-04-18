import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDbSingleton } from "../../core/db-manager.ts";
import {
  ProductionEventBus,
  initEventBusTables,
  DEFAULT_RETRY_POLICY,
  type HookEventType,
} from "../../core/event-bus.ts";
import { hookRegistry } from "../../core/hook-system.ts";

describe("Production EventBus", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEventBusTables(db);
    db.exec("DELETE FROM dead_letters;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("emits events asynchronously without blocking", async () => {
    const bus = new ProductionEventBus({ maxConcurrent: 5 });
    const received: string[] = [];

    hookRegistry.register("checkpoint:create", async () => {
      received.push("checkpoint:create");
    });

    bus.emitAsync("checkpoint:create", { sessionId: "s1" });
    // Give it time to process
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain("checkpoint:create");
    bus.shutdown();
  });

  it("retries failed handlers and moves to dead letter", async () => {
    const bus = new ProductionEventBus({
      retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2, baseDelayMs: 10 },
      maxConcurrent: 5,
    });

    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      throw new Error("ConnectionError: simulated failure");
    });

    hookRegistry.register("session:close", handler);
    bus.emitAsync("session:close", { sessionId: "s2" });

    await new Promise((r) => setTimeout(r, 200));

    // Should retry maxAttempts times
    expect(calls).toBe(2);

    // Check dead letter
    const dls = bus.getDeadLetters();
    expect(dls.length).toBe(1);
    expect(dls[0].eventType).toBe("session:close");
    expect(dls[0].status).toBe("pending");

    bus.shutdown();
  });

  it("does not retry non-retriable errors", async () => {
    const bus = new ProductionEventBus({
      retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3, baseDelayMs: 10 },
      maxConcurrent: 5,
    });

    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      throw new Error("FatalLogicError: should not retry");
    });

    hookRegistry.register("skill:execute", handler);
    bus.emitAsync("skill:execute", {});

    await new Promise((r) => setTimeout(r, 100));

    // Should only call once because error is not retriable
    expect(calls).toBe(1);
    bus.shutdown();
  });

  it("resolves dead letter by id", async () => {
    const bus = new ProductionEventBus({
      retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1, baseDelayMs: 10 },
      maxConcurrent: 5,
    });

    hookRegistry.register("tool:batchStart", async () => {
      throw new Error("ConnectionError: fail");
    });
    bus.emitAsync("tool:batchStart", { message: "test" });

    await new Promise((r) => setTimeout(r, 100));

    const dls = bus.getDeadLetters("pending");
    expect(dls.length).toBe(1);

    const resolved = bus.resolveDeadLetter(dls[0].id);
    expect(resolved).toBe(true);

    const pending = bus.getDeadLetters("pending");
    expect(pending.length).toBe(0);

    bus.shutdown();
  });

  it("retries dead letter by re-queuing", async () => {
    const bus = new ProductionEventBus({
      retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1, baseDelayMs: 10 },
      maxConcurrent: 5,
    });

    let calls = 0;
    hookRegistry.register("tool:progress", async () => {
      calls++;
      if (calls < 2) throw new Error("ConnectionError: fail");
    });
    bus.emitAsync("tool:progress", { skillName: "x" });

    await new Promise((r) => setTimeout(r, 100));

    const dls = bus.getDeadLetters("pending");
    expect(dls.length).toBe(1);

    const retried = bus.retryDeadLetter(dls[0].id);
    expect(retried).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(2);

    bus.shutdown();
  });

  it("returns health check snapshot", async () => {
    const bus = new ProductionEventBus();
    const health = bus.healthCheck();
    expect(health.queueSize).toBe(0);
    expect(health.deadLetterCount).toBe(0);
    expect(health.running).toBe(false);
    bus.shutdown();
  });

  it("respects concurrency limit", async () => {
    const bus = new ProductionEventBus({ maxConcurrent: 1 });
    const maxActive: number[] = [];
    let current = 0;

    for (let i = 0; i < 5; i++) {
      const et = `checkpoint:restore` as HookEventType;
      hookRegistry.register(et, async () => {
        current++;
        maxActive.push(current);
        await new Promise((r) => setTimeout(r, 20));
        current--;
      });
      bus.emitAsync(et, {});
    }

    await new Promise((r) => setTimeout(r, 300));
    expect(Math.max(...maxActive)).toBeLessThanOrEqual(1);
    bus.shutdown();
  });
});
