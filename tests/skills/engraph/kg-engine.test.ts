import { describe, it, expect, beforeEach } from "vitest";
import {
  initKGTables,
  addNode,
  addEdge,
  getNode,
  getEdge,
  searchNodes,
  queryNeighbors,
  findPaths,
  mergeNodes,
  visualizeDOT,
  getGraphStats,
  findDuplicateNodes,
  deleteNode,
  findEdges,
} from "../../../skills/engraph/kg-engine.ts";
import { getDb } from "../../../core/db-manager.ts";

describe("kg-engine", () => {
  beforeEach(() => {
    const db = getDb();
    initKGTables(db);
    db.prepare("DELETE FROM kg_edges").run();
    db.prepare("DELETE FROM kg_nodes").run();
  });

  it("adds and retrieves a node", () => {
    const node = addNode("Machine Learning", "concept");
    expect(node.id).toMatch(/^node-/);
    expect(node.label).toBe("Machine Learning");
    expect(node.type).toBe("concept");

    const fetched = getNode(node.id);
    expect(fetched).toBeDefined();
    expect(fetched!.label).toBe("Machine Learning");
  });

  it("adds and retrieves an edge", () => {
    const n1 = addNode("AI", "concept");
    const n2 = addNode("ML", "concept");
    const edge = addEdge(n1.id, n2.id, "part_of", { weight: 0.9 });

    expect(edge.fromId).toBe(n1.id);
    expect(edge.toId).toBe(n2.id);
    expect(edge.relType).toBe("part_of");
    expect(edge.weight).toBe(0.9);

    const fetched = getEdge(edge.id);
    expect(fetched).toBeDefined();
  });

  it("throws on edge with missing node", () => {
    expect(() => addEdge("nonexistent", "also-nonexistent", "relates_to")).toThrow();
  });

  it("searches nodes by label", () => {
    addNode("Deep Learning", "concept");
    addNode("Deep Sea", "entity");
    addNode("Shallow Learning", "concept");

    const results = searchNodes("Deep");
    expect(results.length).toBe(2);
  });

  it("queries neighbors with BFS", () => {
    const n1 = addNode("A", "concept");
    const n2 = addNode("B", "concept");
    const n3 = addNode("C", "concept");
    addEdge(n1.id, n2.id, "relates_to");
    addEdge(n2.id, n3.id, "relates_to");

    const neighbors = queryNeighbors(n1.id, 2);
    expect(neighbors.length).toBeGreaterThanOrEqual(1);
    const ids = neighbors.map((n) => n.node.id);
    expect(ids).toContain(n2.id);
  });

  it("finds paths between nodes", () => {
    const n1 = addNode("Start", "concept");
    const n2 = addNode("Middle", "concept");
    const n3 = addNode("End", "concept");
    addEdge(n1.id, n2.id, "causes");
    addEdge(n2.id, n3.id, "causes");

    const paths = findPaths(n1.id, n3.id, 3);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths[0].nodes.map((n) => n.id)).toContain(n3.id);
  });

  it("merges duplicate nodes", () => {
    const n1 = addNode("Same", "concept");
    const n2 = addNode("Same", "concept");
    const n3 = addNode("Other", "concept");
    addEdge(n2.id, n3.id, "relates_to");

    const result = mergeNodes(n1.id, [n2.id]);
    expect(result.success).toBe(true);

    // n2 should be gone, edge should point to n1
    expect(getNode(n2.id)).toBeUndefined();
    const edges = findEdges(n1.id);
    expect(edges.some((e) => e.toId === n3.id)).toBe(true);
  });

  it("generates DOT output", () => {
    const n1 = addNode("X", "concept");
    const n2 = addNode("Y", "entity");
    addEdge(n1.id, n2.id, "relates_to");

    const dot = visualizeDOT();
    expect(dot).toContain("digraph KnowledgeGraph");
    expect(dot).toContain(n1.id);
    expect(dot).toContain(n2.id);
  });

  it("returns graph stats", () => {
    addNode("A", "concept");
    addNode("B", "entity");
    const stats = getGraphStats();
    expect(stats.nodes).toBe(2);
    expect(stats.nodeTypes.concept).toBe(1);
    expect(stats.nodeTypes.entity).toBe(1);
  });

  it("finds duplicate nodes by label", () => {
    addNode("Dup", "concept");
    addNode("Dup", "concept");
    addNode("Unique", "concept");

    const dups = findDuplicateNodes();
    expect(dups.length).toBe(1);
    expect(dups[0].duplicates.length).toBe(1);
  });

  it("deletes a node and cascades edges", () => {
    const n1 = addNode("A", "concept");
    const n2 = addNode("B", "concept");
    const edge = addEdge(n1.id, n2.id, "relates_to");

    deleteNode(n1.id);
    expect(getNode(n1.id)).toBeUndefined();
    // Edge should be gone due to CASCADE
    expect(getEdge(edge.id)).toBeUndefined();
  });
});
