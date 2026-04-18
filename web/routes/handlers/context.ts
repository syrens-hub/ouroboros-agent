import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { json, readJsonBody, contextManager, ReqContext 
} from "../shared.ts";

export async function handleContext(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Context Management API
  // ================================================================
  if (path === "/api/context/stats" && method === "GET") {
    json(res, 200, { success: true, data: { injector: contextManager.getInjector().getAllInjections() } }, ctx);
    return true;
  }
  if (path === "/api/context/injections" && method === "GET") {
    json(res, 200, { success: true, data: contextManager.getInjector().getAllInjections() }, ctx);
    return true;
  }
  if (path === "/api/context/injections" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({
      id: z.string(),
      content: z.string(),
      tokenCount: z.number(),
      priority: z.number(),
      enabled: z.boolean(),
      point: z.enum(["system", "pre_user", "pre_assistant", "dynamic"]),
      maxFrequency: z.number().optional(),
    }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    contextManager.getInjector().addInjection(parsed.data);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  return false;
}
