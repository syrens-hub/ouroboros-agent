import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  createClaim,
  initMemoryWikiTables,
  addRelation,
  removeRelation,
  getRelatedClaims,
  getClaimGraph,
  propagateConfidence,
  batchPropagate,
  addEvidenceNode,
  getEvidenceNodes,
  getEvidenceTree,
  getEvidenceRoot,
  searchClaims,
} from "../../../skills/memory-wiki/index.ts";
import type { Claim } from "../../../skills/memory-wiki/types.ts";

describe("Memory Wiki Depth", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initMemoryWikiTables(db);
    db.exec("DELETE FROM claims;");
    db.exec("DELETE FROM claim_relations;");
    db.exec("DELETE FROM evidence_nodes;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  function makeClaim(
    overrides?: Partial<Omit<Claim, "id" | "createdAt" | "updatedAt">>
  ): Omit<Claim, "id" | "createdAt" | "updatedAt"> {
    return {
      category: "test",
      content: "Test claim content",
      freshness: "high",
      status: "active",
      confidence: 0.8,
      sources: [],
      contradictions: [],
      ...overrides,
    };
  }

  describe("Claim Graph", () => {
    it("adds and retrieves relations", () => {
      const c1 = createClaim(makeClaim());
      const c2 = createClaim(makeClaim());

      addRelation(c1.id, c2.id, "supports", 0.9);
      const rels = getRelatedClaims(c1.id, { direction: "outgoing" });
      expect(rels).toHaveLength(1);
      expect(rels[0].relationType).toBe("supports");
      expect(rels[0].strength).toBe(0.9);
    });

    it("removes relations", () => {
      const c1 = createClaim(makeClaim());
      const c2 = createClaim(makeClaim());

      addRelation(c1.id, c2.id, "related");
      expect(getRelatedClaims(c1.id)).toHaveLength(1);

      const removed = removeRelation(c1.id, c2.id, "related");
      expect(removed).toBe(true);
      expect(getRelatedClaims(c1.id)).toHaveLength(0);
    });

    it("gets claim graph up to max depth", () => {
      const c1 = createClaim(makeClaim());
      const c2 = createClaim(makeClaim());
      const c3 = createClaim(makeClaim());

      addRelation(c1.id, c2.id, "supports");
      addRelation(c2.id, c3.id, "refines");

      const graph = getClaimGraph(c1.id, 2);
      expect(graph).toHaveLength(3);
      const depths = graph.map((n) => n.depth);
      expect(depths).toContain(0);
      expect(depths).toContain(1);
      expect(depths).toContain(2);
    });

    it("filters relations by type", () => {
      const c1 = createClaim(makeClaim());
      const c2 = createClaim(makeClaim());
      const c3 = createClaim(makeClaim());

      addRelation(c1.id, c2.id, "supports");
      addRelation(c1.id, c3.id, "refutes");

      const supports = getRelatedClaims(c1.id, { direction: "outgoing", relationType: "supports" });
      expect(supports).toHaveLength(1);
      expect(supports[0].toClaimId).toBe(c2.id);
    });
  });

  describe("Confidence Engine", () => {
    it("boosts confidence from supporting claims", () => {
      const c1 = createClaim(makeClaim({ confidence: 0.5 }));
      const c2 = createClaim(makeClaim({ confidence: 0.9 }));

      addRelation(c1.id, c2.id, "supports", 1.0);
      const result = propagateConfidence(c1.id);

      expect(result).toBeDefined();
      expect(result!.newConfidence).toBeGreaterThan(result!.oldConfidence);
    });

    it("reduces confidence from refuting claims", () => {
      const c1 = createClaim(makeClaim({ confidence: 0.9 }));
      const c2 = createClaim(makeClaim({ confidence: 0.8 }));

      addRelation(c1.id, c2.id, "refutes", 1.0);
      const result = propagateConfidence(c1.id);

      expect(result).toBeDefined();
      expect(result!.newConfidence).toBeLessThan(result!.oldConfidence);
    });

    it("clamps confidence between 0.05 and 0.99", () => {
      const c1 = createClaim(makeClaim({ confidence: 0.99 }));
      const c2 = createClaim(makeClaim({ confidence: 0.99 }));

      addRelation(c1.id, c2.id, "supports", 1.0);
      const result = propagateConfidence(c1.id);
      expect(result!.newConfidence).toBeLessThanOrEqual(0.99);
    });

    it("batch propagates over multiple claims", () => {
      const c1 = createClaim(makeClaim({ confidence: 0.5 }));
      const c2 = createClaim(makeClaim({ confidence: 0.9 }));
      const c3 = createClaim(makeClaim({ confidence: 0.6 }));

      addRelation(c1.id, c2.id, "supports");
      addRelation(c1.id, c3.id, "refutes");

      const results = batchPropagate([c1.id, c2.id, c3.id]);
      expect(results).toHaveLength(3);
    });

    it("returns undefined for missing claim", () => {
      expect(propagateConfidence("nonexistent")).toBeUndefined();
    });
  });

  describe("Evidence Tree", () => {
    it("adds and retrieves evidence nodes", () => {
      const claim = createClaim(makeClaim());
      const node = addEvidenceNode(claim.id, "file", "core/db.ts", { confidence: 0.95 });

      expect(node.claimId).toBe(claim.id);
      expect(node.sourceType).toBe("file");
      expect(node.confidence).toBe(0.95);

      const nodes = getEvidenceNodes(claim.id);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].sourceRef).toBe("core/db.ts");
    });

    it("builds evidence tree with parent-child", () => {
      const claim = createClaim(makeClaim());
      const root = addEvidenceNode(claim.id, "external", "https://example.com/spec");
      addEvidenceNode(claim.id, "inference", "derived from spec", {
        parentId: root.id,
        confidence: 0.7,
      });

      const tree = getEvidenceTree(claim.id);
      expect(tree).toHaveLength(2); // 2 levels
      expect(tree[0]).toHaveLength(1); // root level
      expect(tree[1]).toHaveLength(1); // child level
      expect(tree[1][0].parentId).toBe(root.id);
    });

    it("finds evidence root from child node", () => {
      const claim = createClaim(makeClaim());
      const root = addEvidenceNode(claim.id, "session", "sess-001");
      const child = addEvidenceNode(claim.id, "inference", "inferred", { parentId: root.id });
      const grandchild = addEvidenceNode(claim.id, "inference", "double inferred", { parentId: child.id });

      const foundRoot = getEvidenceRoot(grandchild.id);
      expect(foundRoot).toBeDefined();
      expect(foundRoot!.id).toBe(root.id);
    });

    it("returns undefined for missing evidence node", () => {
      expect(getEvidenceRoot("nonexistent")).toBeUndefined();
    });
  });

  describe("Search", () => {
    it("searches claims by query", () => {
      createClaim(makeClaim({ content: "SQLite is used for persistence" }));
      createClaim(makeClaim({ content: "PostgreSQL is an alternative" }));
      createClaim(makeClaim({ content: "Redis is used for caching" }));

      const result = searchClaims({ query: "SQLite" });
      expect(result.total).toBe(1);
      expect(result.claims[0].content).toContain("SQLite");
    });

    it("filters by category and status", () => {
      createClaim(makeClaim({ category: "arch", status: "active" }));
      createClaim(makeClaim({ category: "arch", status: "superseded" }));
      createClaim(makeClaim({ category: "design", status: "active" }));

      const archActive = searchClaims({ category: "arch", status: "active" });
      expect(archActive.total).toBe(1);

      const allArch = searchClaims({ category: "arch" });
      expect(allArch.total).toBe(2);
    });

    it("filters by confidence range", () => {
      createClaim(makeClaim({ confidence: 0.95 }));
      createClaim(makeClaim({ confidence: 0.5 }));
      createClaim(makeClaim({ confidence: 0.3 }));

      const high = searchClaims({ minConfidence: 0.8 });
      expect(high.total).toBe(1);

      const mid = searchClaims({ minConfidence: 0.4, maxConfidence: 0.6 });
      expect(mid.total).toBe(1);
    });

    it("supports pagination", () => {
      for (let i = 0; i < 5; i++) {
        createClaim(makeClaim({ content: `claim ${i}` }));
      }

      const page1 = searchClaims({ limit: 2, offset: 0 });
      expect(page1.claims).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = searchClaims({ limit: 2, offset: 2 });
      expect(page2.claims).toHaveLength(2);
    });
  });
});
