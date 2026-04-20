import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  getEvolutionMetricsSnapshot,
  formatPrometheusMetrics,
  recordEvolutionEvent,
  registerEvolutionObservability,
  resetEvolutionMetrics,
} from "../../../skills/evolution-observability/index.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";

describe("Evolution Observability v8.1", () => {
  beforeEach(() => {
    resetDbSingleton();
    resetEvolutionMetrics();
    const db = getDb();
    initApprovalTables(db);
    db.exec("DELETE FROM evolution_approvals;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("records proposed events", () => {
    recordEvolutionEvent("evolution:proposed", { versionId: "v1" });
    const snap = getEvolutionMetricsSnapshot();
    expect(snap.totalProposed).toBe(1);
    expect(snap.totalExecuted).toBe(0);
  });

  it("records executed and failed events", () => {
    recordEvolutionEvent("evolution:executed", { versionId: "v1", status: "started" });
    recordEvolutionEvent("evolution:executed", { versionId: "v1", status: "completed", startedAt: 0, completedAt: 100 });
    recordEvolutionEvent("evolution:failed", { versionId: "v2" });

    const snap = getEvolutionMetricsSnapshot();
    expect(snap.totalExecuted).toBe(1);
    expect(snap.totalFailed).toBe(1);
    expect(snap.activeExecutions).toBe(0);
    expect(snap.avgExecutionTimeMs).toBe(100);
  });

  it("formats Prometheus metrics", () => {
    recordEvolutionEvent("evolution:proposed", { versionId: "v1" });
    recordEvolutionEvent("evolution:executed", { versionId: "v1", status: "completed", startedAt: 0, completedAt: 50 });
    recordEvolutionEvent("evolution:failed", { versionId: "v2" });

    const prom = formatPrometheusMetrics();
    expect(prom).toContain("evolution_total_proposed 1");
    expect(prom).toContain("evolution_total_executed 1");
    expect(prom).toContain("evolution_total_failed 1");
    expect(prom).toContain("evolution_avg_execution_time_ms 50");
  });

  it("registers hooks without error", () => {
    expect(() => registerEvolutionObservability()).not.toThrow();
  });
});
