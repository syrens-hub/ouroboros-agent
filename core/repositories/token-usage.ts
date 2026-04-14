/**
 * Token Usage Repository
 * ======================
 * Tracks estimated token consumption per session.
 */

import { getDb } from "../db-manager.ts";

export function insertTokenUsage(sessionId: string, estimatedTokens: number): { success: true; id: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO token_usage (session_id, estimated_tokens) VALUES (?, ?)`
    ).run(sessionId, estimatedTokens);
    return { success: true, id: Number((result as { lastInsertRowid: number | bigint }).lastInsertRowid) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function getSessionTokenUsage(sessionId: string): number {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage WHERE session_id = ?`
    ).get(sessionId) as { total: number };
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

export function getGlobalTokenUsage(sinceMs?: number): number {
  try {
    const db = getDb();
    const sql = sinceMs
      ? `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage WHERE created_at >= ?`
      : `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM token_usage`;
    const row = sinceMs
      ? (db.prepare(sql).get(sinceMs) as { total: number })
      : (db.prepare(sql).get() as { total: number });
    return row?.total ?? 0;
  } catch {
    return 0;
  }
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

    const rows = db.prepare(sql).all(...params) as { time_bucket: string; tokens: number }[];
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
    return { success: true, deleted: (result as { changes: number }).changes };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
