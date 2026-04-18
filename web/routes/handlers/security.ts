import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext, securityFramework } from "../shared.ts";

export async function handleSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Security Audit API
  // ================================================================
  if (path === "/api/security/audits" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const audits = securityFramework.securityAuditor.getRecentAudits(sessionId, Number.isFinite(limit) && limit > 0 ? limit : 50);
      json(res, 200, { success: true, data: audits }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
