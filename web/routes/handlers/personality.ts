import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { createPersonalityEvolution } from "../../../skills/personality/index.ts";
import { json, readBody, parseBody, ReqContext } from "../shared.ts";

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
    json(res, 200, { success: true, data: { description: pe.generatePersonalityDescription(), traits: (pe as unknown as { traits: Record<string, number> }).traits, values: (pe as unknown as { values: string[] }).values } }, ctx);
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
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ content: z.string(), category: z.enum(["value", "preference", "behavior"]), importance: z.number().min(0).max(1) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const pe = createPersonalityEvolution(sessionId);
    pe.addAnchorMemory(parsed.data);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  return false;
}
