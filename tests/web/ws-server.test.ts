import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import { WebSocket } from "ws";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { attachWebSocket, closeWebSocket, broadcastNotification } from "../../web/ws-server.ts";

describe("WebSocket Server", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    attachWebSocket(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await closeWebSocket();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("accepts websocket connection", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
  });

  it("broadcasts notification to connected clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    broadcastNotification({
      type: "system",
      title: "Test",
      message: "Hello WS",
      timestamp: Date.now(),
    });

    const msg = (await msgPromise) as { event: string; data: { title: string } };
    expect(msg.event).toBe("notification");
    expect(msg.data.title).toBe("Test");
    ws.close();
  });
});
