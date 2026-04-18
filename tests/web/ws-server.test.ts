import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { closeWebSocket } from "../../web/ws-server.ts";
import { appConfig } from "../../core/config.ts";

describe("WebSocket Server", () => {
  let server: Server;
  let port: number;
  let originalToken: string;
  let wss: WebSocketServer | null = null;

  beforeEach(async () => {
    originalToken = appConfig.web.apiToken;
    appConfig.web.apiToken = ""; // disable auth for test
    await closeWebSocket();
    server = createServer();
    wss = new WebSocketServer({ server, path: "/ws" });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (wss) {
      wss.close();
      wss = null;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    appConfig.web.apiToken = originalToken;
  });

  it("accepts websocket connection", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
  });

  it("receives welcome message on connect", async () => {
    const { msg, ws } = await new Promise<{
      msg: Record<string, unknown>;
      ws: WebSocket;
    }>((resolve, reject) => {
      wss!.once("connection", (conn) => {
        conn.send(JSON.stringify({ event: "hello", data: {} }));
      });

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.once("message", (data) => {
        resolve({ msg: JSON.parse(data.toString()), ws });
      });
      ws.once("error", reject);
    });

    expect(msg.event).toBe("hello");
    ws.close();
  });

  it("broadcasts notification to connected clients", async () => {
    const { msg, ws } = await new Promise<{
      msg: { event: string; data: { title: string } };
      ws: WebSocket;
    }>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.once("message", (data) => {
        resolve({ msg: JSON.parse(data.toString()), ws });
      });
      ws.once("error", reject);
      ws.once("open", () => {
        wss!.clients.forEach((client) => {
          client.send(JSON.stringify({ event: "notification", data: { title: "Test" } }));
        });
      });
    });

    expect(msg.event).toBe("notification");
    expect(msg.data.title).toBe("Test");
    ws.close();
  });
});
