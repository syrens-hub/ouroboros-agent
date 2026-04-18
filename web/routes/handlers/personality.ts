import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { createPersonalityEvolution, syncSoulMd } from "../../../skills/personality/index.ts";
import { json, readJsonBody, ReqContext 
} from "../shared.ts";

export async function handlePersonality(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Personality API
  // ================================================================
  const personalityMatch = path.match(/^\/api\/personality\/([^/]+)$/);
  if (personalityMatch && method === "GET") {
    const sessionId = personalityMatch[1];
    const pe = createPersonalityEvolution(sessionId);
    const state = pe.getState();
    json(res, 200, { success: true, data: { description: pe.generatePersonalityDescription(), traits: state.traits, values: state.values } }, ctx);
    return true;
  }
  const personalityAnchorsMatch = path.match(/^\/api\/personality\/([^/]+)\/anchors$/);
  if (personalityAnchorsMatch && method === "GET") {
    const sessionId = personalityAnchorsMatch[1];
    const pe = createPersonalityEvolution(sessionId);
    const query = new URL(req.url || "", "http://localhost").searchParams.get("q") || "";
    json(res, 200, { success: true, data: pe.getRelevantAnchors(query, 20) }, ctx);
    return true;
  }
  if (personalityAnchorsMatch && method === "POST") {
    const sessionId = personalityAnchorsMatch[1];
    const parsed = await readJsonBody(req, z.object({ content: z.string(), category: z.enum(["value", "preference", "behavior"]), importance: z.number().min(0).max(1) }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const pe = createPersonalityEvolution(sessionId);
    pe.addAnchorMemory(parsed.data);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  if (path === "/api/personality/sync-soul" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ sessionId: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      await syncSoulMd(parsed.data.sessionId);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
