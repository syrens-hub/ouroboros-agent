/**
 * MCP Connection Manager
 * ======================
 * Enterprise-grade MCP connection lifecycle: reconnect, auth handling,
 * session expiry detection, and transport abstraction.
 */

import type { Tool, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { logger } from "../../core/logger.ts";
import { credentialStrip } from "../../core/safe-utils.ts";
import { jsonSchemaToZod } from "./utils.ts";

export type MCPServerConfig = {
  name: string;
  transport?: "stdio" | "sse" | "streamable-http" | "websocket";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
};

export type MCPConnectionStatus = "connecting" | "connected" | "disconnected" | "needs-auth";

export interface ConnectedMCPServer {
  name: string;
  status: MCPConnectionStatus;
  session: unknown;
  transport: unknown;
}

export class McpAuthError extends Error {
  serverName: string;
  constructor(serverName: string, message: string) {
    super(message);
    this.name = "McpAuthError";
    this.serverName = serverName;
  }
}

export class McpSessionExpiredError extends Error {
  serverName: string;
  constructor(serverName: string) {
    super(`MCP server "${serverName}" session expired`);
    this.name = "McpSessionExpiredError";
    this.serverName = serverName;
  }
}

function isMcpSessionExpiredError(error: Error): boolean {
  const code = (error as Error & { code?: number }).code;
  if (code !== 404) return false;
  const msg = error.message || "";
  return msg.includes("-32001") || msg.includes("Session not found");
}

let _mcpModule: Record<string, unknown> | null = null;

async function loadMcpSdk(): Promise<Record<string, unknown> | null> {
  if (_mcpModule) return _mcpModule;
  try {
    _mcpModule = (await import("@modelcontextprotocol/sdk")) as Record<string, unknown>;
    return _mcpModule;
  } catch (e) {
    logger.debug("MCP SDK not installed; MCP support disabled", { error: String(e) });
    return null;
  }
}

function getTransportType(config: MCPServerConfig): string {
  if (config.transport) return config.transport;
  if (config.url) {
    if (config.url.startsWith("ws://") || config.url.startsWith("wss://")) return "websocket";
    return "streamable-http";
  }
  return "stdio";
}

export class MCPConnectionManager {
  private connections = new Map<string, ConnectedMCPServer>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async connect(config: MCPServerConfig): Promise<Result<void>> {
    const mcp = await loadMcpSdk();
    if (!mcp) {
      return err({ code: "MCP_UNAVAILABLE", message: "MCP SDK is not installed." });
    }

    const existing = this.connections.get(config.name);
    if (existing?.status === "connected") {
      return ok(undefined);
    }

    this.setStatus(config.name, "connecting");

    try {
      const transportType = getTransportType(config);
      let transport: unknown;

      if (transportType === "sse") {
        const Ctor = mcp.SSEClientTransport as new (url: URL, opts?: { headers?: Record<string, string> }) => unknown;
        if (!Ctor) {
          return err({ code: "MCP_TRANSPORT_UNSUPPORTED", message: "SSE transport not available in installed MCP SDK." });
        }
        transport = new Ctor(new URL(config.url!), { headers: config.headers });
      } else if (transportType === "streamable-http") {
        const Ctor = mcp.StreamableHTTPClientTransport as new (url: URL, opts?: { headers?: Record<string, string> }) => unknown;
        if (!Ctor) {
          return err({ code: "MCP_TRANSPORT_UNSUPPORTED", message: "HTTP transport not available in installed MCP SDK." });
        }
        transport = new Ctor(new URL(config.url!), { headers: config.headers });
      } else if (transportType === "websocket") {
        return err({ code: "MCP_TRANSPORT_UNSUPPORTED", message: "WebSocket transport not yet implemented." });
      } else {
        const ParamCtor = mcp.StdioServerParameters as new (params: { command: string; args: string[]; env: Record<string, string> }) => unknown;
        const TransportCtor = mcp.StdioClientTransport as new (params: unknown) => unknown;
        if (!ParamCtor || !TransportCtor) {
          return err({ code: "MCP_TRANSPORT_UNSUPPORTED", message: "Stdio transport not available in installed MCP SDK." });
        }
        const serverParams = new ParamCtor({
          command: config.command!,
          args: config.args || [],
          env: { ...(process.env as Record<string, string>), ...(config.env || {}) },
        });
        transport = new TransportCtor(serverParams);
      }

      const SessionCtor = mcp.ClientSession as new (transport: unknown) => { initialize(): Promise<void>; tools: { list(): Promise<{ tools: unknown[] }>; call(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> } };
      const session = new SessionCtor(transport);
      await session.initialize();

      this.connections.set(config.name, {
        name: config.name,
        status: "connected",
        session,
        transport,
      });

      // Clear any pending reconnect
      const timer = this.reconnectTimers.get(config.name);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(config.name);
      }

      return ok(undefined);
    } catch (e) {
      const msg = credentialStrip(String(e));
      logger.warn("MCP connect failed", { server: config.name, error: msg });
      this.setStatus(config.name, "disconnected");
      return err({ code: "MCP_CONNECT_FAILED", message: msg });
    }
  }

  async ensureConnected(serverName: string, config?: MCPServerConfig): Promise<Result<ConnectedMCPServer>> {
    const conn = this.connections.get(serverName);
    if (conn?.status === "connected") {
      return ok(conn);
    }
    if (!config) {
      return err({ code: "MCP_NOT_CONFIGURED", message: `MCP server ${serverName} is not configured.` });
    }
    const connectRes = await this.connect(config);
    if (!connectRes.success) return connectRes;
    const refreshed = this.connections.get(serverName)!;
    return ok(refreshed);
  }

  async discoverTools(serverName: string): Promise<Result<Tool<unknown, unknown, unknown>[]>> {
    const connRes = await this.ensureConnected(serverName);
    if (!connRes.success) return connRes;
    const conn = connRes.data;
    try {
      const toolsRes = await (conn.session as { tools: { list(): Promise<{ tools: unknown[] }> } }).tools.list();
      const tools: Tool<unknown, unknown, unknown>[] = (toolsRes.tools || []).map((t: unknown) =>
        this.wrapMcpTool(serverName, t as { name: string; description?: string; inputSchema?: Record<string, unknown> })
      );
      return ok(tools);
    } catch (e) {
      const error = e as Error;
      if (isMcpSessionExpiredError(error)) {
        this.handleSessionExpired(serverName);
        return err({ code: "MCP_SESSION_EXPIRED", message: `Session expired for ${serverName}` });
      }
      const msg = credentialStrip(String(e));
      logger.warn("MCP discoverTools failed", { server: serverName, error: msg });
      return err({ code: "MCP_DISCOVER_FAILED", message: msg });
    }
  }

  async callTool(serverName: string, toolName: string, input: unknown): Promise<Result<unknown>> {
    const connRes = await this.ensureConnected(serverName);
    if (!connRes.success) return connRes;
    const conn = connRes.data;
    try {
      const result = await (conn.session as { tools: { call(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> } }).tools.call({
        name: toolName,
        arguments: input as Record<string, unknown>,
      });
      return ok(result);
    } catch (e) {
      const error = e as Error;
      const msg = credentialStrip(String(e));
      if (isMcpSessionExpiredError(error)) {
        this.handleSessionExpired(serverName);
        return err({ code: "MCP_SESSION_EXPIRED", message: `Session expired for ${serverName}` });
      }
      if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("auth")) {
        this.setStatus(serverName, "needs-auth");
        return err({ code: "MCP_AUTH_ERROR", message: msg });
      }
      logger.warn("MCP tool call failed", { server: serverName, tool: toolName, error: msg });
      return err({ code: "MCP_TOOL_CALL_FAILED", message: msg });
    }
  }

  health(): Record<string, { status: MCPConnectionStatus; connected: boolean }> {
    const result: Record<string, { status: MCPConnectionStatus; connected: boolean }> = {};
    for (const [name, conn] of this.connections) {
      result[name] = { status: conn.status, connected: conn.status === "connected" };
    }
    return result;
  }

  async shutdown(): Promise<void> {
    for (const [name, timer] of this.reconnectTimers.entries()) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
    for (const [name, conn] of this.connections.entries()) {
      try {
        const t = conn.transport as { close?: () => Promise<void> | void };
        await t.close?.();
      } catch (e) {
        logger.warn("MCP transport close failed", { server: name, error: String(e) });
      }
    }
    this.connections.clear();
    _globalMcpManager = null;
  }

  private setStatus(name: string, status: MCPConnectionStatus): void {
    const conn = this.connections.get(name);
    if (conn) {
      conn.status = status;
    }
  }

  private handleSessionExpired(serverName: string): void {
    logger.warn("MCP session expired, scheduling reconnect", { server: serverName });
    this.connections.delete(serverName);
    this.scheduleReconnect(serverName, 1000);
  }

  private scheduleReconnect(serverName: string, delayMs: number): void {
    if (this.reconnectTimers.has(serverName)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverName);
      // Reconnect is lazy: next call to ensureConnected will retry
    }, Math.min(delayMs, 60000));
    this.reconnectTimers.set(serverName, timer);
  }

  private wrapMcpTool(serverName: string, mcpTool: { name: string; description?: string; inputSchema?: Record<string, unknown> }): Tool<unknown, unknown, unknown> {
    const inputSchema = jsonSchemaToZod(mcpTool.inputSchema || {});
    return {
      name: `${serverName}_${mcpTool.name}`,
      description: `[MCP ${serverName}] ${mcpTool.description || mcpTool.name}`,
      inputSchema,
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      call: async (input, _ctx) => {
        const result = await this.callTool(serverName, mcpTool.name, input);
        if (!result.success) {
          throw new Error(result.error.message);
        }
        return result.data;
      },
    };
  }
}

let _globalMcpManager: MCPConnectionManager | null = null;

export async function initMcpConnectionManager(): Promise<MCPConnectionManager | null> {
  if (_globalMcpManager) return _globalMcpManager;
  const sdk = await loadMcpSdk();
  if (!sdk) return null;
  _globalMcpManager = new MCPConnectionManager();
  return _globalMcpManager;
}

export function getMcpConnectionManager(): MCPConnectionManager | null {
  return _globalMcpManager;
}
