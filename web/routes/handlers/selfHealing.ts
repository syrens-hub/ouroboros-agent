import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { json, readJsonBody, selfHealer, ReqContext 
} from "../shared.ts";

export async function handleSelfHealing(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Self-healing API
  // ================================================================
  if (path === "/api/self-healing/status" && method === "GET") {
    json(res, 200, { success: true, data: { active: true, snapshots: selfHealer.getSnapshots().length } }, ctx);
    return true;
  }
  if (path === "/api/self-healing/snapshots" && method === "GET") {
    json(res, 200, { success: true, data: selfHealer.getSnapshots() }, ctx);
    return true;
  }
  if (path === "/api/self-healing/rollback" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ rollbackPointId: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const result = await selfHealer.performRollback(parsed.data.rollbackPointId);
    json(res, result.success ? 200 : 500, { success: result.success, data: result.snapshot, error: result.error ? { message: result.error } : undefined }, ctx);
    return true;
  }

  return false;
}
