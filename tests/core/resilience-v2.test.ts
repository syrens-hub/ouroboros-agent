import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recordHealthSuccess,
  recordHealthFailure,
  recordHealthDegraded,
  getHealthSnapshot,
  getOverallHealth,
  evaluateDegradation,
  clearDegradation,
  getActiveDegradations,
  isDegraded,
  setDegradationRules,
  runSelfDiagnosis,
  registerHealthChecker,
  unregisterHealthChecker,
  runHealthChecks,
  initResilienceTables,
  pruneResilienceLogs,
  _resetResilienceState,
} from "../../core/resilience-v2.ts";
import { getDb } from "../../core/db-manager.ts";
import { _resetMetrics } from "../../skills/telemetry-v2/metrics-registry.ts";

vi.mock("../../core/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Resilience v2", () => {
  beforeEach(() => {
    initResilienceTables();
    _resetMetrics();
    _resetResilienceState();
    // Reset to default degradation rules
    setDegradationRules([]);
  });

  afterEach(() => {
    // Clean database
    const db = getDb();
    db.exec("DELETE FROM resilience_health_log");
    db.exec("DELETE FROM resilience_degradation_log");
  });

  describe("Health Tracking", () => {
    it("records success and returns healthy snapshot", () => {
      recordHealthSuccess("llm", "openai/gpt-4", 120);
      const snaps = getHealthSnapshot("llm", "openai/gpt-4");
      expect(snaps).toHaveLength(1);
      expect(snaps[0].status).toBe("healthy");
      expect(snaps[0].successCount).toBe(1);
      expect(snaps[0].avgLatencyMs).toBe(120);
    });

    it("records failure and increases consecutive failures", () => {
      recordHealthFailure("tool", "read_file", "timeout");
      recordHealthFailure("tool", "read_file", "timeout");
      const snaps = getHealthSnapshot("tool", "read_file");
      expect(snaps[0].status).toBe("unhealthy");
      expect(snaps[0].failureCount).toBe(2);
      expect(snaps[0].consecutiveFailures).toBe(2);
      expect(snaps[0].message).toBe("timeout");
    });

    it("records degraded status", () => {
      recordHealthDegraded("database", "sqlite", "slow query");
      const snaps = getHealthSnapshot("database", "sqlite");
      expect(snaps[0].status).toBe("degraded");
    });

    it("resets consecutive failures after success", () => {
      recordHealthFailure("llm", "anthropic/claude", "error");
      recordHealthFailure("llm", "anthropic/claude", "error");
      recordHealthSuccess("llm", "anthropic/claude", 200);
      const snaps = getHealthSnapshot("llm", "anthropic/claude");
      expect(snaps[0].consecutiveFailures).toBe(0);
      expect(snaps[0].status).toBe("healthy");
    });

    it("filters snapshots by component", () => {
      recordHealthSuccess("llm", "openai/gpt-4", 100);
      recordHealthSuccess("tool", "read_file", 50);
      const llmSnaps = getHealthSnapshot("llm");
      expect(llmSnaps).toHaveLength(1);
      expect(llmSnaps[0].name).toBe("openai/gpt-4");
    });

    it("returns all snapshots when no filter", () => {
      recordHealthSuccess("llm", "a", 100);
      recordHealthSuccess("tool", "b", 50);
      expect(getHealthSnapshot()).toHaveLength(2);
    });

    it("computes average latency from multiple samples", () => {
      recordHealthSuccess("llm", "model", 100);
      recordHealthSuccess("llm", "model", 200);
      recordHealthSuccess("llm", "model", 300);
      const snaps = getHealthSnapshot("llm", "model");
      expect(snaps[0].avgLatencyMs).toBe(200);
    });
  });

  describe("Overall Health", () => {
    it("returns unknown when no trackers", () => {
      expect(getOverallHealth()).toBe("unknown");
    });

    it("returns healthy when all are healthy", () => {
      recordHealthSuccess("llm", "a", 100);
      recordHealthSuccess("tool", "b", 50);
      expect(getOverallHealth()).toBe("healthy");
    });

    it("returns degraded when any is degraded", () => {
      recordHealthSuccess("llm", "a", 100);
      recordHealthDegraded("tool", "b", "slow");
      expect(getOverallHealth()).toBe("degraded");
    });

    it("returns unhealthy when any is unhealthy", () => {
      recordHealthSuccess("llm", "a", 100);
      recordHealthFailure("tool", "b", "error");
      expect(getOverallHealth()).toBe("unhealthy");
    });

    it("unhealthy beats degraded", () => {
      recordHealthDegraded("llm", "a", "slow");
      recordHealthFailure("tool", "b", "error");
      expect(getOverallHealth()).toBe("unhealthy");
    });
  });

  describe("Degradation", () => {
    beforeEach(() => {
      setDegradationRules([
        {
          componentType: "llm",
          trigger: { consecutiveFailures: 3 },
          strategy: { type: "circuit_break", config: { timeoutMs: 30_000 } },
          cooldownMs: 60_000,
        },
        {
          componentType: "tool",
          componentName: "write_file",
          trigger: { consecutiveFailures: 2 },
          strategy: { type: "retry", config: { maxRetries: 1 } },
          cooldownMs: 10_000,
        },
      ]);
    });

    it("does not trigger degradation below threshold", () => {
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      expect(evaluateDegradation("llm", "openai")).toBeNull();
      expect(isDegraded("llm", "openai")).toBe(false);
    });

    it("triggers degradation at threshold", () => {
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      const strategy = evaluateDegradation("llm", "openai");
      expect(strategy).not.toBeNull();
      expect(strategy!.type).toBe("circuit_break");
      expect(isDegraded("llm", "openai")).toBe(true);
    });

    it("matches component name when specified", () => {
      recordHealthFailure("tool", "write_file", "err");
      recordHealthFailure("tool", "write_file", "err");
      const strategy = evaluateDegradation("tool", "write_file");
      expect(strategy).not.toBeNull();
      expect(strategy!.type).toBe("retry");
    });

    it("does not match different component name", () => {
      recordHealthFailure("tool", "read_file", "err");
      recordHealthFailure("tool", "read_file", "err");
      const strategy = evaluateDegradation("tool", "read_file");
      expect(strategy).toBeNull();
    });

    it("lists active degradations", () => {
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      evaluateDegradation("llm", "openai");
      const active = getActiveDegradations();
      expect(active).toHaveLength(1);
      expect(active[0].component).toBe("llm");
      expect(active[0].name).toBe("openai");
    });

    it("clears degradation", () => {
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      evaluateDegradation("llm", "openai");
      clearDegradation("llm", "openai");
      expect(isDegraded("llm", "openai")).toBe(false);
    });

    it("returns active strategy during cooldown", () => {
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      recordHealthFailure("llm", "openai", "err");
      evaluateDegradation("llm", "openai");
      // Should still return strategy while in cooldown
      const strategy = evaluateDegradation("llm", "openai");
      expect(strategy).not.toBeNull();
      expect(strategy!.type).toBe("circuit_break");
    });
  });

  describe("Self Diagnosis", () => {
    it("returns report with healthy status when no issues", () => {
      recordHealthSuccess("llm", "openai", 100);
      const report = runSelfDiagnosis();
      expect(report.overallHealth).toBe("healthy");
      expect(report.components).toHaveLength(1);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it("detects critical unhealthy component", () => {
      recordHealthFailure("llm", "openai", "api down");
      const report = runSelfDiagnosis();
      expect(report.overallHealth).toBe("unhealthy");
      const critical = report.findings.filter((f) => f.severity === "critical");
      expect(critical.length).toBeGreaterThan(0);
      expect(critical.some((f) => f.component === "llm")).toBe(true);
    });

    it("detects high consecutive failures", () => {
      recordHealthFailure("tool", "write_file", "err");
      recordHealthFailure("tool", "write_file", "err");
      recordHealthFailure("tool", "write_file", "err");
      const report = runSelfDiagnosis();
      const critical = report.findings.filter((f) => f.severity === "critical" && f.metric === "consecutiveFailures");
      expect(critical.length).toBeGreaterThan(0);
    });

    it("detects high error rate", () => {
      for (let i = 0; i < 8; i++) {
        recordHealthFailure("llm", "openai", "err");
      }
      for (let i = 0; i < 2; i++) {
        recordHealthSuccess("llm", "openai", 100);
      }
      const report = runSelfDiagnosis();
      const errorRateFinding = report.findings.find((f) => f.metric === "errorRate");
      expect(errorRateFinding).toBeDefined();
      expect(errorRateFinding!.severity).toBe("critical");
    });

    it("recommends fallback LLM when LLM is unhealthy", () => {
      recordHealthFailure("llm", "openai", "api down");
      const report = runSelfDiagnosis();
      expect(report.recommendations.some((r) => r.includes("fallback LLM"))).toBe(true);
    });

    it("recommends DB check when database is unhealthy", () => {
      recordHealthFailure("database", "sqlite", "locked");
      const report = runSelfDiagnosis();
      expect(report.recommendations.some((r) => r.includes("database"))).toBe(true);
    });
  });

  describe("Health Checkers", () => {
    it("registers and runs health checkers", async () => {
      const checker = {
        component: "llm" as const,
        name: "test-llm",
        check: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 50 }),
      };
      registerHealthChecker(checker);
      await runHealthChecks();
      expect(checker.check).toHaveBeenCalledTimes(1);
      const snap = getHealthSnapshot("llm", "test-llm");
      expect(snap[0].status).toBe("healthy");
      unregisterHealthChecker("llm", "test-llm");
    });

    it("handles failing health checker", async () => {
      const checker = {
        component: "tool" as const,
        name: "fail-tool",
        check: vi.fn().mockRejectedValue(new Error("boom")),
      };
      registerHealthChecker(checker);
      await runHealthChecks();
      const snap = getHealthSnapshot("tool", "fail-tool");
      expect(snap[0].status).toBe("unhealthy");
      expect(snap[0].message).toBe("boom");
      unregisterHealthChecker("tool", "fail-tool");
    });

    it("handles unhealthy checker result", async () => {
      const checker = {
        component: "bridge" as const,
        name: "notion",
        check: vi.fn().mockResolvedValue({ healthy: false, latencyMs: 0, message: "auth failed" }),
      };
      registerHealthChecker(checker);
      await runHealthChecks();
      const snap = getHealthSnapshot("bridge", "notion");
      expect(snap[0].status).toBe("unhealthy");
      unregisterHealthChecker("bridge", "notion");
    });
  });

  describe("Database Operations", () => {
    it("logs health events to database", () => {
      recordHealthSuccess("llm", "openai", 100);
      const db = getDb();
      const rows = db.prepare("SELECT * FROM resilience_health_log ORDER BY id DESC LIMIT 1").all() as Array<{ component: string }>;
      expect(rows.length).toBe(1);
      expect(rows[0].component).toBe("llm");
    });

    it("prunes old logs", () => {
      const db = getDb();
      db.prepare(
        `INSERT INTO resilience_health_log (component, name, status, timestamp) VALUES (?, ?, ?, ?)`
      ).run("llm", "a", "healthy", Date.now() - 100_000);
      const result = pruneResilienceLogs(50_000);
      expect(result.healthDeleted).toBe(1);
    });
  });
});

// DegradationRule type is available from the module if needed
