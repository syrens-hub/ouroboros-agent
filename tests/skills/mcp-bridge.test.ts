import { describe, it, expect, afterEach } from "vitest";
import { MCPClient, disconnectAllMCPClients } from "../../skills/mcp-bridge/index.ts";

describe("MCP Bridge", () => {
  afterEach(() => {
    disconnectAllMCPClients();
  });

  it("connects to a mock MCP server and lists tools", async () => {
    // Use node as a mock MCP server that echoes the expected JSON-RPC responses
    const mockScript = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }));
          } else if (msg.method === 'notifications/initialized') {
            // no response for notification
          } else if (msg.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'mock_tool', description: 'A mock tool' }] } }));
          }
        } catch {}
      });
    `;
    const client = new MCPClient({ name: "mock", command: "node", args: ["-e", mockScript] });
    await client.connect();
    const tools = client.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("mock_tool");
    client.disconnect();
  });

  it("rejects disallowed or dangerous commands", async () => {
    const dangerous = [
      { name: "bad", command: "rm", args: ["-rf", "/"] },
      { name: "bad", command: "/bin/bash", args: ["-c", "echo hi"] },
      { name: "bad", command: "node;rm", args: ["-e", "1"] },
    ];
    for (const cfg of dangerous) {
      const client = new MCPClient(cfg as { name: string; command: string; args?: string[] });
      await expect(client.connect()).rejects.toThrow();
      client.disconnect();
    }
  });

  it("calls a remote MCP tool", async () => {
    const mockScript = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } }));
          } else if (msg.method === 'notifications/initialized') {
            // no response
          } else if (msg.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }));
          } else if (msg.method === 'tools/call') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'hello from mcp' }] } }));
          }
        } catch {}
      });
    `;
    const client = new MCPClient({ name: "mock", command: "node", args: ["-e", mockScript] });
    await client.connect();
    const result = await client.callTool("echo", { text: "hi" });
    expect(result).toBe("hello from mcp");
    client.disconnect();
  });
});
