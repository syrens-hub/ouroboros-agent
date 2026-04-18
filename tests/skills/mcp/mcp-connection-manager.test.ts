import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MCPConnectionManager,
  initMcpConnectionManager,
  getMcpConnectionManager,
  McpAuthError,
  McpSessionExpiredError,
} from "../../../skills/mcp/index.ts";

describe("MCPConnectionManager", () => {
  let manager: MCPConnectionManager;

  beforeEach(() => {
    vi.resetModules();
    manager = new MCPConnectionManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it("ensureConnected returns error when not configured and no config provided", async () => {
    const res = await manager.ensureConnected("missing-server");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("MCP_NOT_CONFIGURED");
    }
  });

  it("callTool returns error when server not connected", async () => {
    const res = await manager.callTool("missing-server", "tool", {});
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("MCP_NOT_CONFIGURED");
    }
  });

  it("discoverTools returns error when server not connected", async () => {
    const res = await manager.discoverTools("missing-server");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("MCP_NOT_CONFIGURED");
    }
  });

  it("health returns empty when no connections", () => {
    expect(manager.health()).toEqual({});
  });

  it("shutdown clears connections and timers without throwing", async () => {
    // Should not throw even when empty
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });

  it("singleton: initMcpConnectionManager returns null when SDK unavailable", async () => {
    const inst = await initMcpConnectionManager();
    expect(inst).toBeNull();
  });

  it("singleton: getMcpConnectionManager reflects init result", async () => {
    // After init returned null, getMcpConnectionManager should also return null
    expect(getMcpConnectionManager()).toBeNull();
  });
});

describe("McpAuthError", () => {
  it("carries serverName", () => {
    const err = new McpAuthError("srv", "bad auth");
    expect(err.serverName).toBe("srv");
    expect(err.message).toBe("bad auth");
  });
});

describe("McpSessionExpiredError", () => {
  it("identifies as session expired", () => {
    const err = new McpSessionExpiredError("srv");
    expect(err.serverName).toBe("srv");
    expect(err.message).toContain("session expired");
  });
});
