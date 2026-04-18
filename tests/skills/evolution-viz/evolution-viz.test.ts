import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import {
  logEvolution,
  getEvolutionLog,
  getEvolutionByCommit,
  resetMetadataDb,
  getEvolutionMetrics,
  getEvolutionTimeSeries,
  enrichHistoryWithMetadata,
  detectTrends,
} from "../../../skills/evolution-viz/index.ts";

function clearEvolutionDb(): void {
  resetMetadataDb();
  try {
    const db = new Database(join(process.cwd(), ".ouroboros", "evolution.db"));
    db.exec("DELETE FROM evolution_log;");
    db.close();
  } catch {
    // ignore
  }
}

describe("Evolution Viz", () => {
  beforeEach(() => {
    clearEvolutionDb();
  });

  afterEach(() => {
    clearEvolutionDb();
  });

  function makeRecord(
    overrides?: Partial<Parameters<typeof logEvolution>[0]> & { createdAt?: number }
  ): Parameters<typeof logEvolution>[0] & { createdAt?: number } {
    return {
      commitHash: "abc123",
      trigger: "user_request",
      costUsd: 0.1,
      reviewerModels: ["gpt-4"],
      userDecision: "approved",
      riskLevel: 3,
      status: "completed",
      ...overrides,
    };
  }

  describe("metadata-store", () => {
    it("logs and retrieves evolution records", () => {
      const r1 = logEvolution(makeRecord({ commitHash: "a1", costUsd: 0.5 }));
      expect(r1.id).toBeDefined();
      expect(r1.createdAt).toBeGreaterThan(0);

      const log = getEvolutionLog();
      expect(log).toHaveLength(1);
      expect(log[0].commitHash).toBe("a1");
    });

    it("retrieves record by commit hash", () => {
      logEvolution(makeRecord({ commitHash: "b2", status: "pending" }));
      const found = getEvolutionByCommit("b2");
      expect(found).toBeDefined();
      expect(found!.status).toBe("pending");
    });

    it("returns undefined for missing commit", () => {
      expect(getEvolutionByCommit("missing")).toBeUndefined();
    });

    it("stores multiple records for same commit (latest wins in byHash)", () => {
      logEvolution(makeRecord({ commitHash: "c3", riskLevel: 2 }));
      logEvolution(makeRecord({ commitHash: "c3", riskLevel: 7 }));
      const log = getEvolutionLog();
      expect(log).toHaveLength(2);
    });
  });

  describe("metrics-aggregator", () => {
    it("computes aggregate metrics", () => {
      logEvolution(makeRecord({ commitHash: "a", costUsd: 0.1, riskLevel: 2, status: "completed", userDecision: "approved" }));
      logEvolution(makeRecord({ commitHash: "b", costUsd: 0.2, riskLevel: 4, status: "completed", userDecision: "auto" }));
      logEvolution(makeRecord({ commitHash: "c", costUsd: 0.3, riskLevel: 8, status: "rolled_back", userDecision: "rejected" }));

      const metrics = getEvolutionMetrics();
      expect(metrics.totalEvolutions).toBe(3);
      expect(metrics.totalCostUsd).toBeCloseTo(0.6, 4);
      expect(metrics.avgRiskLevel).toBeCloseTo(4.67, 1);
      expect(metrics.successRate).toBeGreaterThan(0);
      expect(metrics.rollbackRate).toBeGreaterThan(0);
      expect(metrics.highRiskCount).toBe(1);
      expect(metrics.byTrigger["user_request"].count).toBe(3);
      expect(metrics.byStatus["completed"]).toBe(2);
    });

    it("returns zero metrics for empty log", () => {
      const metrics = getEvolutionMetrics();
      expect(metrics.totalEvolutions).toBe(0);
      expect(metrics.totalCostUsd).toBe(0);
      expect(metrics.avgRiskLevel).toBe(0);
    });

    it("generates time series", () => {
      const now = Date.now();
      logEvolution(makeRecord({ commitHash: "a", costUsd: 0.1, createdAt: now }));
      logEvolution(makeRecord({ commitHash: "b", costUsd: 0.2, createdAt: now - 86400000 }));

      const series = getEvolutionTimeSeries(7);
      expect(series.length).toBeGreaterThanOrEqual(1);
      const totalCount = series.reduce((s, p) => s + p.count, 0);
      expect(totalCount).toBe(2);
    });

    it("enriches commit history with metadata", () => {
      logEvolution(makeRecord({ commitHash: "abc", costUsd: 0.5, status: "completed" }));
      const commits = [{ hash: "abc", shortHash: "abc", message: "test", author: "a", date: "", tags: [], stats: { filesChanged: 1, insertions: 1, deletions: 0 } }];
      const enriched = enrichHistoryWithMetadata(commits);
      expect(enriched).toHaveLength(1);
      expect(enriched[0].metadata).toBeDefined();
      expect(enriched[0].metadata!.costUsd).toBe(0.5);
    });

    it("handles commits without metadata", () => {
      const commits = [{ hash: "zzz", shortHash: "zzz", message: "test", author: "a", date: "", tags: [], stats: { filesChanged: 1, insertions: 1, deletions: 0 } }];
      const enriched = enrichHistoryWithMetadata(commits);
      expect(enriched[0].metadata).toBeUndefined();
    });
  });

  describe("trend-detector", () => {
    it("returns stable when not enough data", () => {
      const trends = detectTrends();
      expect(trends.costTrend).toBe("stable");
      expect(trends.anomalies).toHaveLength(0);
      expect(trends.summary).toContain("Not enough data");
    });

    it("detects rising cost trend", () => {
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        logEvolution(makeRecord({
          commitHash: `c${i}`,
          costUsd: i < 3 ? 0.1 : 0.5,
          riskLevel: 3,
          createdAt: now + i * 3600000,
        }));
      }
      const trends = detectTrends();
      expect(trends.costTrend).toBe("rising");
    });

    it("detects risk spikes as anomalies", () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        logEvolution(makeRecord({
          commitHash: `c${i}`,
          costUsd: 0.1,
          riskLevel: i === 3 ? 9 : 2,
          createdAt: now + i * 3600000,
        }));
      }
      const trends = detectTrends();
      const riskAnomaly = trends.anomalies.find((a) => a.type === "risk_spike");
      expect(riskAnomaly).toBeDefined();
      expect(riskAnomaly!.severity).toBe("high");
    });

    it("detects rollback clusters", () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        logEvolution(makeRecord({
          commitHash: `c${i}`,
          costUsd: 0.1,
          riskLevel: 3,
          status: i >= 2 ? "rolled_back" : "completed",
          createdAt: now + i * 3600000,
        }));
      }
      const trends = detectTrends();
      const rollbackAnomaly = trends.anomalies.find((a) => a.type === "rollback_cluster");
      expect(rollbackAnomaly).toBeDefined();
    });

    it("detects approval drop", () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        logEvolution(makeRecord({
          commitHash: `c${i}`,
          costUsd: 0.1,
          riskLevel: 3,
          userDecision: i === 0 ? "approved" : "rejected",
          createdAt: now + i * 3600000,
        }));
      }
      const trends = detectTrends();
      const approvalAnomaly = trends.anomalies.find((a) => a.type === "approval_drop");
      expect(approvalAnomaly).toBeDefined();
    });
  });
});
