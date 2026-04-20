import { getDb } from "../../core/db-manager.ts";
import type { SearchQuery, EngraphSearchResponse, SearchResult } from "./types.ts";
import { searchVectorLane } from "./vector-lane.ts";
import { searchKeywordLane } from "./keyword-lane.ts";
import { searchGraphLane } from "./graph-lane.ts";
import { searchTemporalLane } from "./temporal-lane.ts";
import { searchSemanticLane } from "./semantic-lane.ts";
import { fuseAndRank } from "./fusion-ranker.ts";
import { getCachedSearch, setCachedSearch } from "./query-cache.ts";
import { recordSearchStats } from "./search-analytics.ts";

export * from "./types.ts";
export { searchVectorLane } from "./vector-lane.ts";
export { searchKeywordLane } from "./keyword-lane.ts";
export { searchGraphLane } from "./graph-lane.ts";
export { searchTemporalLane } from "./temporal-lane.ts";
export { searchSemanticLane } from "./semantic-lane.ts";
export { fuseAndRank } from "./fusion-ranker.ts";
export {
  getCachedSearch,
  setCachedSearch,
  clearSearchCache,
  getCacheSize,
} from "./query-cache.ts";
export {
  recordSearchStats,
  getSearchStats,
  getLanePerformanceSummary,
  clearSearchStats,
} from "./search-analytics.ts";

// Knowledge Graph v1.1
export {
  addNode,
  addEdge,
  getNode,
  getEdge,
  removeNode,
  removeEdge,
  searchNodes,
  listNodes,
  queryNeighbors,
  findPaths,
  mergeNodes,
  visualizeDOT,
  getGraphStats,
  findDuplicateNodes,
  addEntity,
  getGraphQualityMetrics,
  type KGNode,
  type KGEdge,
  type NodeType,
  type RelType,
  type NeighborResult,
  type PathResult,
} from "./kg-api.ts";
export { initKGTables } from "./kg-engine.ts";

/**
 * Initialize Engraph-specific SQLite tables.
 */
export function initEngraphTables(db = getDb()): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(content, kb_chunk_id);
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
  `);
}

/**
 * Hybrid Search Orchestrator v2
 * =============================
 * - Skips empty/irrelevant lanes (vector placeholder, temporal without filters)
 * - Checks cache before executing
 * - Records per-lane analytics
 * - Returns enriched response with queryTimeMs and lanesUsed
 */
export async function search(query: SearchQuery): Promise<EngraphSearchResponse> {
  const start = performance.now();
  const cached = getCachedSearch(query.text, query.filters);
  if (cached) {
    return { ...cached, queryTimeMs: 0 }; // cached result is near-instant
  }

  // Determine which lanes to run
  const lanePromises: Array<{ name: string; promise: Promise<SearchResult[]> | SearchResult[] }> = [];

  // Vector: skip if placeholder returns empty (future: check if embeddings available)
  lanePromises.push({ name: "vector", promise: searchVectorLane(query) });

  lanePromises.push({ name: "keyword", promise: searchKeywordLane(query) });
  lanePromises.push({ name: "semantic", promise: searchSemanticLane(query) });

  // Temporal: only if timeRange is specified
  if (query.filters?.timeRange?.from !== undefined || query.filters?.timeRange?.to !== undefined) {
    lanePromises.push({ name: "temporal", promise: searchTemporalLane(query) });
  }

  // Graph: always run, but lightweight
  lanePromises.push({ name: "graph", promise: searchGraphLane(query) });

  // Execute lanes and collect timing
  const laneResults = new Map<string, SearchResult[]>();
  const laneStats: Array<{ lane: string; candidates: number; topScore: number; latencyMs: number }> = [];

  for (const { name, promise } of lanePromises) {
    const laneStart = performance.now();
    try {
      const results = await Promise.resolve(promise);
      const latencyMs = Math.round(performance.now() - laneStart);
      laneResults.set(name, results);
      laneStats.push({
        lane: name,
        candidates: results.length,
        topScore: results[0]?.score ?? 0,
        latencyMs,
      });
    } catch {
      laneResults.set(name, []);
      laneStats.push({ lane: name, candidates: 0, topScore: 0, latencyMs: Math.round(performance.now() - laneStart) });
    }
  }

  const fused = fuseAndRank(laneResults);
  const queryTimeMs = Math.round(performance.now() - start);

  const lanesUsed = Array.from(laneResults.entries())
    .filter(([, results]) => results.length > 0)
    .map(([lane]) => lane);

  const totalCandidates = Array.from(laneResults.values()).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const response: EngraphSearchResponse = {
    results: fused,
    lanesUsed,
    totalCandidates,
    queryTimeMs,
  };

  // Cache and analytics
  setCachedSearch(query.text, response, query.filters);
  recordSearchStats(query.text, queryTimeMs, laneStats, fused.length);

  return response;
}
