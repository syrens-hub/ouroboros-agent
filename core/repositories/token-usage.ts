/**
 * Token Usage Repository
 * ======================
 * Tracks estimated token consumption per session.
 */

import { getDb } from "../db-manager.ts";
import { safeFailOpen } from "../safe-utils.ts";
import { lastId, rowAs, rowCount, rowsAs } from "../db-utils.ts";

export function insertTokenUsage(sessionId: string, estimatedTokens: number): { success: true; id: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO token_usage (session_id, estimated_tokens) VALUES (?, ?)`
    ).run(sessionId, estimatedTokens);
    return { success: true, id: lastId(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function getSessionTokenUsage(sessionId: string): number {
  return safeFailOpen(() => {
    const db = getDb();
    const row = rowAs<{ total: number }>(db.prepare(
      `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage WHERE session_id = ?`
    ).get(sessionId));
    return row?.total ?? 0;
  }, "getSessionTokenUsage DB error", 0);
}

export function getGlobalTokenUsage(sinceMs?: number): number {
  return safeFailOpen(() => {
    const db = getDb();
    const sql = sinceMs
      ? `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage WHERE created_at >= ?`
      : `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage`;
    const row = sinceMs
      ? rowAs<{ total: number }>(db.prepare(sql).get(sinceMs))
      : rowAs<{ total: number }>(db.prepare(sql).get());
    return row?.total ?? 0;
  }, "getGlobalTokenUsage DB error", 0);
}

export interface TokenUsagePoint {
  time: string; // ISO date
  tokens: number;
}

export function getTokenUsageTimeSeries(
  sessionId?: string,
  granularity: "hour" | "day" = "hour",
  sinceMs?: number
): { success: true; data: TokenUsagePoint[] } | { success: false; error: string } {
  try {
    const db = getDb();
    const isPostgres = false; // appConfig.db.usePostgres not imported here, keep simple
    const timeFormat = granularity === "day" ? "%Y-%m-%d" : "%Y-%m-%dT%H:00:00";
    const groupBy = isPostgres
      ? `TO_CHAR(TO_TIMESTAMP(created_at/1000), '${granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM-DD HH24:00:00"}')`
      : `strftime('${timeFormat}', created_at / 1000, 'unixepoch')`;

    let sql = `SELECT ${groupBy} as time_bucket, SUM(estimated_tokens) as tokens FROM token_usage`;
    const params: (string | number)[] = [];
    const conditions: string[] = [];
    if (sessionId) {
      conditions.push("session_id = ?");
      params.push(sessionId);
    }
    if (sinceMs !== undefined) {
      conditions.push("created_at >= ?");
      params.push(sinceMs);
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += ` GROUP BY time_bucket ORDER BY time_bucket ASC`;

    const rows = rowsAs<{ time_bucket: string; tokens: number }>(db.prepare(sql).all(...params));
    return {
      success: true,
      data: rows.map((r) => ({ time: r.time_bucket, tokens: r.tokens })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function pruneTokenUsage(beforeMs: number): { success: true; deleted: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare("DELETE FROM token_usage WHERE created_at < ?").run(beforeMs);
    return { success: true, deleted: rowCount(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
