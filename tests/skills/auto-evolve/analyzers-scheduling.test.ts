import { describe, it, expect } from "vitest";
import { analyzeSchedulingMetrics } from "../../../skills/auto-evolve/analyzers.ts";
import type { SchedulingMetrics } from "../../../skills/orchestrator/metrics.ts";

function makeMetrics(overrides: Partial<SchedulingMetrics> = {}): SchedulingMetrics {
  return {
    pools: [
      { pool: "cpu", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 2000, avgQueuedMs: 100, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
      { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
      { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
      { pool: "fallback", totalTasks: 2, successCount: 2, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
    ],
    overallSuccessRate: 1,
    overallAvgDurationMs: 3625,
    busiestPool: "cpu",
    slowestPool: "llm",
    collectedAt: Date.now(),
    ...overrides,
  };
}

describe("analyzeSchedulingMetrics", () => {
  it("returns empty proposals for healthy metrics", () => {
    const metrics = makeMetrics();
    const proposals = analyzeSchedulingMetrics(metrics);
    expect(proposals.length).toBe(0);
  });

  it("proposes increasing pool size when queue latency is high", () => {
    const metrics = makeMetrics({
      pools: [
        { pool: "cpu", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 2000, avgQueuedMs: 8000, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 2, successCount: 2, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const poolSizeProposal = proposals.find((p) => p.title.includes("Increase cpu pool concurrency"));
    expect(poolSizeProposal).toBeDefined();
    expect(poolSizeProposal?.category).toBe("performance");
    expect(poolSizeProposal?.autoApplicable).toBe(true);
  });

  it("proposes optimizing slow pool execution", () => {
    const metrics = makeMetrics({
      pools: [
        { pool: "cpu", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 2000, avgQueuedMs: 100, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 45000, avgQueuedMs: 200, p95DurationMs: 60000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 2, successCount: 2, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const slowProposal = proposals.find((p) => p.title.includes("Optimize llm pool task execution"));
    expect(slowProposal).toBeDefined();
    expect(slowProposal?.category).toBe("performance");
  });

  it("proposes improving routing when fallback is saturated", () => {
    const metrics = makeMetrics({
      pools: [
        { pool: "cpu", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 2000, avgQueuedMs: 100, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 15, successCount: 15, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 3 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const routingProposal = proposals.find((p) => p.title.includes("Improve task pool routing"));
    expect(routingProposal).toBeDefined();
    expect(routingProposal?.category).toBe("performance");
  });

  it("warns when overall success rate is below 85%", () => {
    const metrics = makeMetrics({
      overallSuccessRate: 0.75,
      pools: [
        { pool: "cpu", totalTasks: 10, successCount: 7, failureCount: 3, avgDurationMs: 2000, avgQueuedMs: 100, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 8, failureCount: 2, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 2, successCount: 0, failureCount: 2, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const successProposal = proposals.find((p) => p.title.includes("Overall worker success rate below"));
    expect(successProposal).toBeDefined();
    expect(successProposal?.category).toBe("reliability");
    expect(successProposal?.severity).toBe("warning");
  });

  it("flags degraded pool success rate", () => {
    const metrics = makeMetrics({
      pools: [
        { pool: "cpu", totalTasks: 20, successCount: 10, failureCount: 10, avgDurationMs: 2000, avgQueuedMs: 100, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 2, successCount: 2, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const poolProposal = proposals.find((p) => p.title.includes("cpu pool success rate degraded"));
    expect(poolProposal).toBeDefined();
    expect(poolProposal?.severity).toBe("critical");
  });

  it("deduplicates proposals", () => {
    const metrics = makeMetrics({
      pools: [
        { pool: "cpu", totalTasks: 20, successCount: 10, failureCount: 10, avgDurationMs: 2000, avgQueuedMs: 8000, p95DurationMs: 5000, p95QueuedMs: 300, throughputPerMinute: 2 },
        { pool: "io", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 1500, avgQueuedMs: 50, p95DurationMs: 3000, p95QueuedMs: 200, throughputPerMinute: 2 },
        { pool: "llm", totalTasks: 10, successCount: 10, failureCount: 0, avgDurationMs: 8000, avgQueuedMs: 200, p95DurationMs: 15000, p95QueuedMs: 500, throughputPerMinute: 2 },
        { pool: "fallback", totalTasks: 2, successCount: 2, failureCount: 0, avgDurationMs: 3000, avgQueuedMs: 100, p95DurationMs: 6000, p95QueuedMs: 300, throughputPerMinute: 0 },
      ],
    });
    const proposals = analyzeSchedulingMetrics(metrics);
    const titles = proposals.map((p) => p.title);
    const uniqueTitles = new Set(titles);
    expect(titles.length).toBe(uniqueTitles.size);
  });
});
