import { describe, it, expect } from "vitest";
import { analyzeCheckupReport, analyzeDeadCode } from "../../../skills/auto-evolve/analyzers.ts";
import type { CheckupReport } from "../../../skills/telemetry-v2/auto-check.ts";

describe("analyzers", () => {
  const baseReport: CheckupReport = {
    id: "checkup-test",
    timestamp: Date.now(),
    trigger: "manual",
    durationMs: 10,
    overallStatus: "degraded",
    healthScore: 60,
    findings: [
      {
        category: "performance",
        severity: "warning",
        title: "Database P95 latency elevated",
        description: "DB P95 is 800ms",
        metric: "db.p95LatencyMs",
        currentValue: 800,
        threshold: 500,
        evidence: {},
      },
    ],
    recommendations: [
      {
        category: "performance",
        priority: "high",
        title: "Add database indexes",
        description: "Slow queries detected.",
        suggestedAction: "CREATE INDEX ...",
        expectedImpact: "Reduce latency.",
        autoApplicable: true,
        riskLevel: "low",
      },
    ],
    rawMetrics: {
      timestamp: Date.now(),
      uptimeSeconds: 100,
      healthScore: 60,
      status: "degraded",
      categories: {
        http: { requestsTotal: 10, requestsPerMinute: 6, avgLatencyMs: 50, p95LatencyMs: 100, errorRate: 0, topRoutes: [] },
        llm: { callsTotal: 5, callsPerMinute: 3, tokensTotal: 1000, avgLatencyMs: 500, p95LatencyMs: 800, errorRate: 0, providerBreakdown: [] },
        skills: { callsTotal: 20, errorsTotal: 4, errorRate: 0.2, topSkills: [{ skill: "bad-skill", calls: 10, errors: 3 }] },
        memory: { heapUsedMb: 300, heapTotalMb: 400, rssMb: 500, externalMb: 50, trend: "stable" },
        database: { queriesTotal: 1000, queriesPerMinute: 60, avgLatencyMs: 50, p95LatencyMs: 800, slowQueries: 5 },
        evolution: { proposalsTotal: 5, appliedTotal: 3, pendingProposals: 2, successRate: 0.6 },
      },
      alerts: [],
      trends: [],
    },
  };

  it("converts findings to proposals", () => {
    const drafts = analyzeCheckupReport(baseReport);
    expect(drafts.length).toBeGreaterThan(0);

    const indexProposal = drafts.find((d) => d.title.includes("index"));
    expect(indexProposal).toBeDefined();
    expect(indexProposal!.autoApplicable).toBe(true);
    expect(indexProposal!.riskLevel).toBe("low");
  });

  it("detects slow queries from raw metrics", () => {
    const drafts = analyzeCheckupReport(baseReport);
    const slowQuery = drafts.find((d) => d.title.includes("slow queries"));
    expect(slowQuery).toBeDefined();
    expect(slowQuery!.category).toBe("performance");
  });

  it("detects skill errors from raw metrics", () => {
    const drafts = analyzeCheckupReport(baseReport);
    const skillErr = drafts.find((d) => d.title.includes("failing skill"));
    expect(skillErr).toBeDefined();
    expect(skillErr!.category).toBe("reliability");
  });

  it("deduplicates proposals", () => {
    const drafts = analyzeCheckupReport(baseReport);
    const titles = drafts.map((d) => d.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("dead-code analyzer returns empty for non-existent dir", async () => {
    const drafts = await analyzeDeadCode("non-existent-dir-12345");
    expect(drafts).toEqual([]);
  });
});
