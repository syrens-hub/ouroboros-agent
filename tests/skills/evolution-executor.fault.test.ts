import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../core/db-manager.ts";
import { eventBus } from "../../core/event-bus.ts";
import {
  ExecutionDaemon,
  initExecutionTables,
} from "../../skills/evolution-executor/index.ts";
import { executeEvolution } from "../../skills/evolution-orchestrator/index.ts";
import { initEvolutionVersionTables } from "../../skills/evolution-version-manager/index.ts";
import { initApprovalTables } from "../../skills/approval/index.ts";
import { initTestRunTables } from "../../skills/incremental-test/index.ts";
import { changeFreezePeriod } from "../../skills/safety-controls/index.ts";

vi.mock("../../skills/evolution-orchestrator/index.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../skills/evolution-orchestrator/index.ts")>();
  return {
    ...mod,
    executeEvolution: vi.fn(),
  };
});

describe("Evolution Executor Fault Injection", () => {
  const mockedExecuteEvolution = vi.mocked(executeEvolution);

  beforeEach(() => {
    vi.restoreAllMocks();
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
    mockedExecuteEvolution.mockResolvedValue({
      success: true,
      stage: "test",
      testRunId: "run-default",
      message: "ok",
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbSingleton();
  });

  it("handles executeEvolution failure and records failed status", async () => {
    mockedExecuteEvolution.mockResolvedValueOnce({
      success: false,
      stage: "test",
      message: "Tests crashed",
    });

    const { evolutionVersionManager } = await import(
      "../../skills/evolution-version-manager/index.ts"
    );
    const v = evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Test failure",
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50, maxConcurrent: 1 });
    daemon.start();
    await new Promise((r) => setTimeout(r, 200));
    daemon.stop();

    const execs = daemon.listExecutions();
    expect(execs.length).toBe(1);
    expect(execs[0].versionId).toBe(v.id);
    expect(execs[0].status).toBe("failed");
    expect(execs[0].error).toBe("Tests crashed");
  });

  it("handles DB SQLITE_BUSY without crashing and decrements activeExecutions", async () => {
    const { evolutionVersionManager } = await import(
      "../../skills/evolution-version-manager/index.ts"
    );
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "DB error test",
    });

    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.includes("INSERT INTO evolution_executions")
      ) {
        return {
          run: () => {
            throw new Error("SQLITE_BUSY");
          },
          get: () => undefined,
          all: () => [],
        } as any;
      }
      return originalPrepare(sql);
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50, maxConcurrent: 1 });
    (daemon as any).running = true;

    const tickPromise = (daemon as any).tick();
    await expect(tickPromise).rejects.toThrow("SQLITE_BUSY");

    expect((daemon as any).activeExecutions).toBe(0);
  });

  it("respects maxConcurrent limit with multiple pending versions", async () => {
    vi.useFakeTimers();

    let resolveExecution: ((value: any) => void) | undefined;
    mockedExecuteEvolution.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve;
        }),
    );

    const { evolutionVersionManager } = await import(
      "../../skills/evolution-version-manager/index.ts"
    );
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/a/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/b/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Second",
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 1000, maxConcurrent: 1 });
    daemon.start();

    // The immediate tick should have started one execution
    let running = daemon.listExecutions("running");
    expect(running.length).toBe(1);
    expect((daemon as any).activeExecutions).toBe(1);

    // Trigger the interval tick — it should skip due to maxConcurrent
    await vi.advanceTimersByTimeAsync(1000);

    running = daemon.listExecutions("running");
    expect(running.length).toBe(1);
    expect((daemon as any).activeExecutions).toBe(1);

    // Complete the pending execution
    resolveExecution!({ success: true, stage: "test", testRunId: "run-1" });
    await vi.advanceTimersByTimeAsync(0);

    const completed = daemon.listExecutions("completed");
    expect(completed.length).toBe(1);
    expect((daemon as any).activeExecutions).toBe(0);

    // Let the interval fire again so the second version can run and complete
    await vi.advanceTimersByTimeAsync(1000);
    resolveExecution!({ success: true, stage: "test", testRunId: "run-2" });
    await vi.advanceTimersByTimeAsync(0);

    const all = daemon.listExecutions();
    expect(all.length).toBe(2);
    expect(all.filter((e) => e.status === "completed").length).toBe(2);

    daemon.stop();
  });

  it("cleans up activeExecutions when eventBus.emitAsync throws", async () => {
    const { evolutionVersionManager } = await import(
      "../../skills/evolution-version-manager/index.ts"
    );
    evolutionVersionManager.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Event bus error test",
    });

    vi.spyOn(eventBus, "emitAsync").mockImplementation(() => {
      throw new Error("Event bus exploded");
    });

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50, maxConcurrent: 1 });
    (daemon as any).running = true;

    const tickPromise = (daemon as any).tick();
    await expect(tickPromise).rejects.toThrow("Event bus exploded");

    expect((daemon as any).activeExecutions).toBe(0);
  });

  it("handles dirty files_changed JSON gracefully via safeJsonParse fallback", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO evolution_versions (id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "evo-dirty-001",
      "0.0.1",
      null,
      "invalid json",
      10,
      "approved",
      "unknown",
      "Dirty data test",
      Date.now(),
      null,
    );

    const daemon = new ExecutionDaemon({ pollIntervalMs: 50, maxConcurrent: 1 });
    daemon.start();
    await new Promise((r) => setTimeout(r, 200));
    daemon.stop();

    const execs = daemon.listExecutions();
    expect(execs.length).toBe(1);
    expect(execs[0].status).toBe("completed");
    expect(mockedExecuteEvolution).toHaveBeenCalledTimes(1);
    expect(mockedExecuteEvolution).toHaveBeenCalledWith(
      "evo-dirty-001",
      [],
      "auto-executor",
    );
  });
});
