import type { IncomingMessage, ServerResponse } from "http";
import { queryMemoryLayers, searchMemoryLayers } from "../../../core/repositories/memory-layers.ts";
import { json, ReqContext } from "../shared.ts";

export async function handleMemory(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Memory layers query
  if (path === "/api/memory/layers" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const layers = q.searchParams.get("layers")?.split(",").map((s) => s.trim()).filter(Boolean) || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = queryMemoryLayers({ layers, limit: Number.isFinite(limit) && limit > 0 ? limit : 20 });
    json(res, result.success ? 200 : 500, result, ctx);
    return true;
  }

  // Memory layers search
  if (path === "/api/memory/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 10;
    const result = searchMemoryLayers({ query, sessionId, limit: Number.isFinite(limit) && limit > 0 ? limit : 10 });
    json(res, result.success ? 200 : 500, result, ctx);
    return true;
  }

  return false;
}
