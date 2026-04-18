import { getDb } from "../../core/db-manager.ts";
import type { SearchQuery, SearchResult } from "./types.ts";

/**
 * Temporal Lane
 * =============
 * Filters kb_chunks and messages by created_at / timestamp range.
 */
export function searchTemporalLane(query: SearchQuery): SearchResult[] {
  const db = getDb();
  const { from, to } = query.filters?.timeRange ?? {};
  const limit = query.limit ?? 10;

  if (from === undefined && to === undefined) {
    return [];
  }

  const results: SearchResult[] = [];
  const params: (number | string)[] = [];
  const conditions: string[] = [];

  if (from !== undefined) {
    conditions.push("created_at >= ?");
    params.push(from);
  }
  if (to !== undefined) {
    conditions.push("created_at <= ?");
    params.push(to);
  }

  const whereClause = conditions.join(" AND ");

  // Query kb_chunks
  try {
    const kbRows = db
      .prepare(`SELECT id, content, created_at FROM kb_chunks WHERE ${whereClause} LIMIT ?`)
      .all(...params, limit) as Array<{ id: string; content: string; created_at: number }>;

    for (const row of kbRows) {
      results.push({
        id: row.id,
        content: row.content,
        score: 0.5,
        lane: "temporal",
        metadata: { source: "kb_chunks", createdAt: row.created_at },
      });
    }
  } catch {
    // table may not exist yet
  }

  // Query messages (column name is timestamp)
  try {
    const msgConditions: string[] = [];
    const msgParams: (number | string)[] = [];

    if (from !== undefined) {
      msgConditions.push("timestamp >= ?");
      msgParams.push(from);
    }
    if (to !== undefined) {
      msgConditions.push("timestamp <= ?");
      msgParams.push(to);
    }

    const msgWhere = msgConditions.join(" AND ");
    const msgRows = db
      .prepare(`SELECT id, content, timestamp FROM messages WHERE ${msgWhere} LIMIT ?`)
      .all(...msgParams, limit) as Array<{ id: number; content: string; timestamp: number }>;

    for (const row of msgRows) {
      results.push({
        id: String(row.id),
        content: row.content,
        score: 0.5,
        lane: "temporal",
        metadata: { source: "messages", timestamp: row.timestamp },
      });
    }
  } catch {
    // table may not exist yet
  }

  return results;
}
