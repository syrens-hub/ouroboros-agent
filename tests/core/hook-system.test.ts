import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { HookRegistry, type HookEventType } from "../../core/hook-system.ts";

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it("registers and emits handlers", async () => {
    const handler = vi.fn();
    registry.register("agent:turnEnd", handler);
    await registry.emit("agent:turnEnd", { sessionId: "s1" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unregisters handler", async () => {
    const handler = vi.fn();
    registry.register("agent:turnEnd", handler);
    registry.unregister("agent:turnEnd", handler);
    await registry.emit("agent:turnEnd", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("getLoadedHooks returns empty initially", () => {
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("getHandlers returns empty for unknown event", () => {
    expect(registry.getHandlers("notification" as HookEventType)).toEqual([]);
  });

  it("handles handler timeout gracefully", async () => {
    const slowHandler = () => new Promise<void>(() => {});
    registry.register("agent:turnEnd", slowHandler);
    await expect(registry.emit("agent:turnEnd", {})).resolves.toBeUndefined();
  }, 7000);

  it("handles handler throw gracefully", async () => {
    const badHandler = () => { throw new Error("boom"); };
    registry.register("agent:turnEnd", badHandler);
    await expect(registry.emit("agent:turnEnd", {})).resolves.toBeUndefined();
  });
});

describe("HookRegistry discoverAndLoad", () => {
  const testDir = join(process.cwd(), ".ouroboros", "test-hooks-" + Date.now());

  beforeEach(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("creates dir when missing", () => {
    const missingDir = join(testDir, "missing");
    const registry = new HookRegistry();
    registry.discoverAndLoad(missingDir);
    expect(existsSync(missingDir)).toBe(true);
  });

  it("skips non-directories", () => {
    writeFileSync(join(testDir, "file.txt"), "", "utf-8");
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("skips directories without handler.ts", () => {
    mkdirSync(join(testDir, "no-handler"), { recursive: true });
    writeFileSync(join(testDir, "no-handler", "hook.json"), JSON.stringify({ name: "nope", events: ["agent:turnEnd"] }), "utf-8");
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("skips yaml manifest", () => {
    mkdirSync(join(testDir, "yaml-hook"), { recursive: true });
    writeFileSync(join(testDir, "yaml-hook", "hook.yaml"), "name: yaml", "utf-8");
    writeFileSync(join(testDir, "yaml-hook", "handler.ts"), "export default () => {}", "utf-8");
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("skips invalid json manifest", () => {
    mkdirSync(join(testDir, "bad-json"), { recursive: true });
    writeFileSync(join(testDir, "bad-json", "hook.json"), "not-json", "utf-8");
    writeFileSync(join(testDir, "bad-json", "handler.ts"), "export default () => {}", "utf-8");
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("skips manifest without events array", () => {
    mkdirSync(join(testDir, "no-events"), { recursive: true });
    writeFileSync(join(testDir, "no-events", "hook.json"), JSON.stringify({ name: "no-events" }), "utf-8");
    writeFileSync(join(testDir, "no-events", "handler.ts"), "export default () => {}", "utf-8");
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    expect(registry.getLoadedHooks()).toEqual([]);
  });

  it("loads valid json manifest and registers handler", async () => {
    const hookName = "valid-hook";
    mkdirSync(join(testDir, hookName), { recursive: true });
    writeFileSync(
      join(testDir, hookName, "hook.json"),
      JSON.stringify({ name: hookName, events: ["agent:turnEnd"] }),
      "utf-8"
    );
    writeFileSync(
      join(testDir, hookName, "handler.ts"),
      "export async function handle() { return; }",
      "utf-8"
    );
    const registry = new HookRegistry();
    registry.discoverAndLoad(testDir);
    // dynamic import is async; wait a tick
    await new Promise((r) => setTimeout(r, 100));
    const loaded = registry.getLoadedHooks();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe(hookName);
    expect(registry.getHandlers("agent:turnEnd").length).toBe(1);
  });
});
