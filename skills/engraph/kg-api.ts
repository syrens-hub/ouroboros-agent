/**
 * Knowledge Graph Skill API
 * =========================
 * Agent-facing interface for the knowledge graph engine.
 * Designed to be called by the Agent itself via skills or hooks.
 *
 * Examples:
 *   kg:addNode("Machine Learning", "concept", { source: "user-query" })
 *   kg:addEdge("ML", "Deep Learning", "part_of")
 *   kg:queryNeighbors("ML", 2)
 *   kg:findPaths("AI", "Neural Network")
 */

import { logger } from "../../core/logger.ts";
import {
  addNode as _addNode,
  addEdge as _addEdge,
  getNode as _getNode,
  getEdge as _getEdge,
  deleteNode as _deleteNode,
  deleteEdge as _deleteEdge,
  searchNodes as _searchNodes,
  listNodesByType as _listNodesByType,
  queryNeighbors as _queryNeighbors,
  findPaths as _findPaths,
  mergeNodes as _mergeNodes,
  visualizeDOT as _visualizeDOT,
  getGraphStats as _getGraphStats,
  findDuplicateNodes as _findDuplicateNodes,
  type KGNode,
  type KGEdge,
  type NodeType,
  type RelType,
  type NeighborResult,
  type PathResult,
} from "./kg-engine.ts";

export { type KGNode, type KGEdge, type NodeType, type RelType, type NeighborResult, type PathResult };

// ---------------------------------------------------------------------------
// Skill API wrappers with logging
// ---------------------------------------------------------------------------

export function addNode(label: string, type: NodeType, meta?: Record<string, unknown>): KGNode {
  const node = _addNode(label, type, { meta });
  logger.debug("kg:addNode", { id: node.id, label, type });
  return node;
}

export function addEdge(fromId: string, toId: string, relType: RelType, weight?: number): KGEdge {
  const edge = _addEdge(fromId, toId, relType, { weight });
  logger.debug("kg:addEdge", { id: edge.id, from: fromId, to: toId, rel: relType });
  return edge;
}

export function getNode(id: string): KGNode | undefined {
  return _getNode(id);
}

export function getEdge(id: string): KGEdge | undefined {
  return _getEdge(id);
}

export function removeNode(id: string): boolean {
  const ok = _deleteNode(id);
  logger.debug("kg:removeNode", { id, ok });
  return ok;
}

export function removeEdge(id: string): boolean {
  const ok = _deleteEdge(id);
  logger.debug("kg:removeEdge", { id, ok });
  return ok;
}

export function searchNodes(query: string, type?: NodeType, limit?: number): KGNode[] {
  return _searchNodes(query, type, limit);
}

export function listNodes(type: NodeType, limit?: number): KGNode[] {
  return _listNodesByType(type, limit);
}

export function queryNeighbors(nodeId: string, depth = 1, relFilter?: RelType): NeighborResult[] {
  const results = _queryNeighbors(nodeId, depth, relFilter);
  logger.debug("kg:queryNeighbors", { nodeId, depth, count: results.length });
  return results;
}

export function findPaths(fromId: string, toId: string, maxDepth = 4): PathResult[] {
  const results = _findPaths(fromId, toId, maxDepth);
  logger.debug("kg:findPaths", { from: fromId, to: toId, pathsFound: results.length });
  return results;
}

export function mergeNodes(targetId: string, duplicateIds: string[]): { success: boolean; message: string } {
  return _mergeNodes(targetId, duplicateIds);
}

export function visualizeDOT(centerNodeId?: string, maxDepth = 2): string {
  return _visualizeDOT(centerNodeId, maxDepth);
}

export function getGraphStats(): { nodes: number; edges: number; nodeTypes: Record<string, number>; relTypes: Record<string, number> } {
  return _getGraphStats();
}

export function findDuplicateNodes(): Array<{ canonical: KGNode; duplicates: KGNode[] }> {
  return _findDuplicateNodes();
}

// ---------------------------------------------------------------------------
// High-level convenience: extract entities from text and add to graph
// ---------------------------------------------------------------------------

export function addEntity(label: string, type: NodeType, relatedTo?: { nodeId: string; relType: RelType }[], meta?: Record<string, unknown>): KGNode {
  const node = addNode(label, type, meta);
  if (relatedTo) {
    for (const rel of relatedTo) {
      try {
        addEdge(node.id, rel.nodeId, rel.relType);
      } catch (e) {
        logger.warn("kg:addEntity relation failed", { error: String(e), from: node.id, to: rel.nodeId });
      }
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// Auto-evolve integration: graph quality metrics
// ---------------------------------------------------------------------------

export async function getGraphQualityMetrics(): Promise<{
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  duplicateCount: number;
  orphanCount: number;
  density: number;
}> {
  const { getDb } = await import("../../core/db-manager.ts");
  const stats = _getGraphStats();
  const duplicates = _findDuplicateNodes();

  const db = getDb();
  const orphanRow = db.prepare(
    `SELECT COUNT(*) as c FROM kg_nodes n
     WHERE NOT EXISTS (SELECT 1 FROM kg_edges e WHERE e.from_id = n.id OR e.to_id = n.id)`
  ).get() as { c: number };

  const avgDegree = stats.nodes > 0 ? (stats.edges * 2) / stats.nodes : 0;
  const density = stats.nodes > 1 ? stats.edges / (stats.nodes * (stats.nodes - 1)) : 0;

  return {
    nodeCount: stats.nodes,
    edgeCount: stats.edges,
    avgDegree: Math.round(avgDegree * 100) / 100,
    duplicateCount: duplicates.reduce((s, d) => s + d.duplicates.length, 0),
    orphanCount: orphanRow.c,
    density: Math.round(density * 10000) / 10000,
  };
}
