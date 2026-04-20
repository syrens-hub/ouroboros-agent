/**
 * Tiered Memory System v1.1
 * =========================
 * Three-layer memory architecture inspired by human cognition:
 *
 *   ┌─────────────────────────────────────────┐
 *   │  Working Memory (in-memory Map)          │
 *   │  • Current session context (~10 items)   │
 *   │  • Ephemeral: cleared on session end     │
 *   ├─────────────────────────────────────────┤
 *   │  Short-Term Memory (SQLite: stm_)        │
 *   │  • Recent 7 days (~1000 items)           │
 *   │  • Time-decay + importance scoring       │
 *   ├─────────────────────────────────────────┤
 *   │  Long-Term Memory (kg_nodes + vector)    │
 *   │  • Knowledge graph + vector embeddings   │
 *   │  • Cross-session, manually or auto-      │
 *   │    promoted from STM                     │
 *   └─────────────────────────────────────────┘
 *
 * Integration:
 *   - Uses existing memory_layers table (layer = 'working'|'short_term'|'long_term')
 *   - Uses new kg_nodes for structured long-term knowledge
 *   - Provides unified retrieve() API that queries all three layers
 */

import { logger } from "./logger.ts";
import { getDb } from "./db-manager.ts";
import {
  queryMemoryLayers,
  insertMemoryLayer,
  updateMemoryLayer,
  type MemoryLayerEntry,
} from "./repositories/memory-layers.ts";
import {
  searchNodes,
  addNode,
  addEdge,
  type NodeType,
  type RelType,
} from "../skills/engraph/kg-api.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORKING_MEMORY_MAX = 10;
const SHORT_TERM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SHORT_TERM_DECAY_HOURS = 24;
const IMPORTANCE_THRESHOLD_PROMOTE = 0.7;
const IMPORTANCE_THRESHOLD_RETAIN = 0.3;

// ---------------------------------------------------------------------------
// Working Memory (in-process, session-scoped)
// ---------------------------------------------------------------------------

interface WorkingMemoryItem {
  key: string;
  value: string;
  importance: number; // 0-1
  createdAt: number;
}

const workingMemory = new Map<string, WorkingMemoryItem>();

export function setWorkingMemory(sessionId: string, key: string, value: string, importance = 0.5): void {
  const fullKey = `${sessionId}:${key}`;
  workingMemory.set(fullKey, { key, value, importance: Math.min(1, Math.max(0, importance)), createdAt: Date.now() });

  // Evict oldest/lowest-importance if over capacity
  const sessionKeys = Array.from(workingMemory.keys()).filter((k) => k.startsWith(`${sessionId}:`));
  if (sessionKeys.length > WORKING_MEMORY_MAX) {
    const sorted = sessionKeys
      .map((k) => ({ key: k, item: workingMemory.get(k)! }))
      .sort((a, b) => a.item.importance - b.item.importance || a.item.createdAt - b.item.createdAt);
    const toEvict = sorted.slice(0, sessionKeys.length - WORKING_MEMORY_MAX);
    for (const e of toEvict) {
      workingMemory.delete(e.key);
    }
  }
}

export function getWorkingMemory(sessionId: string, key: string): string | undefined {
  return workingMemory.get(`${sessionId}:${key}`)?.value;
}

export function getAllWorkingMemory(sessionId: string): Array<{ key: string; value: string; importance: number }> {
  return Array.from(workingMemory.entries())
    .filter(([k]) => k.startsWith(`${sessionId}:`))
    .map(([, v]) => ({ key: v.key, value: v.value, importance: v.importance }));
}

export function clearWorkingMemory(sessionId?: string): void {
  if (sessionId) {
    for (const key of workingMemory.keys()) {
      if (key.startsWith(`${sessionId}:`)) workingMemory.delete(key);
    }
  } else {
    workingMemory.clear();
  }
}

// ---------------------------------------------------------------------------
// Short-Term Memory (SQLite)
// ---------------------------------------------------------------------------

export interface STMEntry {
  id: number;
  sessionId: string | null;
  content: string;
  summary: string | null;
  importance: number;
  createdAt: number;
}

export function writeShortTermMemory(
  content: string,
  opts?: { sessionId?: string; summary?: string; importance?: number; sourcePath?: string }
): { success: boolean; id?: number; error?: string } {
  const result = insertMemoryLayer({
    session_id: opts?.sessionId ?? null,
    layer: "short_term",
    source_path: opts?.sourcePath ?? null,
    content,
    summary: opts?.summary ?? null,
    score: opts?.importance ?? 0.5,
  });

  if (result.success) {
    logger.debug("stm:write", { id: result.id, importance: opts?.importance });
  }
  return result;
}

export function queryShortTermMemory(opts: {
  sessionId?: string;
  query?: string;
  minImportance?: number;
  limit?: number;
  sinceMs?: number;
}): { success: boolean; data?: STMEntry[]; error?: string } {
  // Use the repository layer
  const repoResult = queryMemoryLayers({
    sessionId: opts.sessionId,
    layers: ["short_term"],
    limit: opts.limit ?? 50,
    minScore: opts.minImportance,
  });

  if (!repoResult.success) return { success: false, error: repoResult.error };

  let entries = repoResult.data.map(mapMemoryLayerToSTM);

  if (opts.sinceMs) {
    const cutoff = Date.now() - opts.sinceMs;
    entries = entries.filter((e) => e.createdAt >= cutoff);
  }

  if (opts.query) {
    const q = opts.query.toLowerCase();
    entries = entries.filter((e) => e.content.toLowerCase().includes(q) || (e.summary?.toLowerCase().includes(q) ?? false));
  }

  // Apply time-decay scoring
  entries = entries.map((e) => ({
    ...e,
    importance: applyDecay(e.importance, e.createdAt),
  }));

  // Sort by decayed importance
  entries.sort((a, b) => b.importance - a.importance);

  return { success: true, data: entries };
}

export function pruneShortTermMemory(): { pruned: number } {
  const cutoff = Date.now() - SHORT_TERM_TTL_MS;
  const db = getDb();

  // Delete stale entries below retain threshold
  const result = db.prepare(
    `DELETE FROM memory_layers
     WHERE layer = 'short_term'
       AND (score < ? OR updated_at < ?)`
  ).run(IMPORTANCE_THRESHOLD_RETAIN, cutoff);

  const pruned = (result as { changes: number }).changes;
  if (pruned > 0) {
    logger.info("stm:pruned", { count: pruned });
  }
  return { pruned };
}

// ---------------------------------------------------------------------------
// Long-Term Memory (Knowledge Graph + Vector)
// ---------------------------------------------------------------------------

export function promoteToLongTermMemory(stmId: number): { success: boolean; nodeId?: string; error?: string } {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, session_id, content, summary, score, source_path
     FROM memory_layers WHERE id = ? AND layer = 'short_term'`
  ).get(stmId) as MemoryLayerEntry | undefined;

  if (!row) return { success: false, error: "STM entry not found" };

  try {
    const label = row.summary || row.content.slice(0, 100);
    const node = addNode(label, "concept", {
      source: row.source_path ?? "stm-promotion",
      originalStmId: String(row.id),
      sessionId: row.session_id ?? undefined,
    });

    // Mark STM as promoted
    updateMemoryLayer(row.id, { layer: "long_term", summary: `promoted→${node.id}` });

    logger.info("ltm:promoted", { stmId, nodeId: node.id, label });
    return { success: true, nodeId: node.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function addLongTermKnowledge(
  label: string,
  type: NodeType,
  opts?: { relatedTo?: { nodeId: string; relType: RelType }[]; meta?: Record<string, unknown> }
): { success: boolean; nodeId?: string; error?: string } {
  try {
    const node = addNode(label, type, opts?.meta);
    if (opts?.relatedTo) {
      for (const rel of opts.relatedTo) {
        addEdge(node.id, rel.nodeId, rel.relType);
      }
    }
    return { success: true, nodeId: node.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function queryLongTermMemory(query: string, limit = 10): Array<{ node: import("../skills/engraph/kg-api.ts").KGNode; relevance: number }> {
  const nodes = searchNodes(query, undefined, limit);
  // Simple relevance: exact match = 1.0, partial = 0.5
  return nodes.map((n) => ({
    node: n,
    relevance: n.label.toLowerCase() === query.toLowerCase() ? 1.0 : 0.5,
  }));
}

// ---------------------------------------------------------------------------
// Unified Retrieval
// ---------------------------------------------------------------------------

export interface MemoryRecall {
  source: "working" | "short_term" | "long_term";
  content: string;
  importance: number;
  metadata: Record<string, unknown>;
}

export function retrieveMemory(sessionId: string, query: string, limit = 10): { results: MemoryRecall[]; sources: string[] } {
  const results: MemoryRecall[] = [];
  const sources = new Set<string>();

  // 1. Working memory
  const wmItems = getAllWorkingMemory(sessionId);
  for (const item of wmItems) {
    if (item.key.toLowerCase().includes(query.toLowerCase()) || item.value.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        source: "working",
        content: `${item.key}: ${item.value}`,
        importance: item.importance,
        metadata: { key: item.key },
      });
      sources.add("working");
    }
  }

  // 2. Short-term memory
  const stmResult = queryShortTermMemory({ sessionId, query, limit: limit * 2 });
  if (stmResult.success && stmResult.data) {
    for (const entry of stmResult.data.slice(0, limit)) {
      results.push({
        source: "short_term",
        content: entry.summary || entry.content,
        importance: entry.importance,
        metadata: { stmId: entry.id },
      });
      sources.add("short_term");
    }
  }

  // 3. Long-term memory (knowledge graph)
  const ltmResults = queryLongTermMemory(query, limit);
  for (const r of ltmResults) {
    results.push({
      source: "long_term",
      content: r.node.label,
      importance: r.relevance,
      metadata: { nodeId: r.node.id, type: r.node.type },
    });
    sources.add("long_term");
  }

  // Merge and rank by importance
  results.sort((a, b) => b.importance - a.importance);

  return { results: results.slice(0, limit), sources: Array.from(sources) };
}

// ---------------------------------------------------------------------------
// Automatic promotion / decay cycle
// ---------------------------------------------------------------------------

export function runMemoryMaintenance(): {
  promoted: number;
  pruned: number;
  workingCleared: number;
} {
  let promoted = 0;

  // 1. Scan STM for high-importance memories to promote
  const db = getDb();
  const candidates = db.prepare(
    `SELECT id, score, updated_at FROM memory_layers
     WHERE layer = 'short_term'
       AND score >= ?
       AND updated_at < ?`
  ).all(IMPORTANCE_THRESHOLD_PROMOTE, Date.now() - 24 * 60 * 60 * 1000) as Array<{ id: number; score: number; updated_at: number }>;

  for (const c of candidates) {
    const result = promoteToLongTermMemory(c.id);
    if (result.success) promoted++;
  }

  // 2. Prune stale STM
  const { pruned } = pruneShortTermMemory();

  // 3. Clear very old working memory (older than 1 hour)
  let workingCleared = 0;
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, item] of workingMemory.entries()) {
    if (item.createdAt < cutoff) {
      workingMemory.delete(key);
      workingCleared++;
    }
  }

  logger.info("memory:maintenance", { promoted, pruned, workingCleared });
  return { promoted, pruned, workingCleared };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapMemoryLayerToSTM(row: MemoryLayerEntry): STMEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    summary: row.summary,
    importance: row.score,
    createdAt: row.created_at,
  };
}

function applyDecay(importance: number, createdAt: number): number {
  const hoursOld = (Date.now() - createdAt) / (1000 * 60 * 60);
  const decayFactor = Math.exp(-hoursOld / SHORT_TERM_DECAY_HOURS);
  return importance * decayFactor;
}
