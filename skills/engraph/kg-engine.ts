/**
 * Knowledge Graph Engine v1.1
 * =============================
 * Agent-facing graph database built on SQLite.
 *
 * Schema:
 *   - kg_nodes: entities, concepts, events, documents
 *   - kg_edges: typed, weighted relationships between nodes
 *
 * Operations:
 *   addNode, addEdge, getNode, getEdge
 *   queryNeighbors (BFS traversal)
 *   findPaths (shortest path via BFS)
 *   searchNodes (text + semantic)
 *   mergeNodes (entity disambiguation)
 *   visualizeDOT (Graphviz output)
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
// logger imported when needed via dynamic import to avoid circular deps

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeType = "concept" | "entity" | "event" | "document" | "skill" | "session";
export type RelType = "relates_to" | "causes" | "part_of" | "author_of" | "uses" | "depends_on" | "similar_to" | "instance_of";

export interface KGNode {
  id: string;
  label: string;
  type: NodeType;
  embedding?: number[]; // optional, for semantic search
  source?: string; // originating skill / document
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface KGEdge {
  id: string;
  fromId: string;
  toId: string;
  relType: RelType;
  weight: number;
  source?: string;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export interface NeighborResult {
  node: KGNode;
  edge: KGEdge;
  depth: number;
}

export interface PathResult {
  nodes: KGNode[];
  edges: KGEdge[];
  totalWeight: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function initKGTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      embedding BLOB,
      source TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_kg_nodes_label ON kg_nodes(label);

    CREATE TABLE IF NOT EXISTS kg_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      rel_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      source TEXT,
      created_at INTEGER NOT NULL,
      meta TEXT,
      FOREIGN KEY (from_id) REFERENCES kg_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES kg_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON kg_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_rel ON kg_edges(rel_type);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_from_to ON kg_edges(from_id, to_id);
  `);
}

function ensureInitialized(): void {
  initKGTables(getDb());
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Node CRUD
// ---------------------------------------------------------------------------

export function addNode(
  label: string,
  type: NodeType,
  opts?: { id?: string; embedding?: number[]; source?: string; meta?: Record<string, unknown> }
): KGNode {
  ensureInitialized();
  const node: KGNode = {
    id: opts?.id ?? genId("node"),
    label,
    type,
    embedding: opts?.embedding,
    source: opts?.source,
    createdAt: now(),
    updatedAt: now(),
    meta: opts?.meta,
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO kg_nodes (id, label, type, embedding, source, created_at, updated_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    node.id,
    node.label,
    node.type,
    node.embedding ? JSON.stringify(node.embedding) : null,
    node.source ?? null,
    node.createdAt,
    node.updatedAt,
    node.meta ? JSON.stringify(node.meta) : null
  );

  return node;
}

export function getNode(id: string): KGNode | undefined {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare("SELECT * FROM kg_nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToNode(row) : undefined;
}

export function updateNode(
  id: string,
  updates: Partial<Pick<KGNode, "label" | "type" | "embedding" | "meta">>
): boolean {
  ensureInitialized();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (updates.label !== undefined) { sets.push("label = ?"); params.push(updates.label); }
  if (updates.type !== undefined) { sets.push("type = ?"); params.push(updates.type); }
  if (updates.embedding !== undefined) { sets.push("embedding = ?"); params.push(JSON.stringify(updates.embedding)); }
  if (updates.meta !== undefined) { sets.push("meta = ?"); params.push(JSON.stringify(updates.meta)); }

  if (sets.length === 1) return false;
  params.push(id);

  const result = db.prepare(`UPDATE kg_nodes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return (result as { changes: number }).changes > 0;
}

export function deleteNode(id: string): boolean {
  ensureInitialized();
  const db = getDb();
  const result = db.prepare("DELETE FROM kg_nodes WHERE id = ?").run(id);
  return (result as { changes: number }).changes > 0;
}

export function searchNodes(query: string, type?: NodeType, limit = 20): KGNode[] {
  ensureInitialized();
  const db = getDb();
  const pattern = `%${query}%`;

  let sql = `SELECT * FROM kg_nodes WHERE label LIKE ?`;
  const params: (string | number)[] = [pattern];

  if (type) {
    sql += ` AND type = ?`;
    params.push(type);
  }

  sql += ` ORDER BY label LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

export function listNodesByType(type: NodeType, limit = 100): KGNode[] {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kg_nodes WHERE type = ? ORDER BY label LIMIT ?").all(type, limit) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

// ---------------------------------------------------------------------------
// Edge CRUD
// ---------------------------------------------------------------------------

export function addEdge(
  fromId: string,
  toId: string,
  relType: RelType,
  opts?: { id?: string; weight?: number; source?: string; meta?: Record<string, unknown> }
): KGEdge {
  ensureInitialized();

  // Verify nodes exist
  if (!getNode(fromId)) throw new Error(`Source node not found: ${fromId}`);
  if (!getNode(toId)) throw new Error(`Target node not found: ${toId}`);

  const edge: KGEdge = {
    id: opts?.id ?? genId("edge"),
    fromId,
    toId,
    relType,
    weight: opts?.weight ?? 1.0,
    source: opts?.source,
    createdAt: now(),
    meta: opts?.meta,
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO kg_edges (id, from_id, to_id, rel_type, weight, source, created_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    edge.id,
    edge.fromId,
    edge.toId,
    edge.relType,
    edge.weight,
    edge.source ?? null,
    edge.createdAt,
    edge.meta ? JSON.stringify(edge.meta) : null
  );

  return edge;
}

export function getEdge(id: string): KGEdge | undefined {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare("SELECT * FROM kg_edges WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToEdge(row) : undefined;
}

export function deleteEdge(id: string): boolean {
  ensureInitialized();
  const db = getDb();
  const result = db.prepare("DELETE FROM kg_edges WHERE id = ?").run(id);
  return (result as { changes: number }).changes > 0;
}

export function findEdges(fromId?: string, toId?: string, relType?: RelType): KGEdge[] {
  ensureInitialized();
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (fromId) { conditions.push("from_id = ?"); params.push(fromId); }
  if (toId) { conditions.push("to_id = ?"); params.push(toId); }
  if (relType) { conditions.push("rel_type = ?"); params.push(relType); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM kg_edges ${where} ORDER BY weight DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

export function queryNeighbors(nodeId: string, depth = 1, relFilter?: RelType): NeighborResult[] {
  ensureInitialized();
  const db = getDb();

  const sql = `
    WITH RECURSIVE
    traverse(node_id, edge_id, depth) AS (
      SELECT :nodeId, NULL, 0

      UNION ALL

      SELECT e.to_id, e.id, t.depth + 1
      FROM traverse t
      JOIN kg_edges e ON e.from_id = t.node_id
      WHERE t.depth < :depth
        ${relFilter ? "AND e.rel_type = :relFilter" : ""}
    )
    SELECT DISTINCT
      n.id, n.label, n.type, n.embedding, n.source, n.created_at, n.updated_at, n.meta,
      e.id as edge_id, e.from_id, e.to_id, e.rel_type, e.weight, e.source as edge_source, e.created_at as edge_created_at, e.meta as edge_meta,
      t.depth
    FROM traverse t
    JOIN kg_nodes n ON n.id = t.node_id
    LEFT JOIN kg_edges e ON e.id = t.edge_id
    WHERE t.depth > 0
    ORDER BY t.depth, e.weight DESC
  `;

  const params: Record<string, string | number> = { nodeId, depth };
  if (relFilter) params.relFilter = relFilter;

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];

  return rows.map((row) => ({
    node: rowToNode(row, "n."),
    edge: rowToEdge(row, "e.", { id: "edge_id", fromId: "from_id", toId: "to_id", relType: "rel_type", weight: "weight", source: "edge_source", createdAt: "edge_created_at", meta: "edge_meta" }),
    depth: Number(row.depth),
  }));
}

export function findPaths(fromId: string, toId: string, maxDepth = 4): PathResult[] {
  ensureInitialized();
  const db = getDb();

  // BFS to find all paths up to maxDepth
  const sql = `
    WITH RECURSIVE
    path(current_id, path_nodes, path_edges, total_weight, depth) AS (
      SELECT :fromId, :fromId, '', 0.0, 0

      UNION ALL

      SELECT e.to_id,
             p.path_nodes || ',' || e.to_id,
             p.path_edges || ',' || e.id,
             p.total_weight + e.weight,
             p.depth + 1
      FROM path p
      JOIN kg_edges e ON e.from_id = p.current_id
      WHERE p.depth < :maxDepth
        AND instr(p.path_nodes, e.to_id) = 0
    )
    SELECT path_nodes, path_edges, total_weight, depth
    FROM path
    WHERE current_id = :toId AND depth > 0
    ORDER BY total_weight DESC
    LIMIT 10
  `;

  const rows = db.prepare(sql).all({ fromId, toId, maxDepth }) as Array<{
    path_nodes: string;
    path_edges: string;
    total_weight: number;
    depth: number;
  }>;

  return rows.map((row) => {
    const nodeIds = row.path_nodes.split(",");
    const edgeIds = row.path_edges.split(",").filter(Boolean);

    const nodes = nodeIds.map((id) => getNode(id)).filter(Boolean) as KGNode[];
    const edges = edgeIds.map((id) => getEdge(id)).filter(Boolean) as KGEdge[];

    return { nodes, edges, totalWeight: row.total_weight };
  });
}

// ---------------------------------------------------------------------------
// Entity disambiguation
// ---------------------------------------------------------------------------

export function mergeNodes(targetId: string, duplicateIds: string[]): { success: boolean; message: string } {
  ensureInitialized();
  const db = getDb();

  const target = getNode(targetId);
  if (!target) return { success: false, message: `Target node ${targetId} not found` };

  try {
    db.prepare("BEGIN TRANSACTION").run();

    for (const dupId of duplicateIds) {
      if (dupId === targetId) continue;

      // Re-point edges from duplicate to target
      db.prepare("UPDATE kg_edges SET from_id = ? WHERE from_id = ?").run(targetId, dupId);
      db.prepare("UPDATE kg_edges SET to_id = ? WHERE to_id = ?").run(targetId, dupId);

      // Delete duplicate node
      db.prepare("DELETE FROM kg_nodes WHERE id = ?").run(dupId);
    }

    // Update target metadata
    updateNode(targetId, {
      meta: { ...target.meta, mergedFrom: duplicateIds, mergedAt: now() },
    });

    db.prepare("COMMIT").run();
    return { success: true, message: `Merged ${duplicateIds.length} nodes into ${targetId}` };
  } catch (e) {
    db.prepare("ROLLBACK").run();
    return { success: false, message: `Merge failed: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Visualization
// ---------------------------------------------------------------------------

export function visualizeDOT(centerNodeId?: string, maxDepth = 2): string {
  ensureInitialized();
  const db = getDb();

  let nodes: KGNode[];
  let edges: KGEdge[];

  if (centerNodeId) {
    // Get subgraph around center
    const neighborIds = new Set<string>([centerNodeId]);
    const neighborResults = queryNeighbors(centerNodeId, maxDepth);
    for (const n of neighborResults) {
      neighborIds.add(n.node.id);
    }

    nodes = Array.from(neighborIds).map((id) => getNode(id)).filter(Boolean) as KGNode[];
    edges = findEdges().filter((e) => neighborIds.has(e.fromId) && neighborIds.has(e.toId));
  } else {
    nodes = (db.prepare("SELECT * FROM kg_nodes LIMIT 200").all() as Record<string, unknown>[]).map(rowToNode);
    edges = (db.prepare("SELECT * FROM kg_edges LIMIT 500").all() as Record<string, unknown>[]).map(rowToEdge);
  }

  const lines: string[] = ["digraph KnowledgeGraph {"];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#f0f0f0"];');

  const typeColors: Record<NodeType, string> = {
    concept: "#e1f5fe",
    entity: "#fff3e0",
    event: "#fce4ec",
    document: "#f3e5f5",
    skill: "#e8f5e9",
    session: "#fffde7",
  };

  for (const node of nodes) {
    const color = typeColors[node.type] || "#f0f0f0";
    const label = `${node.label} (${node.type})`.replace(/"/g, '\\"');
    lines.push(`  "${node.id}" [label="${label}", fillcolor="${color}"];`);
  }

  for (const edge of edges) {
    const label = edge.relType.replace(/"/g, '\\"');
    lines.push(`  "${edge.fromId}" -> "${edge.toId}" [label="${label}", weight=${edge.weight.toFixed(2)}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stats & quality
// ---------------------------------------------------------------------------

export function getGraphStats(): { nodes: number; edges: number; nodeTypes: Record<string, number>; relTypes: Record<string, number> } {
  ensureInitialized();
  const db = getDb();

  const nodeCount = (db.prepare("SELECT COUNT(*) as c FROM kg_nodes").get() as { c: number }).c;
  const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM kg_edges").get() as { c: number }).c;

  const nodeTypes = db.prepare("SELECT type, COUNT(*) as c FROM kg_nodes GROUP BY type").all() as Array<{ type: string; c: number }>;
  const relTypes = db.prepare("SELECT rel_type, COUNT(*) as c FROM kg_edges GROUP BY rel_type").all() as Array<{ rel_type: string; c: number }>;

  return {
    nodes: nodeCount,
    edges: edgeCount,
    nodeTypes: Object.fromEntries(nodeTypes.map((r) => [r.type, r.c])),
    relTypes: Object.fromEntries(relTypes.map((r) => [r.rel_type, r.c])),
  };
}

/** Detect duplicate nodes by label similarity for auto-evolve. */
export function findDuplicateNodes(): Array<{ canonical: KGNode; duplicates: KGNode[] }> {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT label, type, COUNT(*) as c, GROUP_CONCAT(id) as ids
     FROM kg_nodes
     GROUP BY label, type
     HAVING c > 1`
  ).all() as Array<{ label: string; type: string; c: number; ids: string }>;

  return rows.map((row) => {
    const ids = row.ids.split(",");
    const canonical = getNode(ids[0])!;
    const duplicates = ids.slice(1).map((id) => getNode(id)).filter(Boolean) as KGNode[];
    return { canonical, duplicates };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToNode(row: Record<string, unknown>, prefix = ""): KGNode {
  const p = (k: string) => row[`${prefix}${k}`] ?? row[k];
  return {
    id: String(p("id")),
    label: String(p("label")),
    type: String(p("type")) as NodeType,
    embedding: p("embedding") ? JSON.parse(String(p("embedding"))) : undefined,
    source: p("source") ? String(p("source")) : undefined,
    createdAt: Number(p("created_at")),
    updatedAt: Number(p("updated_at")),
    meta: p("meta") ? JSON.parse(String(p("meta"))) : undefined,
  };
}

function rowToEdge(row: Record<string, unknown>, prefix = "", keyMap?: Partial<Record<keyof KGEdge, string>>): KGEdge {
  const p = (k: string) => row[`${prefix}${k}`] ?? row[k];
  // Fallback: try snake_case if camelCase missing (for SELECT * from kg_edges)
  const pf = (camel: string, snake: string) => p(camel) ?? p(snake);
  const km = (k: keyof KGEdge) => {
    if (keyMap?.[k]) return p(keyMap[k]!);
    const snakeMap: Record<string, string> = { id: "id", fromId: "from_id", toId: "to_id", relType: "rel_type", weight: "weight", source: "source", createdAt: "created_at", meta: "meta" };
    return pf(k, snakeMap[k] ?? k);
  };
  return {
    id: String(km("id")),
    fromId: String(km("fromId")),
    toId: String(km("toId")),
    relType: String(km("relType")) as RelType,
    weight: Number(km("weight")),
    source: km("source") ? String(km("source")) : undefined,
    createdAt: Number(km("createdAt")),
    meta: km("meta") ? JSON.parse(String(km("meta"))) : undefined,
  };
}
