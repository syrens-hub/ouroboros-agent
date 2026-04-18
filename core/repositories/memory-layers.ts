/**
 * Memory Layers Repository
 * ========================
 * Unified access to the multi-layer memory system migrated from OpenClaw.
 */

import { getDb } from "../db-manager.ts";
import { lastId, rowCount, rowsAs } from "../db-utils.ts";

export interface MemoryLayerEntry {
  id: number;
  session_id: string | null;
  layer: string;
  source_path: string | null;
  content: string;
  summary: string | null;
  score: number;
  created_at: number;
  updated_at: number;
}

export function queryMemoryLayers(opts: {
  sessionId?: string;
  layers?: string[];
  limit?: number;
  minScore?: number;
}): { success: true; data: MemoryLayerEntry[] } | { success: false; error: string } {
  try {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.sessionId) {
      conditions.push("(session_id = ? OR session_id IS NULL)");
      params.push(opts.sessionId);
    }
    if (opts.layers && opts.layers.length > 0) {
      conditions.push(`layer IN (${opts.layers.map(() => "?").join(", ")})`);
      params.push(...opts.layers);
    }
    if (typeof opts.minScore === "number") {
      conditions.push("score >= ?");
      params.push(opts.minScore);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = typeof opts.limit === "number" && opts.limit > 0 ? `LIMIT ${opts.limit}` : "";

    const sql = `
      SELECT id, session_id, layer, source_path, content, summary, score, created_at, updated_at
      FROM memory_layers
      ${whereClause}
      ORDER BY score DESC, updated_at DESC
      ${limitClause}
    `;

    const rows = rowsAs<MemoryLayerEntry>(db.prepare(sql).all(...params));
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function searchMemoryLayers(opts: {
  query: string;
  sessionId?: string;
  limit?: number;
}): { success: true; data: MemoryLayerEntry[] } | { success: false; error: string } {
  try {
    const db = getDb();
    const sql = `
      SELECT id, session_id, layer, source_path, content, summary, score, created_at, updated_at
      FROM memory_layers
      WHERE (content LIKE ? OR summary LIKE ?)
        AND (session_id = ? OR session_id IS NULL)
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `;
    const rawRows = db
      .prepare(sql)
      .all(`%${opts.query}%`, `%${opts.query}%`, opts.sessionId || "", opts.limit ?? 10);
    const rows = rowsAs<MemoryLayerEntry>(rawRows);
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function insertMemoryLayer(
  entry: Omit<MemoryLayerEntry, "id" | "created_at" | "updated_at">
): { success: true; id: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO memory_layers (session_id, layer, source_path, content, summary, score)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(entry.session_id, entry.layer, entry.source_path, entry.content, entry.summary, entry.score);
    return { success: true, id: lastId(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function updateMemoryLayer(
  id: number,
  entry: Partial<Pick<MemoryLayerEntry, "layer" | "source_path" | "content" | "summary" | "score">>
): { success: true; changes: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (entry.layer !== undefined) {
      sets.push("layer = ?");
      params.push(entry.layer);
    }
    if (entry.source_path !== undefined) {
      sets.push("source_path = ?");
      params.push(entry.source_path);
    }
    if (entry.content !== undefined) {
      sets.push("content = ?");
      params.push(entry.content);
    }
    if (entry.summary !== undefined) {
      sets.push("summary = ?");
      params.push(entry.summary);
    }
    if (entry.score !== undefined) {
      sets.push("score = ?");
      params.push(entry.score);
    }
    if (sets.length === 0) return { success: true, changes: 0 };
    sets.push("updated_at = unixepoch()*1000");
    const sql = `UPDATE memory_layers SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);
    const result = db.prepare(sql).run(...params);
    return { success: true, changes: rowCount(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function deleteMemoryLayer(id: number): { success: true; changes: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare("DELETE FROM memory_layers WHERE id = ?").run(id);
    return { success: true, changes: rowCount(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function deleteMemoryLayersByIds(ids: number[]): { success: true; changes: number } | { success: false; error: string } {
  if (ids.length === 0) return { success: true, changes: 0 };
  try {
    const db = getDb();
    const placeholders = ids.map(() => "?").join(", ");
    const result = db.prepare(`DELETE FROM memory_layers WHERE id IN (${placeholders})`).run(...ids);
    return { success: true, changes: rowCount(result) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
