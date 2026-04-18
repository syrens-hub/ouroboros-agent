/**
 * MCP (Model Context Protocol) Bridge
 * =====================================
 * Lightweight MCP client over stdio using JSON-RPC 2.0.
 * Maps remote MCP tools into Ouroboros Tool interface.
 */

import { spawn, type ChildProcess } from "child_process";
import { basename } from "path";
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import type { MCPServerConfig, MCPTool, Tool, ToolCallContext } from "../../types/index.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

const ALLOWED_MCP_COMMANDS = new Set(["npx", "node", "python3", "python", "uvx"]);

function validateMCPConfig(config: MCPServerConfig): void {
  const base = basename(config.command);
  if (!ALLOWED_MCP_COMMANDS.has(base)) {
    throw new Error(
      `MCP command not allowed: ${base}. Allowed: ${[...ALLOWED_MCP_COMMANDS].join(", ")}`
    );
  }
  // Prevent path traversal and shell injection in the command field.
  // Only simple command names resolved via PATH are allowed.
  if (config.command.includes("/") || config.command.includes("\\") || /[;&|()$`]/.test(config.command)) {
    throw new Error(`Invalid MCP command character in: ${config.command}`);
  }
}

// JSON-RPC helpers
interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPClient {
  private proc: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private tools: MCPTool[] = [];
  private initialized = false;

  constructor(private readonly config: MCPServerConfig) {}

  async connect(): Promise<void> {
    if (this.initialized) return;
    validateMCPConfig(this.config);
    this.proc = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString("utf-8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const msg = safeJsonParse<JSONRPCResponse>(trimmed, "mcp rpc response");
        if (msg && msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      }
    });

    this.proc.on("error", (err) => {
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });

    this.proc.on("close", () => {
      for (const [, p] of this.pending) {
        p.reject(new Error("MCP server process closed"));
      }
      this.pending.clear();
    });

    // Initialize
    const initResult = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ouroboros-agent", version: "0.1.0" },
    })) as { protocolVersion: string };

    if (!initResult?.protocolVersion) {
      throw new Error("MCP initialize failed");
    }

    // Notification: initialized
    this.send({ jsonrpc: "2.0", id: ++this.requestId, method: "notifications/initialized" });

    // List tools
    const toolsResult = (await this.request("tools/list", {})) as { tools?: MCPTool[] };
    this.tools = toolsResult?.tools || [];
    this.initialized = true;
  }

  disconnect(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
    this.initialized = false;
    this.tools = [];
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    if (result?.isError) {
      throw new Error(result.content?.map((c) => c.text).join("\n") || "MCP tool error");
    }
    return result?.content?.map((c) => c.text).join("\n") || "";
  }

  private send(msg: JSONRPCRequest): void {
    if (!this.proc || this.proc.killed) {
      throw new Error("MCP server not running");
    }
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
}

// In-memory cache of connected clients per server config
const mcpClients = new Map<string, MCPClient>();

export async function getMCPClient(config: MCPServerConfig): Promise<MCPClient> {
  const key = `${config.command} ${(config.args || []).join(" ")}`;
  if (!mcpClients.has(key)) {
    const client = new MCPClient(config);
    await client.connect();
    mcpClients.set(key, client);
  }
  return mcpClients.get(key)!;
}

export function disconnectAllMCPClients(): void {
  for (const client of mcpClients.values()) {
    client.disconnect();
  }
  mcpClients.clear();
}

export async function discoverMCPTools(config: MCPServerConfig): Promise<Tool<unknown, unknown, unknown>[]> {
  const client = await getMCPClient(config);
  const remoteTools = client.getTools();
  const localTools: Tool<unknown, unknown, unknown>[] = [];

  for (const rt of remoteTools) {
    const name = `mcp_${config.name}_${rt.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const description = rt.description || `MCP tool ${rt.name} from ${config.name}`;
    const schema = z.object({});

    const tool = buildTool({
      name,
      description,
      inputSchema: schema,
      isReadOnly: false, // MCP tools default to mutable unless annotated otherwise
      isConcurrencySafe: true,
      async call(input: unknown, _ctx: ToolCallContext<unknown>) {
        return client.callTool(rt.name, input);
      },
    });
    localTools.push(tool);
  }

  return localTools;
}

export const mcpBridgeTool = buildTool({
  name: "mcp_bridge",
  description:
    "Connect to an MCP (Model Context Protocol) server and dynamically import its tools into the agent pool. " +
    "Usage: { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'] }",
  inputSchema: z.object({
    name: z.string().describe("Logical name for this MCP server"),
    command: z.string().describe("Executable to run the MCP server"),
    args: z.array(z.string()).optional().describe("Arguments for the executable"),
    env: z.record(z.string()).optional().describe("Extra environment variables"),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ name, command, args, env }) {
    const config: MCPServerConfig = { name, command, args, env };
    const tools = await discoverMCPTools(config);
    return {
      success: true,
      server: name,
      importedTools: tools.map((t) => t.name),
      message: `Imported ${tools.length} tools from MCP server ${name}.`,
    };
  },
});
