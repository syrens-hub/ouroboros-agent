/**
 * API Audit Logging
 * =================
 * Per-request audit trail for security forensics and usage analytics.
 * Writes to the main database (api_audit_log table) for structured querying.
 * Falls back to structured logger on DB write failure.
 *
 * Controlled by securityConfig.auditLogging.enabled.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../../core/db-manager.ts";
import { logger } from "../../../core/logger.ts";
import { safeIgnore, safeFailOpen } from "../../../core/safe-utils.ts";
import type { ReqContext } from "./context.ts";
import { getClientIp } from "./context.ts";

export interface ApiAuditEntry {
  timestamp: number;
  requestId: string;
  clientIp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userAgent?: string;
  tokenPrefix?: string;
  origin?: string;
}

function extractTokenPrefix(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  const m = auth.match(/^bearer\s+([a-zA-Z0-9_.-]{8,})/i);
  return m ? m[1].slice(0, 8) : undefined;
}

export function recordApiAudit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ReqContext,
  path: string,
  durationMs: number
): void {
  safeIgnore(() => {
    const db = getDb();
    const auth = req.headers.authorization;
    db.prepare(
      `INSERT INTO api_audit_log
        (timestamp, request_id, client_ip, method, path, status_code, duration_ms, user_agent, token_prefix, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Date.now(),
      ctx.requestId,
      getClientIp(req),
      req.method || "GET",
      path,
      res.statusCode || 200,
      durationMs,
      req.headers["user-agent"] ?? null,
      extractTokenPrefix(auth) ?? null,
      req.headers.origin ?? null
    );
  }, "recordApiAudit");
}

/**
 * Prune audit logs older than the configured retention period.
 * Returns the number of deleted rows.
 */
export function pruneApiAuditLogs(olderThanMs: number): number {
  return safeFailOpen(() => {
    const db = getDb();
    const cutoff = Date.now() - olderThanMs;
    const result = db.prepare("DELETE FROM api_audit_log WHERE timestamp < ?").run(cutoff);
    const deleted = (result as { changes: number }).changes ?? 0;
    if (deleted > 0) {
      logger.info("Pruned old API audit logs", { deleted, cutoff });
    }
    return deleted;
  }, "pruneApiAuditLogs", 0);
}
