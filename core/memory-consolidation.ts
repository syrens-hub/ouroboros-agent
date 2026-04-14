/**
 * Memory Consolidation
 * ====================
 * Automated pruning and aggregation for the multi-layer memory system.
 */

import { getDb } from "./db-manager.ts";
import { logger } from "./logger.ts";
import { insertMemoryLayer, deleteMemoryLayersByIds } from "./repositories/memory-layers.ts";

export interface ConsolidationResult {
  prunedLowValue: number;
  consolidatedGroups: number;
  consolidatedEntries: number;
}

/**
 * 1. Prune memories with score < 0.2 and not updated for 90 days.
 * 2. For any (session_id, layer) group with > 20 entries, merge the oldest 10
 *    into a single archive entry.
 */
export function consolidateMemoryLayers(): ConsolidationResult {
  const db = getDb();
  let prunedLowValue = 0;
  let consolidatedGroups = 0;
  let consolidatedEntries = 0;

  // Step 1: Prune low-value stale memories
  try {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const result = db.prepare("DELETE FROM memory_layers WHERE score < ? AND updated_at < ?").run(0.2, cutoff);
    prunedLowValue = (result as { changes: number }).changes;
    if (prunedLowValue > 0) {
      logger.info("Memory consolidation: pruned low-value stale memories", { count: prunedLowValue });
    }
  } catch (e) {
    logger.error("Memory consolidation: prune failed", { error: String(e) });
  }

  // Step 2: Identify overgrown groups
  try {
    const rows = db.prepare(
      `SELECT session_id, layer, COUNT(*) as cnt
       FROM memory_layers
       GROUP BY session_id, layer
       HAVING cnt > 20`
    ).all() as { session_id: string | null; layer: string; cnt: number }[];

    for (const group of rows) {
      const limit = 10;
      const oldest = db.prepare(
        `SELECT id, content, summary, score, source_path
         FROM memory_layers
         WHERE (session_id = ? OR (session_id IS NULL AND ? IS NULL))
           AND layer = ?
         ORDER BY updated_at ASC
         LIMIT ?`
      ).all(group.session_id || null, group.session_id || null, group.layer, limit) as {
        id: number;
        content: string;
        summary: string | null;
        score: number;
        source_path: string | null;
      }[];

      if (oldest.length < 2) continue;

      const combined = oldest
        .map((o) => `[${o.id}] ${o.summary || o.content}`)
        .join("\n---\n");
      const avgScore = oldest.reduce((sum, o) => sum + o.score, 0) / oldest.length;
      const ids = oldest.map((o) => o.id);

      const insertResult = insertMemoryLayer({
        session_id: group.session_id,
        layer: "archive",
        source_path: oldest[0]?.source_path || null,
        content: `Consolidated ${oldest.length} ${group.layer} memories:\n\n${combined}`,
        summary: `Auto-consolidated ${oldest.length} ${group.layer} entries`,
        score: Math.min(avgScore * 1.1, 1.0),
      });

      if (insertResult.success) {
        const delResult = deleteMemoryLayersByIds(ids);
        if (delResult.success) {
          consolidatedGroups++;
          consolidatedEntries += oldest.length;
          logger.info("Memory consolidation: archived overgrown group", {
            sessionId: group.session_id,
            layer: group.layer,
            archivedCount: oldest.length,
          });
        }
      }
    }
  } catch (e) {
    logger.error("Memory consolidation: group consolidation failed", { error: String(e) });
  }

  return { prunedLowValue, consolidatedGroups, consolidatedEntries };
}
