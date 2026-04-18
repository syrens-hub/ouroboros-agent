import { getDb } from "../../core/db-manager.ts";
import type { SearchQuery, SearchResult } from "./types.ts";

/**
 * Keyword Lane
 * ============
 * Searches SQLite FTS5 indexes on kb_chunks (via kb_fts) and messages (via messages_fts).
 */
export function searchKeywordLane(query: SearchQuery): SearchResult[] {
  const db = getDb();
  const limit = query.limit ?? 10;
  const results: SearchResult[] = [];

  // Search kb_fts (kb_chunks content)
  try {
    const kbRows = db
      .prepare(
        `SELECT kb_chunk_id AS id, content, rank
         FROM kb_fts
         WHERE kb_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query.text, limit) as Array<{ id: string; content: string; rank: number }>;

    for (const row of kbRows) {
      results.push({
        id: row.id,
        content: row.content,
        score: 1 / (1 + Math.abs(row.rank)),
        lane: "keyword",
        metadata: { source: "kb_chunks" },
      });
    }
  } catch {
    // kb_fts may not exist yet; fail gracefully
  }

  // Search messages_fts (messages content)
  try {
    const msgRows = db
      .prepare(
        `SELECT rowid AS id, content, rank
         FROM messages_fts
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query.text, limit) as Array<{ id: number; content: string; rank: number }>;

    for (const row of msgRows) {
      results.push({
        id: String(row.id),
        content: row.content,
        score: 1 / (1 + Math.abs(row.rank)),
        lane: "keyword",
        metadata: { source: "messages" },
      });
    }
  } catch {
    // messages_fts may not exist yet; fail gracefully
  }

  return results;
}
