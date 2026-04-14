import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChannelRegistry } from "../../core/channel-registry.ts";
import { resetDbSingleton } from "../../core/db-manager.ts";
import type { ChannelPlugin } from "../../types/index.ts";

const mockPlugin: ChannelPlugin = {
  id: "mock",
  meta: { selectionLabel: "Mock", blurb: "Mock plugin" },
  inbound: {
    onMessage: () => () => {},
  },
  outbound: {
    sendText: async () => ({ success: true, data: undefined }),
    sendRichText: async () => ({ success: true, data: undefined }),
    sendReadReceipt: async () => ({ success: true, data: undefined }),
  },
  getMembers: async () => ({ success: true, data: [] }),
};

describe("ChannelRegistry", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    resetDbSingleton();
    registry = new ChannelRegistry();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("registers and retrieves plugins", () => {
    registry.register(mockPlugin);
    expect(registry.get("mock")).toBe(mockPlugin);
  });

  it("lists all registered plugins", () => {
    registry.register(mockPlugin);
    expect(registry.list()).toEqual([mockPlugin]);
  });

  it("binds session to channel and resolves plugin", () => {
    registry.register(mockPlugin);
    registry.bindSession("session_1", "mock", { foo: "bar" });
    const resolved = registry.getChannelForSession("session_1");
    expect(resolved).toBe(mockPlugin);
  });

  it("returns undefined for unbound session", () => {
    registry.register(mockPlugin);
    expect(registry.getChannelForSession("unknown")).toBeUndefined();
  });
});
