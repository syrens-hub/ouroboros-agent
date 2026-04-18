import type { IncomingMessage, ServerResponse } from "http";
import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import { createSession, listSessions, getMessages } from "../../../core/session-db.ts";
import { getTraceEvents } from "../../../core/repositories/trajectory.ts";
import { removeRunner, resolveConfirm } from "../../runner-pool.ts";
import {
  json,
  readBody,
  parseBody,
  ConfirmBodySchema,
  ReqContext,
} from "../shared.ts";

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Sessions list
  if (path === "/api/sessions" && method === "GET") {
    json(res, 200, { success: true, data: await listSessions() }, ctx);
    return true;
  }

  // Create session
  if (path === "/api/sessions" && method === "POST") {
    const sessionId = `web_${Date.now()}`;
    await createSession(sessionId, { title: `Web Session ${new Date().toLocaleString("zh-CN")}` });
    json(res, 200, { success: true, data: { sessionId } }, ctx);
    return true;
  }

  // Delete session
  const deleteMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const sessionId = deleteMatch[1];
    removeRunner(sessionId);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  // Traces
  const tracesMatch = path.match(/^\/api\/sessions\/([^/]+)\/traces$/);
  if (tracesMatch && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const turn = q.searchParams.has("turn") ? parseInt(q.searchParams.get("turn")!, 10) : undefined;
    const result = await getTraceEvents(tracesMatch[1], turn);
    json(res, result.success ? 200 : 500, result, ctx);
    return true;
  }

  // Messages
  const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messagesMatch && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : undefined;
    const offset = q.searchParams.has("offset") ? parseInt(q.searchParams.get("offset")!, 10) : undefined;
    const beforeId = q.searchParams.has("beforeId") ? parseInt(q.searchParams.get("beforeId")!, 10) : undefined;
    const result = await getMessages(messagesMatch[1], {
      limit: Number.isFinite(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset! >= 0 ? offset : undefined,
      beforeId: Number.isFinite(beforeId) && beforeId! > 0 ? beforeId : undefined,
    });
    json(res, result.success ? 200 : 500, result, ctx);
    return true;
  }

  // Confirm permission (legacy HTTP fallback; WebSocket also handles confirm)
  const confirmMatch = path.match(/^\/api\/sessions\/([^/]+)\/confirm$/);
  if (confirmMatch && method === "POST") {
    const sessionId = confirmMatch[1];
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, ConfirmBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const ok = resolveConfirm(sessionId, parsed.data.allowed);
    json(res, 200, { success: ok }, ctx);
    return true;
  }

  return false;
}
