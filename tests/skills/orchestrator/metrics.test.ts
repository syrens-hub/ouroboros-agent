import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTaskMetrics,
  getSchedulingMetrics,
  getPoolMetrics,
  resetSchedulingMetrics,
  getSchedulingHistory,
} from "../../../skills/orchestrator/metrics.ts";
import type { TaskExecutionRecord } from "../../../skills/orchestrator/metrics.ts";

describe("Scheduling Metrics", () => {
  beforeEach(() => {
    resetSchedulingMetrics();
  });

  it("records and retrieves task metrics", () => {
    recordTaskMetrics({
      pool: "cpu",
      durationMs: 1200,
      success: true,
      complexity: 5,
      queuedMs: 300,
      timestamp: Date.now(),
    });

    const history = getSchedulingHistory();
    expect(history).toHaveLength(1);
    expect(history[0].pool).toBe("cpu");
    expect(history[0].durationMs).toBe(1200);
  });

  it("returns empty metrics when no data", () => {
    const metrics = getSchedulingMetrics();
    expect(metrics.overallSuccessRate).toBe(0);
    expect(metrics.overallAvgDurationMs).toBe(0);
    expect(metrics.pools).toHaveLength(4);
    for (const pool of metrics.pools) {
      expect(pool.totalTasks).toBe(0);
    }
  });

  it("calculates pool metrics correctly", () => {
    const now = Date.now();
    const records: TaskExecutionRecord[] = [
      { pool: "io", durationMs: 500, success: true, complexity: 2, queuedMs: 100, timestamp: now },
      { pool: "io", durationMs: 700, success: true, complexity: 2, queuedMs: 200, timestamp: now },
      { pool: "io", durationMs: 3000, success: false, complexity: 4, queuedMs: 50, timestamp: now },
    ];

    for (const r of records) {
      recordTaskMetrics(r);
    }

    const ioMetrics = getPoolMetrics("io");
    expect(ioMetrics.totalTasks).toBe(3);
    expect(ioMetrics.successCount).toBe(2);
    expect(ioMetrics.failureCount).toBe(1);
    expect(ioMetrics.avgDurationMs).toBe(1400);
    expect(ioMetrics.avgQueuedMs).toBe(117);
    expect(ioMetrics.p95DurationMs).toBe(3000);
  });

  it("calculates overall metrics across pools", () => {
    const now = Date.now();
    recordTaskMetrics({ pool: "cpu", durationMs: 1000, success: true, complexity: 3, queuedMs: 0, timestamp: now });
    recordTaskMetrics({ pool: "llm", durationMs: 5000, success: false, complexity: 7, queuedMs: 200, timestamp: now });

    const metrics = getSchedulingMetrics();
    expect(metrics.overallSuccessRate).toBe(0.5);
    expect(metrics.overallAvgDurationMs).toBe(3000);
    expect(metrics.busiestPool).toBe("cpu"); // both have 1 task, cpu is first in tie
  });

  it("caps history at MAX_HISTORY", () => {
    for (let i = 0; i < 520; i++) {
      recordTaskMetrics({
        pool: "fallback",
        durationMs: 100,
        success: true,
        complexity: 1,
        queuedMs: 0,
        timestamp: Date.now(),
      });
    }
    expect(getSchedulingHistory().length).toBe(500);
  });

  it("calculates throughput for recent tasks only", () => {
    const now = Date.now();
    // Old tasks (outside 5 min window)
    for (let i = 0; i < 10; i++) {
      recordTaskMetrics({
        pool: "cpu",
        durationMs: 100,
        success: true,
        complexity: 1,
        queuedMs: 0,
        timestamp: now - 10 * 60 * 1000,
      });
    }
    // Recent tasks
    for (let i = 0; i < 5; i++) {
      recordTaskMetrics({
        pool: "cpu",
        durationMs: 100,
        success: true,
        complexity: 1,
        queuedMs: 0,
        timestamp: now,
      });
    }

    const cpuMetrics = getPoolMetrics("cpu");
    expect(cpuMetrics.throughputPerMinute).toBe(1); // 5 tasks / 5 min = 1/min
  });

  it("identifies slowest pool", () => {
    const now = Date.now();
    recordTaskMetrics({ pool: "cpu", durationMs: 1000, success: true, complexity: 1, queuedMs: 0, timestamp: now });
    recordTaskMetrics({ pool: "llm", durationMs: 10000, success: true, complexity: 1, queuedMs: 0, timestamp: now });

    const metrics = getSchedulingMetrics();
    expect(metrics.slowestPool).toBe("llm");
  });
});
