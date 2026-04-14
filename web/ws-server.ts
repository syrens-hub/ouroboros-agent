/**
 * WebSocket Server
 * ================
 * Replaces SSE with WebSocket for real-time chat and notifications.
 */

import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { appConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { notificationBus, type NotificationEvent } from "../core/notification-bus.ts";
import { getRedisPub, getRedisSub } from "../core/redis.ts";
import { safeRun, resolveConfirm, confirmRequestHandlers } from "./runner-pool.ts";
import type { ContentBlock } from "../types/index.ts";

const API_TOKEN = appConfig.web.apiToken || "";

export type WSClient = {
  ws: WebSocket;
  sessionId?: string;
  isGlobal: boolean;
  lastPongAt: number;
};

const clients = new Set<WSClient>();
let wsConnectionsTotal = 0;

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 60_000;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_CONNECTIONS_PER_TOKEN = 5;

const tokenConnections = new Map<string, WSClient[]>();

function verifyToken(url: string): string | null {
  if (!API_TOKEN) return "";
  try {
    const token = new URL(url, "http://localhost").searchParams.get("token");
    return token === API_TOKEN ? token : null;
  } catch {
    return null;
  }
}

const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB
const REDIS_WS_CHANNEL = "ouroboros:ws";

type WSChannelMessage = {
  event: string;
  data: unknown;
  target: { sessionId?: string };
};

function send(client: WSClient, event: string, data: unknown): boolean {
  if (client.ws.readyState === WebSocket.OPEN) {
    if (client.ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      logger.warn("WebSocket backpressure: dropping message", { event, bufferedAmount: client.ws.bufferedAmount });
      return false;
    }
    try {
      client.ws.send(JSON.stringify({ event, data }));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function startHeartbeat() {
  setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      if (now - client.lastPongAt > PONG_TIMEOUT_MS) {
        logger.warn("WebSocket client pong timeout, terminating");
        client.ws.terminate();
        continue;
      }
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.ping();
        } catch {
          client.ws.terminate();
        }
      }
    }
  }, PING_INTERVAL_MS);
}

function broadcastLocal(target: { sessionId?: string }, event: string, data: unknown) {
  for (const client of clients) {
    if (target.sessionId) {
      if (client.sessionId === target.sessionId) {
        send(client, event, data);
      }
    } else {
      if (client.isGlobal) {
        send(client, event, data);
      }
    }
  }
}

function publishToRedis(target: { sessionId?: string }, event: string, data: unknown) {
  const pub = getRedisPub();
  if (pub) {
    pub.publish(REDIS_WS_CHANNEL, JSON.stringify({ event, data, target })).catch((err) => {
      logger.error("Redis pub error", { error: String(err) });
    });
  }
}

export function broadcastNotification(evt: NotificationEvent) {
  broadcastLocal({}, "notification", evt);
  publishToRedis({}, "notification", evt);
}

export function broadcastToSession(sessionId: string, event: string, data: unknown) {
  broadcastLocal({ sessionId }, event, data);
  publishToRedis({ sessionId }, event, data);
}

export function sendToSession(sessionId: string, event: string, data: unknown) {
  broadcastToSession(sessionId, event, data);
}

async function handleChatMessage(client: WSClient, payload: string | ContentBlock[]) {
  if (!client.sessionId) return;
  const sessionId = client.sessionId;

  confirmRequestHandlers.set(sessionId, (toolName, input) => {
    send(client, "confirm_request", { toolName, input, timeoutMs: 60000 });
  });

  try {
    for await (const event of safeRun(sessionId, payload)) {
      if ("role" in event) {
        if (event.role === "assistant") {
          if (Array.isArray(event.content)) {
            for (const block of event.content as { type: string; id?: string; name?: string; input?: unknown }[]) {
              if (block.type === "tool_use") {
                send(client, "tool_start", {
                  toolUseId: block.id,
                  name: block.name,
                  input: block.input,
                });
              }
            }
          }
          let contentStr = "";
          if (typeof event.content === "string") {
            contentStr = event.content;
          } else if (Array.isArray(event.content)) {
            contentStr = event.content
              .filter((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
              .map((b) => (typeof b === "object" && b !== null ? (b as { text?: string }).text : ""))
              .filter((t): t is string => typeof t === "string")
              .join("\n");
          } else {
            contentStr = JSON.stringify(event.content);
          }
          if (contentStr) {
            send(client, "assistant", { content: contentStr });
          }
        }
      } else if ("type" in event) {
        if (event.type === "tool_result") {
          send(client, "tool_result", {
            toolUseId: event.toolUseId,
            content: event.content,
            isError: event.isError,
          });
        } else if (event.type === "progress") {
          send(client, "progress", {
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            step: event.step,
            totalSteps: event.totalSteps,
            message: event.message,
            detail: event.detail,
          });
        }
      }
    }
    send(client, "done", {});
  } catch (e) {
    send(client, "error", { message: String(e) });
  } finally {
    confirmRequestHandlers.delete(sessionId);
  }
}

let wsServer: WebSocketServer | null = null;

export function attachWebSocket(server: HttpServer): WebSocketServer {
  if (wsServer) return wsServer;
  wsServer = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_PAYLOAD_BYTES });

  wsServer.on("connection", (ws, req) => {
    const url = req.url || "";
    const token = verifyToken(url);
    if (token === null) {
      ws.close(1008, "Unauthorized");
      return;
    }

    // Enforce per-token connection limit
    if (token !== "" && MAX_CONNECTIONS_PER_TOKEN > 0) {
      const list = tokenConnections.get(token) || [];
      if (list.length >= MAX_CONNECTIONS_PER_TOKEN) {
        const oldest = list[0];
        if (oldest) {
          logger.warn("WebSocket per-token connection limit reached, terminating oldest client");
          oldest.ws.terminate();
        }
      }
    }

    const client: WSClient = { ws, isGlobal: false, lastPongAt: Date.now() };

    try {
      const q = new URL(url, "http://localhost");
      const sessionId = q.searchParams.get("sessionId");
      if (sessionId) {
        client.sessionId = sessionId;
      } else {
        client.isGlobal = true;
      }
    } catch {
      client.isGlobal = true;
    }

    wsConnectionsTotal++;
    clients.add(client);
    if (token !== "") {
      const list = tokenConnections.get(token) || [];
      list.push(client);
      tokenConnections.set(token, list);
    }

    ws.on("pong", () => {
      client.lastPongAt = Date.now();
    });

    ws.on("close", () => {
      clients.delete(client);
      if (client.sessionId) {
        confirmRequestHandlers.delete(client.sessionId);
      }
      if (token !== "") {
        const list = tokenConnections.get(token) || [];
        const idx = list.indexOf(client);
        if (idx >= 0) {
          list.splice(idx, 1);
          if (list.length === 0) {
            tokenConnections.delete(token);
          } else {
            tokenConnections.set(token, list);
          }
        }
      }
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { error: String(err) });
      clients.delete(client);
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ event: "pong" }));
          return;
        }
        if (msg.type === "chat") {
          if (typeof msg.message === "string") {
            await handleChatMessage(client, msg.message);
          } else if (Array.isArray(msg.content)) {
            await handleChatMessage(client, msg.content);
          }
          return;
        }
        if (msg.type === "confirm" && client.sessionId && typeof msg.allowed === "boolean") {
          resolveConfirm(client.sessionId, msg.allowed);
          return;
        }
      } catch {
        // ignore invalid messages
      }
    });
  });

  startHeartbeat();

  notificationBus.on("notification", (evt: NotificationEvent) => {
    broadcastNotification(evt);
  });

  // Redis Pub/Sub for multi-instance broadcast
  const sub = getRedisSub();
  if (sub) {
    sub.subscribe(REDIS_WS_CHANNEL).catch((err) => {
      logger.error("Redis sub error", { error: String(err) });
    });
    sub.on("message", (_channel, message) => {
      try {
        const parsed = JSON.parse(message) as WSChannelMessage;
        broadcastLocal(parsed.target, parsed.event, parsed.data);
      } catch {
        // ignore invalid messages
      }
    });
  }

  return wsServer;
}

export function getWsClientCount(): number {
  return clients.size;
}

export function getWsConnectionsTotal(): number {
  return wsConnectionsTotal;
}

export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (!wsServer) {
      resolve();
      return;
    }
    for (const client of clients) {
      client.ws.terminate();
    }
    clients.clear();
    wsServer.close(() => {
      wsServer = null;
      resolve();
    });
  });
}
