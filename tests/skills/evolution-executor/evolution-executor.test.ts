import "../../../skills/evolution-core/init.ts";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { hookRegistry } from "../../../core/hook-system.ts";
import {
  ExecutionDaemon,
  initExecutionTables,
} from "../../../skills/evolution-executor/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";
import { initTestRunTables } from "../../../skills/incremental-test/index.ts";
import { changeFreezePeriod } from "../../../skills/safety-controls/index.ts";

describe("Evolution Execution Daemon", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initExecutionTables(db);
    initEvolutionVersionTables(db);
    initApprovalTables(db);
    initTestRunTables(db);
    db.exec("DELETE FROM evolution_executions;");
    db.exec("DELETE FROM evolution_versions;");
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM test_runs;");
    changeFreezePeriod.reset();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("starts and stops", () => {
    const daemon = new ExecutionDaemon({ pollIntervalMs: 100 });
    expect(daemon.isRunning()).toBe(false);
    daemon.start();
    expect(daemon.isRunning()).toBe(true);
    daemon.stop();
    expect(daemon.isRunning()).toBe(false);
  });

  it("does not start when disabled", () => {
    const daemon = new ExecutionDaemon({ enabled: false });
    daemon.start();
    expect(daemon.isRunning()).toBe(false);
  });

  it("finds and executes an approved version", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    const v = evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Safe update",
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50, maxConcurrent: 1 });
    daemon.start();

    // Wait for execution
    await new Promise((r) => setTimeout(r, 200));
    daemon.stop();

    const execs = daemon.listExecutions();
    expect(execs.length).toBeGreaterThan(0);
    expect(execs[0].versionId).toBe(v.id);
    expect(["completed", "failed"]).toContain(execs[0].status);
  });

  it("skips execution during freeze period", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Safe update",
    });

    changeFreezePeriod.recordEvolution();

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50 });
    daemon.start();
    await new Promise((r) => setTimeout(r, 150));
    daemon.stop();

    const execs = daemon.listExecutions();
    expect(execs.length).toBe(0);
  });

  it("records execution details", async () => {
    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    const v = evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Safe update",
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50 });
    daemon.start();
    await new Promise((r) => setTimeout(r, 200));
    daemon.stop();

    const execs = daemon.listExecutions();
    expect(execs.length).toBe(1);
    const exec = daemon.getExecution(execs[0].id);
    expect(exec).toBeDefined();
    expect(exec!.versionId).toBe(v.id);
    expect(exec!.startedAt).toBeGreaterThan(0);
  });

  it("emits evolution:executed event on completion", async () => {
    const events: unknown[] = [];
    hookRegistry.register("evolution:executed", async (_evt, ctx) => {
      events.push(ctx);
    });

    const { evolutionVersionManager } = await import("../../../skills/evolution-version-manager/index.ts");
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Safe update",
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50 });
    daemon.start();
    await new Promise((r) => setTimeout(r, 300));
    daemon.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
