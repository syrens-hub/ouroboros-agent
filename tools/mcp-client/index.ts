/**
 * MCP (Model Context Protocol) Client Support
 *
 * Connects to external MCP servers via stdio or HTTP/StreamableHTTP transport,
 * discovers their tools, and registers them into the Ouroboros tool registry.
 *
 * The `@modelcontextprotocol/sdk` package is optional — if not installed,
 * this module is a no-op and logs a debug message.
 */

import type { Tool, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { logger } from "../../core/logger.ts";
import { appConfig } from "../../core/config.ts";
import { credentialStrip } from "../../core/safe-utils.ts";

import { MCPConnectionManager, initMcpConnectionManager } from "../../skills/mcp/index.ts";
import { persistMcpOutput } from "../../skills/mcp/output-storage.ts";
import { jsonSchemaToZod } from "../../skills/mcp/utils.ts";

export { jsonSchemaToZod };

export interface MCPServerConfig {
  name: string;
  transport?: "stdio" | "sse" | "streamable-http" | "websocket";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

let _MCP_AVAILABLE = false;
let _mcpModule: unknown = null;

async function loadMcpSdk() {
  if (_mcpModule) return _mcpModule;
  try {
    _mcpModule = await import("@modelcontextprotocol/sdk");
    _MCP_AVAILABLE = true;
    return _mcpModule;
  } catch (e) {
    _MCP_AVAILABLE = false;
    logger.debug("MCP SDK not installed; MCP support disabled", { error: String(e) });
    return null;
  }
}

export class McpClient {
  private manager: MCPConnectionManager;

  constructor(manager: MCPConnectionManager) {
    this.manager = manager;
  }

  async connect(config: MCPServerConfig): Promise<Result<void>> {
    return this.manager.connect(config);
  }

  async discoverTools(serverName: string): Promise<Result<Tool<unknown, unknown, unknown>[]>> {
    const connRes = await this.manager.ensureConnected(serverName);
    if (!connRes.success) return connRes;
    try {
      const toolsRes = await (connRes.data.session as { tools: { list(): Promise<{ tools: unknown[] }> } }).tools.list();
      const tools: Tool<unknown, unknown, unknown>[] = (toolsRes.tools || []).map((t: unknown) =>
        this.wrapMcpTool(serverName, t as { name: string; description?: string; inputSchema?: Record<string, unknown> })
      );
      return ok(tools);
    } catch (e) {
      logger.warn("MCP discoverTools failed", { server: serverName, error: credentialStrip(String(e)) });
      return err({ code: "MCP_DISCOVER_FAILED", message: credentialStrip(String(e)) });
    }
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
        const result = await this.manager.callTool(serverName, mcpTool.name, input);
        if (!result.success) {
          throw new Error(result.error.message);
        }
        const sessionId = _ctx.taskId;
        if (sessionId) {
          const toolUseId = `mcp_${serverName}_${mcpTool.name}_${Date.now()}`;
          const persisted = persistMcpOutput(sessionId, toolUseId, result.data);
          if (persisted.persisted) {
            return persisted.summary;
          }
        }
        return result.data;
      },
    };
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }
}

export async function initMcpTools(
  registerFn: (tool: Tool<unknown, unknown, unknown>) => void
): Promise<void> {
  const configs = appConfig.mcp?.servers || [];
  if (configs.length === 0) return;

  const sdk = await loadMcpSdk();
  if (!sdk) {
    logger.debug("MCP SDK not available, skipping MCP tool registration");
    return;
  }

  const manager = await initMcpConnectionManager();
  if (!manager) return;

  const client = new McpClient(manager);
  for (const cfg of configs) {
    const connectRes = await client.connect(cfg);
    if (!connectRes.success) {
      logger.warn("MCP server connect skipped", { server: cfg.name, error: connectRes.error.message });
      continue;
    }
    const toolsRes = await client.discoverTools(cfg.name);
    if (toolsRes.success) {
      for (const tool of toolsRes.data) {
        registerFn(tool);
      }
      logger.info("MCP tools registered", { server: cfg.name, count: toolsRes.data.length });
    } else {
      logger.warn("MCP tool discovery failed", { server: cfg.name, error: toolsRes.error.message });
    }
  }
}
