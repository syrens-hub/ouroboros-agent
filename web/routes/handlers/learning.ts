import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext, learningEngine } from "../shared.ts";

export async function handleLearning(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Learning Engine API
  // ================================================================
  if (path === "/api/learning/patterns" && method === "GET") {
    const patterns = Array.from((learningEngine.patternRecognizer as unknown as { patterns?: Map<string, unknown> }).patterns?.values?.() || []).slice(0, 20);
    json(res, 200, { success: true, data: { patterns } }, ctx);
    return true;
  }
  const learningConfigMatch = path.match(/^\/api\/learning\/config\/([^/]+)$/);
  if (learningConfigMatch && method === "GET") {
    const sessionId = learningConfigMatch[1];
    const config = learningEngine.adaptiveOptimizer.suggestConfig(sessionId);
    json(res, 200, { success: true, data: { config } }, ctx);
    return true;
  }

  return false;
}
