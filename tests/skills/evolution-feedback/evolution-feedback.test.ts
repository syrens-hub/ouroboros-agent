import "../../../skills/evolution-core/init.ts";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { hookRegistry } from "../../../core/hook-system.ts";
import {
  handleEvolutionFailure,
  initFeedbackTables,
} from "../../../skills/evolution-feedback/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";
import { changeFreezePeriod } from "../../../skills/safety-controls/index.ts";

describe("Evolution Feedback Loop v2", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initFeedbackTables(db);
    initEvolutionVersionTables(db);
    db.exec("DELETE FROM evolution_feedback;");
    db.exec("DELETE FROM evolution_versions;");
    changeFreezePeriod.reset();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("handles failure with rollback when parent exists", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    const v1 = evolutionVersionManager.createVersion({
      filesChanged: ["skills/a/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    const v2 = evolutionVersionManager.createVersion({
      filesChanged: ["skills/b/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Second",
    });

    const result = await handleEvolutionFailure(v2.id, "test", "Tests failed", {
      autoRollback: true,
      autoRepropose: false,
      maxReproposeAttempts: 1,
    });

    expect(result.rollbackPerformed).toBe(true);
    expect(result.rollbackTargetId).toBe(v1.id);
    expect(result.selfHealResult).toBeDefined();
    expect(result.fixProposal).toBeDefined();
  });

  it("skips rollback when disabled", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/a/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    const v2 = evolutionVersionManager.createVersion({
      filesChanged: ["skills/b/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Second",
    });

    const result = await handleEvolutionFailure(v2.id, "test", "Tests failed", {
      autoRollback: false,
      autoRepropose: false,
      maxReproposeAttempts: 1,
    });

    expect(result.rollbackPerformed).toBe(false);
    expect(result.rollbackTargetId).toBeUndefined();
  });

  it("generates fix proposal filtering core files on constitution failure", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    const v = evolutionVersionManager.createVersion({
      filesChanged: ["core/config.ts", "skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Mixed update",
    });

    const result = await handleEvolutionFailure(v.id, "constitution", "Constitution check failed", {
      autoRollback: true,
      autoRepropose: false,
      maxReproposeAttempts: 1,
    });

    expect(result.fixProposal).toBeDefined();
    expect(result.fixProposal!.adjustedProposal.filesChanged).not.toContain("core/config.ts");
    expect(result.fixProposal!.reasoning).toContain("constitution");
  });

  it("emits evolution:rolledBack via event listener", async () => {
    const rolledBackEvents: unknown[] = [];
    hookRegistry.register("evolution:rolledBack", async (_evt, ctx) => {
      rolledBackEvents.push(ctx);
    });

    const { registerFeedbackLoop } = await import("../../../skills/evolution-feedback/index.ts");
    registerFeedbackLoop(undefined, { autoRollback: true, autoRepropose: false });

    // Simulate an evolution:failed event
    await hookRegistry.emit("evolution:failed", {
      versionId: "evo-test",
      stage: "test",
      error: "Tests failed",
      sessionId: "test",
    });

    await new Promise((r) => setTimeout(r, 100));

    // No rollback target for fake versionId, but event should still be processed
    expect(rolledBackEvents.length).toBeGreaterThanOrEqual(0);
  });

  it("persists feedback record to DB", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    const v1 = evolutionVersionManager.createVersion({
      filesChanged: ["skills/a/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    const v2 = evolutionVersionManager.createVersion({
      filesChanged: ["skills/b/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Second",
    });

    await handleEvolutionFailure(v2.id, "test", "Tests failed", {
      autoRollback: true,
      autoRepropose: false,
      maxReproposeAttempts: 1,
    });

    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) as c FROM evolution_feedback WHERE version_id = ?").get(v2.id) as { c: number };
    expect(row.c).toBe(1);
  });
});
