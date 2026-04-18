import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  initApprovalTables,
} from "../../../skills/approval/index.ts";
import {
  initEvolutionVersionTables,
} from "../../../skills/evolution-version-manager/index.ts";
import {
  initTestRunTables,
} from "../../../skills/incremental-test/index.ts";
import {
  initEventBusTables,
} from "../../../core/event-bus.ts";
import {
  getMonitoringSnapshot,
  getEventBusStatus,
  getSafetyStatus,
  getApprovalQueueStatus,
  getEvolutionVersionStatus,
  getTestRunStatus,
} from "../../../skills/monitoring-dashboard/index.ts";

describe("Monitoring Dashboard", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEventBusTables(db);
    initApprovalTables(db);
    initEvolutionVersionTables(db);
    initTestRunTables(db);
    db.exec("DELETE FROM dead_letters;");
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM evolution_versions;");
    db.exec("DELETE FROM test_runs;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns event bus status", () => {
    const status = getEventBusStatus();
    expect(typeof status.queueSize).toBe("number");
    expect(typeof status.deadLetterCount).toBe("number");
    expect(typeof status.pendingDeadLetters).toBe("number");
    expect(typeof status.running).toBe("boolean");
  });

  it("returns safety status", () => {
    const status = getSafetyStatus();
    expect(typeof status.lockHeld).toBe("boolean");
    expect(typeof status.frozen).toBe("boolean");
    expect(typeof status.freezeRemainingHours).toBe("number");
    expect(status.budget).toBeDefined();
    expect(typeof status.budget.withinBudget).toBe("boolean");
    expect(typeof status.budget.dailyLimit).toBe("number");
  });

  it("returns approval queue status", () => {
    const status = getApprovalQueueStatus();
    expect(typeof status.pendingCount).toBe("number");
    expect(typeof status.delayedCount).toBe("number");
    expect(typeof status.manualCount).toBe("number");
    expect(typeof status.deniedCount).toBe("number");
    expect(Array.isArray(status.recent)).toBe(true);
  });

  it("returns evolution version status", () => {
    const status = getEvolutionVersionStatus();
    expect(status.currentTag).toBeNull();
    expect(status.totalVersions).toBe(0);
    expect(status.latestDescription).toBeNull();
  });

  it("returns test run status", () => {
    const status = getTestRunStatus();
    expect(typeof status.totalRuns).toBe("number");
    expect(status.lastRun).toBeNull();
    expect(typeof status.recentFailures).toBe("number");
  });

  it("returns full monitoring snapshot", () => {
    const snapshot = getMonitoringSnapshot();
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.eventBus).toBeDefined();
    expect(snapshot.safety).toBeDefined();
    expect(snapshot.approvals).toBeDefined();
    expect(snapshot.evolutionVersions).toBeDefined();
    expect(snapshot.testRuns).toBeDefined();
    expect(snapshot.evolutionMetrics).toBeDefined();
    expect(typeof snapshot.evolutionMetrics.totalEvolutions).toBe("number");
  });
});
