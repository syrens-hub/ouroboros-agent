import { getDb } from "../../core/db-manager.ts";
import type { SearchQuery, SearchResult } from "./types.ts";

/**
 * Graph Lane v2
 * =============
 * 2-hop recursive CTE over relations with degree-weighted scoring
 * and enriched metadata (target nodes, relation types, path depth).
 */
export function searchGraphLane(query: SearchQuery): SearchResult[] {
  const db = getDb();
  const limit = query.limit ?? 10;
  const pattern = `%${query.text}%`;

  // First: compute degree for each node to boost high-connectivity nodes
  const degreeSql = `
    SELECT node, COUNT(*) as degree FROM (
      SELECT source_id AS node FROM relations
      UNION ALL
      SELECT target_id AS node FROM relations
    ) GROUP BY node
  `;

  const sql = `
    WITH RECURSIVE
    degrees(node, degree) AS (
      ${degreeSql}
    ),
    hop1(source_id, target_id, relation_type, weight, depth) AS (
      SELECT r.source_id, r.target_id, r.relation_type, r.weight * COALESCE(d.degree, 1) * 0.01, 1
      FROM relations r
      LEFT JOIN degrees d ON d.node = r.source_id
      WHERE r.source_id LIKE ? OR r.target_id LIKE ? OR r.relation_type LIKE ?

      UNION ALL

      SELECT r.source_id, r.target_id, r.relation_type, hop1.weight * COALESCE(d.degree, 1) * 0.005, hop1.depth + 1
      FROM relations r
      INNER JOIN hop1 ON (r.source_id = hop1.target_id OR r.target_id = hop1.source_id)
      LEFT JOIN degrees d ON d.node = r.source_id
      WHERE hop1.depth < 2
    )
    SELECT source_id AS id, target_id, relation_type, weight, depth
    FROM hop1
    ORDER BY weight DESC
    LIMIT ?
  `;

  try {
    const rows = db.prepare(sql).all(pattern, pattern, pattern, limit) as Array<{
      id: string;
      target_id: string;
      relation_type: string;
      weight: number;
      depth: number;
    }>;

    return rows.map((row) => ({
      id: `${row.id}→${row.target_id}`,
      content: `${row.id} ${row.relation_type} ${row.target_id} (depth ${row.depth})`,
      score: Math.min(1, Math.max(0, row.weight)),
      lane: "graph" as const,
      metadata: {
        sourceId: row.id,
        targetId: row.target_id,
        relationType: row.relation_type,
        depth: row.depth,
      },
    }));
  } catch {
    return [];
  }
}
