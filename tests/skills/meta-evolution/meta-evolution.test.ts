import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { analyzeMetaEvolution, applyTuning } from "../../../skills/meta-evolution/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";

describe("Meta-Evolution v9.1", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEvolutionVersionTables(db);
    initApprovalTables(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta_evolution_tuning (
        id TEXT PRIMARY KEY,
        parameter TEXT NOT NULL,
        current_value REAL NOT NULL,
        recommended_value REAL,
        confidence REAL,
        reason TEXT,
        applied INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    db.exec("DELETE FROM evolution_versions;");
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM meta_evolution_tuning;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns empty recommendations with no data", () => {
    const recs = analyzeMetaEvolution({ minSamples: 1 });
    expect(recs).toEqual([]);
  });

  it("recommends threshold adjustment based on outcomes", () => {
    const db = getDb();
    // Seed auto-approved evolutions with mixed success to trigger recommendation
    for (let i = 0; i < 15; i++) {
      const file = `a${i}.ts`;
      const success = i < 7; // 7 success, 8 failure -> ~47% success rate
      db.prepare(
        `INSERT INTO evolution_versions (id, version_tag, files_changed, risk_score, approval_status, test_status, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `evo-${i}`, `0.7.${i}`, JSON.stringify([file]), 10, success ? "applied" : "rolled_back", success ? "passed" : "failed", "test", Date.now() - i * 1000
      );
      db.prepare(
        `INSERT INTO evolution_approvals (id, decision, status, risk_score, files_changed, description, reason, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `apv-${i}`, "auto", "approved", 10, JSON.stringify([file]), "test", "auto", Date.now() - i * 1000, Date.now() - i * 1000
      );
    }

    const recs = analyzeMetaEvolution({ minSamples: 10, targetSuccessRate: 0.85 });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].parameter).toBe("autoApproveRiskThreshold");
  });

  it("applies tuning recommendation", () => {
    const result = applyTuning({
      parameter: "testMode",
      currentValue: 0,
      recommendedValue: 1,
      confidence: 0.8,
      reason: "Test",
    });
    expect(result).toBe(true);
  });
});
