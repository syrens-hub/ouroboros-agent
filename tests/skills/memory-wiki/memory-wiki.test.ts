import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  createClaim,
  getClaim,
  updateClaim,
  listClaims,
  deleteClaim,
  addContradiction,
  resolveContradiction,
  initMemoryWikiTables,
} from "../../../skills/memory-wiki/index.ts";
import { exportToObsidian } from "../../../skills/memory-wiki/obsidian-exporter.ts";
import type { Claim } from "../../../skills/memory-wiki/types.ts";

describe("Memory Wiki", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initMemoryWikiTables(db);
    db.exec("DELETE FROM claims;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  function makeClaim(overrides?: Partial<Omit<Claim, "id" | "createdAt" | "updatedAt">>): Omit<Claim, "id" | "createdAt" | "updatedAt"> {
    return {
      category: "test",
      content: "Test claim content",
      freshness: "high",
      status: "active",
      confidence: 0.95,
      sources: [{ file: "test.ts", excerpt: "hello" }],
      contradictions: [],
      ...overrides,
    };
  }

  it("creates and retrieves a claim", () => {
    const input = makeClaim();
    const claim = createClaim(input);

    expect(claim.id).toBeDefined();
    expect(claim.category).toBe(input.category);
    expect(claim.content).toBe(input.content);
    expect(claim.freshness).toBe(input.freshness);
    expect(claim.status).toBe(input.status);
    expect(claim.confidence).toBe(input.confidence);
    expect(claim.createdAt).toBeGreaterThan(0);
    expect(claim.updatedAt).toBe(claim.createdAt);
    expect(claim.sources).toEqual(input.sources);
    expect(claim.contradictions).toEqual([]);

    const retrieved = getClaim(claim.id);
    expect(retrieved).toEqual(claim);
  });

  it("returns undefined for missing claim", () => {
    expect(getClaim("nonexistent-id")).toBeUndefined();
  });

  it("updates a claim partially", () => {
    const claim = createClaim(makeClaim());
    const updated = updateClaim(claim.id, { confidence: 0.5, status: "disputed" });

    expect(updated).toBeDefined();
    expect(updated!.confidence).toBe(0.5);
    expect(updated!.status).toBe("disputed");
    expect(updated!.content).toBe(claim.content);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(claim.updatedAt);

    const retrieved = getClaim(claim.id);
    expect(retrieved!.confidence).toBe(0.5);
  });

  it("returns undefined when updating missing claim", () => {
    expect(updateClaim("missing", { content: "x" })).toBeUndefined();
  });

  it("lists claims with optional filters", () => {
    const _c1 = createClaim(makeClaim({ category: "arch", freshness: "high", status: "active" }));
    const _c2 = createClaim(makeClaim({ category: "arch", freshness: "medium", status: "superseded" }));
    const _c3 = createClaim(makeClaim({ category: "design", freshness: "high", status: "active" }));

    expect(listClaims()).toHaveLength(3);
    expect(listClaims({ category: "arch" })).toHaveLength(2);
    expect(listClaims({ status: "active" })).toHaveLength(2);
    expect(listClaims({ freshness: "high" })).toHaveLength(2);
    expect(listClaims({ category: "arch", status: "active" })).toHaveLength(1);
    expect(listClaims({ limit: 2 })).toHaveLength(2);
  });

  it("deletes a claim", () => {
    const claim = createClaim(makeClaim());
    expect(deleteClaim(claim.id)).toBe(true);
    expect(getClaim(claim.id)).toBeUndefined();
    expect(deleteClaim(claim.id)).toBe(false);
  });

  it("adds and resolves contradictions", () => {
    const c1 = createClaim(makeClaim());
    const c2 = createClaim(makeClaim());

    addContradiction(c1.id, c2.id);
    let retrieved = getClaim(c1.id);
    expect(retrieved!.contradictions).toContain(c2.id);

    // idempotent
    addContradiction(c1.id, c2.id);
    retrieved = getClaim(c1.id);
    expect(retrieved!.contradictions).toHaveLength(1);

    resolveContradiction(c1.id, c2.id);
    retrieved = getClaim(c1.id);
    expect(retrieved!.contradictions).not.toContain(c2.id);
    expect(retrieved!.contradictions).toHaveLength(0);

    // no-op on missing claim
    resolveContradiction("missing", c2.id);
    addContradiction("missing", c2.id);
  });

  describe("Obsidian Exporter", () => {
    let outDir: string;

    beforeEach(() => {
      outDir = join(tmpdir(), `memory-wiki-export-${Date.now()}`);
    });

    afterEach(() => {
      if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    });

    it("exports claims to markdown with YAML frontmatter", () => {
      const claims: Claim[] = [
        {
          id: "claim-001",
          category: "architecture",
          content: "The system uses SQLite for local persistence.",
          freshness: "high",
          status: "active",
          confidence: 0.92,
          createdAt: 1700000000000,
          updatedAt: 1700000100000,
          sources: [{ file: "core/db-manager.ts", excerpt: "better-sqlite3" }],
          contradictions: [],
        },
        {
          id: "claim-002",
          category: "architecture",
          content: "PostgreSQL is supported as an alternative backend.",
          freshness: "medium",
          status: "active",
          confidence: 0.85,
          createdAt: 1700001000000,
          updatedAt: 1700001000000,
          sources: [{ sessionId: "sess-abc", excerpt: "migration" }],
          contradictions: ["claim-001"],
        },
      ];

      exportToObsidian(claims, outDir);

      expect(existsSync(join(outDir, "claim-001.md"))).toBe(true);
      expect(existsSync(join(outDir, "claim-002.md"))).toBe(true);
      expect(existsSync(join(outDir, "MOC.md"))).toBe(true);

      const md1 = readFileSync(join(outDir, "claim-001.md"), "utf-8");
      expect(md1).toContain("id: claim-001");
      expect(md1).toContain("category: architecture");
      expect(md1).toContain("freshness: high");
      expect(md1).toContain("status: active");
      expect(md1).toContain("confidence: 0.92");
      expect(md1).toContain("The system uses SQLite for local persistence.");
      expect(md1).toContain("core/db-manager.ts");

      const md2 = readFileSync(join(outDir, "claim-002.md"), "utf-8");
      expect(md2).toContain("- [[claim-001]]");

      const moc = readFileSync(join(outDir, "MOC.md"), "utf-8");
      expect(moc).toContain("# Map of Content — Memory Wiki");
      expect(moc).toContain("| [[claim-001]] |");
      expect(moc).toContain("| [[claim-002]] |");
    });

    it("handles empty claims list", () => {
      exportToObsidian([], outDir);
      expect(existsSync(join(outDir, "MOC.md"))).toBe(true);
      const moc = readFileSync(join(outDir, "MOC.md"), "utf-8");
      expect(moc).toContain("0 claim(s)");
    });
  });
});
