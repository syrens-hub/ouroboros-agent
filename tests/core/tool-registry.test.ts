import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tool } from "../../types/index.ts";

async function importToolRegistry() {
  vi.resetModules();
  const mod = await import("../../core/tool-registry.ts");
  return mod;
}

function mockTool(name: string): Tool<unknown, unknown, unknown> {
  return { name } as Tool<unknown, unknown, unknown>;
}

describe("tool-registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers a callback and returns an unsubscribe function", async () => {
    const { onToolsReloaded, notifyToolsReloaded } = await importToolRegistry();
    const cb = vi.fn();

    const unsubscribe = onToolsReloaded(cb);

    expect(unsubscribe).toBeTypeOf("function");
    // Ensure the callback is registered by notifying
    notifyToolsReloaded([mockTool("t1")]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("notifies all registered listeners with the provided tools", async () => {
    const { onToolsReloaded, notifyToolsReloaded } = await importToolRegistry();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    onToolsReloaded(cb1);
    onToolsReloaded(cb2);

    const tools = [mockTool("a"), mockTool("b")];
    notifyToolsReloaded(tools);

    expect(cb1).toHaveBeenCalledExactlyOnceWith(tools);
    expect(cb2).toHaveBeenCalledExactlyOnceWith(tools);
  });

  it("removes a listener via unsubscribe so it is no longer called", async () => {
    const { onToolsReloaded, notifyToolsReloaded } = await importToolRegistry();
    const cb = vi.fn();

    const unsubscribe = onToolsReloaded(cb);
    unsubscribe();

    notifyToolsReloaded([mockTool("x")]);

    expect(cb).not.toHaveBeenCalled();
  });

  it("catches listener exceptions and does not break other listeners", async () => {
    const { onToolsReloaded, notifyToolsReloaded } = await importToolRegistry();
    const goodCb = vi.fn();
    const badCb = vi.fn(() => {
      throw new Error("boom");
    });

    onToolsReloaded(badCb);
    onToolsReloaded(goodCb);

    const tools = [mockTool("safe")];
    expect(() => notifyToolsReloaded(tools)).not.toThrow();

    expect(badCb).toHaveBeenCalledExactlyOnceWith(tools);
    expect(goodCb).toHaveBeenCalledExactlyOnceWith(tools);
  });

  it("delivers the same tools array to multiple listeners", async () => {
    const { onToolsReloaded, notifyToolsReloaded } = await importToolRegistry();
    const received: Tool<unknown, unknown, unknown>[][] = [];

    onToolsReloaded((tools) => received.push(tools));
    onToolsReloaded((tools) => received.push(tools));

    const tools = [mockTool("shared")];
    notifyToolsReloaded(tools);

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(tools);
    expect(received[1]).toBe(tools);
  });
});
