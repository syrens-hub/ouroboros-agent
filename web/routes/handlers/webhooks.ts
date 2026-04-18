import { z } from "zod";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import type { WebhookRegistration } from "../../../skills/webhooks/index.ts";
import { json, readJsonBody, ReqContext, webhookManager 
} from "../shared.ts";

export async function handleWebhooks(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Webhook Manager API
  // ================================================================
  if (path === "/api/webhooks" && method === "GET") {
    json(res, 200, { success: true, data: webhookManager.list() }, ctx);
    return true;
  }
  if (path === "/api/webhooks" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ path: z.string(), secret: z.string(), eventType: z.string(), targetSessionId: z.string().optional(), enabled: z.boolean().default(true) }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const webhook: WebhookRegistration = { id: randomUUID(), ...parsed.data, enabled: parsed.data.enabled ?? true };
      const id = webhookManager.register(webhook);
      json(res, 200, { success: true, data: { id } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const webhookDeleteMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
  if (webhookDeleteMatch && method === "DELETE") {
    const id = webhookDeleteMatch[1];
    webhookManager.unregister(id);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  return false;
}
