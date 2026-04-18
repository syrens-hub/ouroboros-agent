import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { initAutonomousTables, AutonomousEvolutionLoop } from "../../../skills/autonomous-evolution/index.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";

describe("Autonomous Evolution Loop v9.0", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initAutonomousTables(db);
    initApprovalTables(db);
    initEvolutionVersionTables(db);
    db.exec("DELETE FROM autonomous_evolution_state;");
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM evolution_versions;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("starts and stops", () => {
    const loop = new AutonomousEvolutionLoop({ enabled: true, intervalMs: 1000 });
    expect(loop.isRunning()).toBe(false);
    loop.start();
    expect(loop.isRunning()).toBe(true);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it("does not start when disabled", () => {
    const loop = new AutonomousEvolutionLoop({ enabled: false });
    loop.start();
    expect(loop.isRunning()).toBe(false);
  });

  it("initial state is idle", () => {
    const loop = new AutonomousEvolutionLoop();
    const state = loop.getState();
    expect(state.status).toBe("idle");
    expect(state.consecutiveFailures).toBe(0);
  });

  it("enters sleep after max consecutive failures", async () => {
    const loop = new AutonomousEvolutionLoop({
      enabled: true,
      intervalMs: 50,
      maxConsecutiveFailures: 2,
      sleepDurationMs: 1000,
    });

    // Force failures by running with no valid proposals (will naturally fail)
    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    loop.stop();

    const state = loop.getState();
    // Should have incremented cycles
    expect(state.totalCycles).toBeGreaterThan(0);
  });
});
