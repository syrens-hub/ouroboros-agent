import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext, readBody } from "../shared.ts";
import {
  checkPermissionV2,
  getSystemRules,
  getPolicyRules,
  refreshPolicyRules,
  setSessionRules,
  clearSessionRules,
  getPermissionAudits,
  prunePermissionAudits,
} from "../../../core/permission-engine-v2.ts";
import type { ACLRule } from "../../../core/permission-engine-v2.ts";
import { buildTool } from "../../../core/tool-framework.ts";
import { z } from "zod";
const projectRoot = process.cwd();

const _SessionRuleSchema = z.object({
  pattern: z.string(),
  behavior: z.enum(["allow", "ask", "deny"]),
  condition: z
    .object({
      path: z.string(),
      operator: z.enum(["equals", "contains", "startsWith", "endsWith", "regex", "gt", "lt"]),
      value: z.union([z.string(), z.number()]),
    })
    .optional(),
  reason: z.string().optional(),
});

/** @deprecated Use inline type inference instead */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SessionRuleSchema = z.infer<typeof _SessionRuleSchema>;

export async function handlePermissions(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // GET /api/permissions/system-rules — list system rules
  if (path === "/api/permissions/system-rules" && method === "GET") {
    json(res, 200, { success: true, data: getSystemRules() }, ctx);
    return true;
  }

  // GET /api/permissions/policy-rules — list policy rules
  if (path === "/api/permissions/policy-rules" && method === "GET") {
    json(res, 200, { success: true, data: getPolicyRules() }, ctx);
    return true;
  }

  // POST /api/permissions/policy-rules/refresh — reload from disk
  if (path === "/api/permissions/policy-rules/refresh" && method === "POST") {
    try {
      refreshPolicyRules(projectRoot);
      json(res, 200, { success: true, data: { count: getPolicyRules().length } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/permissions/check — check permission for a tool
  if (path === "/api/permissions/check" && method === "POST") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}") as {
        toolName: string;
        toolInput?: unknown;
        sessionId: string;
        mode?: "interactive" | "autonomous" | "bypass" | "readOnly" | "plan";
        readOnly?: boolean;
      };

      if (!parsed.toolName || !parsed.sessionId) {
        json(res, 400, { success: false, error: { message: "toolName and sessionId are required" } }, ctx);
        return true;
      }

      // Build a dummy tool for the check (we only need name + isReadOnly)
      const dummyTool = buildTool({
        name: parsed.toolName,
        description: "check",
        inputSchema: z.object({}),
        isReadOnly: false,
        async call() {
          return {};
        },
      });

      const result = checkPermissionV2({
        tool: dummyTool,
        toolInput: parsed.toolInput ?? {},
        sessionId: parsed.sessionId,
        projectRoot,
        mode: parsed.mode,
        readOnly: parsed.readOnly,
      });

      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/permissions/session-rules/:sessionId — set session rules
  const sessionRulesMatch = path.match(/^\/api\/permissions\/session-rules\/([^/]+)$/);
  if (sessionRulesMatch && method === "POST") {
    try {
      const sessionId = decodeURIComponent(sessionRulesMatch[1]);
      const body = await readBody(req);
      const raw = JSON.parse(body || "[]") as Array<z.infer<typeof _SessionRuleSchema>>;
      const rules: ACLRule[] = raw.map((r) => ({
        level: 2,
        pattern: r.pattern,
        behavior: r.behavior,
        condition: r.condition,
        reason: r.reason,
      }));
      setSessionRules(sessionId, rules);
      json(res, 200, { success: true, data: { sessionId, count: rules.length } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // DELETE /api/permissions/session-rules/:sessionId — clear session rules
  if (sessionRulesMatch && method === "DELETE") {
    try {
      const sessionId = decodeURIComponent(sessionRulesMatch[1]);
      clearSessionRules(sessionId);
      json(res, 200, { success: true, data: { sessionId, cleared: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/permissions/session-rules/:sessionId — get session rules
  if (sessionRulesMatch && method === "GET") {
    try {
      const sessionId = decodeURIComponent(sessionRulesMatch[1]);
      const { getSessionRules } = await import("../../../core/permission-engine-v2.ts");
      const rules = getSessionRules(sessionId);
      json(res, 200, { success: true, data: { sessionId, rules } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/permissions/audits — permission audit log
  if (path === "/api/permissions/audits" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const toolName = q.searchParams.get("toolName") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const audits = getPermissionAudits({
        sessionId,
        toolName,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
      });
      json(res, 200, { success: true, data: audits }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/permissions/audits/prune — prune old audits
  if (path === "/api/permissions/audits/prune" && method === "POST") {
    const q = new URL(req.url || "", "http://localhost");
    const olderThanDays = q.searchParams.has("days") ? parseInt(q.searchParams.get("days")!, 10) : 30;
    const olderThanMs = (Number.isFinite(olderThanDays) && olderThanDays > 0 ? olderThanDays : 30) * 24 * 60 * 60 * 1000;
    try {
      const deleted = prunePermissionAudits(olderThanMs);
      json(res, 200, { success: true, data: { deleted } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
