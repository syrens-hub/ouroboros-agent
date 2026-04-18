/**
 * Request Context Utilities
 * =========================
 * Extracted to break circular dependency between shared.ts and metrics.ts.
 */

import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

export type ReqContext = {
  requestId: string;
  startTime: number;
};

export function createReqContext(): ReqContext {
  return { requestId: randomUUID(), startTime: Date.now() };
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
