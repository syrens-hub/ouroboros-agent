import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient, initMcpTools } from "../../tools/mcp-client/index.ts";
import { MCPConnectionManager } from "../../skills/mcp/index.ts";

const mockInitialize = vi.fn();
const mockToolsList = vi.fn();
const mockToolsCall = vi.fn();
const mockTransportClose = vi.fn();

const MockClientSession = vi.fn().mockImplementation(() => ({
  initialize: mockInitialize,
  tools: { list: mockToolsList, call: mockToolsCall },
}));

const MockStdioClientTransport = vi.fn().mockImplementation(() => ({
  close: mockTransportClose,
}));

const mockSdk = {
  ClientSession: MockClientSession,
  StdioClientTransport: MockStdioClientTransport,
  StdioServerParameters: vi.fn().mockImplementation((opts) => opts),
};

vi.mock("@modelcontextprotocol/sdk", () => mockSdk);

describe("McpClient (with mocked SDK)", () => {
  let client: McpClient;
  let manager: MCPConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPConnectionManager();
    client = new McpClient(manager);
  });

  it("connects via stdio and discovers tools", async () => {
    mockInitialize.mockResolvedValue(undefined);
    mockToolsList.mockResolvedValue({
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      ],
    });

    const connectRes = await client.connect({
      name: "fs",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    });
    expect(connectRes.success).toBe(true);

    const toolsRes = await client.discoverTools("fs");
    expect(toolsRes.success).toBe(true);
    if (toolsRes.success) {
      expect(toolsRes.data.length).toBe(1);
      expect(toolsRes.data[0].name).toBe("fs_read_file");
    }
  });

  it("strips credentials from error messages", async () => {
    mockInitialize.mockRejectedValue(new Error("Invalid api_key=secret123"));
    const res = await client.connect({ name: "bad", command: "echo" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toContain("api_key=***");
      expect(res.error.message).not.toContain("secret123");
    }
  });

  it("shutdown closes transports", async () => {
    mockInitialize.mockResolvedValue(undefined);
    await client.connect({ name: "fs", command: "echo" });
    await client.shutdown();
    expect(mockTransportClose).toHaveBeenCalled();
  });
});

describe("initMcpTools (no config)", () => {
  it("is a no-op when no MCP_SERVERS configured", async () => {
    const registered: string[] = [];
    await initMcpTools((tool) => registered.push(tool.name));
    expect(registered.length).toBe(0);
  });
});
