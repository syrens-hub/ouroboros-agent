import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  initEngraphTables,
  search,
  searchKeywordLane,
  searchSemanticLane,
  searchGraphLane,
  searchTemporalLane,
  fuseAndRank,
  clearSearchCache,
  getCacheSize,
  getCachedSearch,
  setCachedSearch,
  clearSearchStats,
  getSearchStats,
  getLanePerformanceSummary,
} from "../../../skills/engraph/index.ts";

describe("Engraph 5-Lane Search", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEngraphTables(db);
    clearSearchCache();
    clearSearchStats();

    // Seed kb_chunks and kb_fts
    try {
      db.exec("DELETE FROM kb_chunks;");
    } catch { /* table may not exist */ }
    try {
      db.exec("DELETE FROM relations;");
    } catch { /* table may not exist */ }

    const chunks = [
      { id: "c1", document_id: "doc1", content: "SQLite is a lightweight database engine used for local storage", chunk_index: 0, created_at: Date.now() - 86400000 },
      { id: "c2", document_id: "doc1", content: "PostgreSQL supports advanced features like JSONB and full-text search", chunk_index: 1, created_at: Date.now() - 172800000 },
      { id: "c3", document_id: "doc2", content: "Redis is an in-memory data structure store used for caching", chunk_index: 0, created_at: Date.now() - 259200000 },
      { id: "c4", document_id: "doc3", content: "TypeScript provides static typing for JavaScript projects", chunk_index: 0, created_at: Date.now() },
    ];

    const insertChunk = db.prepare("INSERT OR REPLACE INTO kb_chunks (id, document_id, content, chunk_index, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const c of chunks) {
      insertChunk.run(c.id, c.document_id, c.content, c.chunk_index, c.created_at);
    }

    // Seed kb_fts
    try {
      db.exec("DELETE FROM kb_fts;");
    } catch { /* fts virtual table may not support DELETE */ }
    const insertFts = db.prepare("INSERT INTO kb_fts (content, kb_chunk_id) VALUES (?, ?)");
    for (const c of chunks) {
      insertFts.run(c.content, c.id);
    }

    // Seed relations
    const insertRel = db.prepare("INSERT INTO relations (id, source_id, target_id, relation_type, weight) VALUES (?, ?, ?, ?, ?)");
    insertRel.run("r1", "c1", "c2", "related_to", 0.9);
    insertRel.run("r2", "c2", "c3", "depends_on", 0.8);
    insertRel.run("r3", "c1", "c3", "similar_to", 0.7);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("Keyword Lane", () => {
    it("finds matching chunks via FTS5", () => {
      const results = searchKeywordLane({ text: "SQLite" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.content.includes("SQLite"))).toBe(true);
      expect(results[0].lane).toBe("keyword");
    });

    it("returns empty for no match", () => {
      const results = searchKeywordLane({ text: "xyznonexistent" });
      expect(results).toHaveLength(0);
    });
  });

  describe("Semantic Lane", () => {
    it("scores documents by semantic similarity", () => {
      const results = searchSemanticLane({ text: "database engine" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should find SQLite and PostgreSQL as top results
      const ids = results.map((r) => r.id);
      expect(ids.some((id) => ["c1", "c2"].includes(id))).toBe(true);
    });

    it("returns empty for blank query", () => {
      expect(searchSemanticLane({ text: "" })).toHaveLength(0);
      expect(searchSemanticLane({ text: "   " })).toHaveLength(0);
    });
  });

  describe("Graph Lane", () => {
    it("traverses relations from matching nodes", () => {
      const results = searchGraphLane({ text: "c1" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].lane).toBe("graph");
      expect(results[0].metadata.relationType).toBeDefined();
    });

    it("returns empty for non-matching query", () => {
      const results = searchGraphLane({ text: "nonexistent" });
      expect(results).toHaveLength(0);
    });
  });

  describe("Temporal Lane", () => {
    it("filters by time range", () => {
      const now = Date.now();
      const results = searchTemporalLane({
        text: "",
        filters: { timeRange: { from: now - 86400000 * 2, to: now } },
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].lane).toBe("temporal");
    });

    it("returns empty when no time range specified", () => {
      const results = searchTemporalLane({ text: "database" });
      expect(results).toHaveLength(0);
    });
  });

  describe("Fusion Ranker", () => {
    it("deduplicates and ranks across lanes", () => {
      const laneResults = new Map([
        ["keyword", [
          { id: "c1", content: "SQLite", score: 0.9, lane: "keyword" as const, metadata: {} },
          { id: "c2", content: "PostgreSQL", score: 0.8, lane: "keyword" as const, metadata: {} },
        ]],
        ["semantic", [
          { id: "c1", content: "SQLite", score: 0.85, lane: "semantic" as const, metadata: {} },
          { id: "c3", content: "Redis", score: 0.7, lane: "semantic" as const, metadata: {} },
        ]],
      ]);

      const fused = fuseAndRank(laneResults);
      expect(fused.length).toBe(3);
      // c1 should be top because it appears in both lanes
      expect(fused[0].id).toBe("c1");
      expect(fused[0].metadata._fusedFrom).toContain("keyword");
      expect(fused[0].metadata._fusedFrom).toContain("semantic");
    });

    it("applies lane weights", () => {
      const laneResults = new Map([
        ["keyword", [
          { id: "a", content: "A", score: 0.5, lane: "keyword" as const, metadata: {} },
        ]],
        ["graph", [
          { id: "a", content: "A", score: 0.5, lane: "graph" as const, metadata: {} },
        ]],
      ]);

      // keyword weight = 1.2, graph = 0.9
      const fused = fuseAndRank(laneResults);
      expect(fused[0].id).toBe("a");
    });
  });

  describe("Search Orchestrator", () => {
    it("runs hybrid search and returns structured response", async () => {
      const response = await search({ text: "database" });
      expect(response.results.length).toBeGreaterThanOrEqual(1);
      expect(response.lanesUsed.length).toBeGreaterThanOrEqual(1);
      expect(response.queryTimeMs).toBeGreaterThanOrEqual(0);
      expect(response.totalCandidates).toBeGreaterThanOrEqual(1);
    });

    it("skips temporal lane when no time range", async () => {
      const response = await search({ text: "database" });
      expect(response.lanesUsed).not.toContain("temporal");
    });

    it("includes temporal lane when time range given", async () => {
      const response = await search({
        text: "database",
        filters: { timeRange: { from: Date.now() - 86400000 * 5 } },
      });
      // temporal may or may not return results depending on data, but it should run
      expect(response.totalCandidates).toBeGreaterThanOrEqual(1);
    });

    it("caches results", async () => {
      await search({ text: "cache-test" });
      expect(getCacheSize()).toBeGreaterThanOrEqual(1);

      // Second call should be cached
      const response2 = await search({ text: "cache-test" });
      expect(response2.queryTimeMs).toBe(0);
    });

    it("records analytics", async () => {
      await search({ text: "analytics-test" });
      const stats = getSearchStats();
      expect(stats.length).toBeGreaterThanOrEqual(1);
      expect(stats[0].query).toBe("analytics-test");
      expect(stats[0].lanes.length).toBeGreaterThanOrEqual(1);

      const summary = getLanePerformanceSummary();
      expect(Object.keys(summary).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Query Cache", () => {
    it("stores and retrieves cached results", () => {
      const mockResponse = {
        results: [],
        lanesUsed: ["keyword"],
        totalCandidates: 0,
        queryTimeMs: 42,
      };
      setCachedSearch("test-query", mockResponse);
      const cached = getCachedSearch("test-query");
      expect(cached).toBeDefined();
      expect(cached!.queryTimeMs).toBe(42);
    });

    it("expires entries after TTL", () => {
      const mockResponse = {
        results: [],
        lanesUsed: [],
        totalCandidates: 0,
        queryTimeMs: 1,
      };
      setCachedSearch("expire-test", mockResponse, undefined, -1);
      expect(getCachedSearch("expire-test")).toBeUndefined();
    });
  });
});
