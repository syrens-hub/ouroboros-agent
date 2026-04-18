import type { IncomingMessage, ServerResponse } from "http";
import { createDreamingMemory } from "../../../skills/dreaming/index.ts";
import { json, ReqContext } from "../shared.ts";

export async function handleDreaming(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Dreaming API
  // ================================================================
  const dreamingMatch = path.match(/^\/api\/dreaming\/([^/]+)$/);
  if (dreamingMatch && method === "GET") {
    const sessionId = dreamingMatch[1];
    const dm = createDreamingMemory(sessionId);
    const memories = await dm.getPromotedMemories(50);
    json(res, 200, { success: true, data: memories }, ctx);
    return true;
  }
  const dreamingConsolidateMatch = path.match(/^\/api\/dreaming\/([^/]+)\/consolidate$/);
  if (dreamingConsolidateMatch && method === "POST") {
    const sessionId = dreamingConsolidateMatch[1];
    const dm = createDreamingMemory(sessionId);
    const stats = await dm.runConsolidation();
    json(res, 200, { success: true, data: stats }, ctx);
    return true;
  }

  return false;
}
