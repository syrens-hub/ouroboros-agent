import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../../core/hook-system.ts";

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it("emits to registered handlers", async () => {
    const handler = vi.fn();
    registry.register("agent:turnStart", handler);
    await registry.emit("agent:turnStart", { sessionId: "s1", turn: 1 });
    expect(handler).toHaveBeenCalledWith("agent:turnStart", { sessionId: "s1", turn: 1 });
  });

  it("does not block when a handler throws", async () => {
    const badHandler = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();
    registry.register("agent:turnEnd", badHandler);
    registry.register("agent:turnEnd", goodHandler);
    await registry.emit("agent:turnEnd", { sessionId: "s1" });
    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it("times out slow handlers", async () => {
    const slowHandler = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10000));
    });
    registry.register("agent:llmCall", slowHandler);
    const start = Date.now();
    await registry.emit("agent:llmCall", { sessionId: "s1" });
    expect(Date.now() - start).toBeLessThan(7000); // Should be ~5000ms timeout
    expect(slowHandler).toHaveBeenCalled();
  }, 15000);
});
