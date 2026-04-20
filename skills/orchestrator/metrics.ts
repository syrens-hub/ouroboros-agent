/**
 * Scheduling Metrics
 * ==================
 * Collect per-pool execution metrics for auto-evolve analysis.
 * Lightweight in-memory ring buffers — no DB writes on hot path.
 */

import type { TaskPoolType } from "./scheduler.ts";

export interface TaskExecutionRecord {
  pool: TaskPoolType;
  durationMs: number;
  success: boolean;
  complexity: number;
  queuedMs: number;
  timestamp: number;
  agentName?: string;
}

export interface PoolMetricsSnapshot {
  pool: TaskPoolType;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  avgQueuedMs: number;
  p95DurationMs: number;
  p95QueuedMs: number;
  throughputPerMinute: number;
}

export interface SchedulingMetrics {
  pools: PoolMetricsSnapshot[];
  overallSuccessRate: number;
  overallAvgDurationMs: number;
  busiestPool: TaskPoolType;
  slowestPool: TaskPoolType;
  collectedAt: number;
}

const MAX_HISTORY = 500;
const history: TaskExecutionRecord[] = [];

export function recordTaskMetrics(record: TaskExecutionRecord): void {
  history.push(record);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function getPoolMetrics(pool: TaskPoolType): PoolMetricsSnapshot {
  const now = Date.now();
  const records = history.filter((r) => r.pool === pool);
  const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
  const queued = records.map((r) => r.queuedMs).sort((a, b) => a - b);

  const totalTasks = records.length;
  const successCount = records.filter((r) => r.success).length;
  const failureCount = totalTasks - successCount;
  const avgDurationMs = totalTasks > 0 ? durations.reduce((a, b) => a + b, 0) / totalTasks : 0;
  const avgQueuedMs = totalTasks > 0 ? queued.reduce((a, b) => a + b, 0) / totalTasks : 0;

  // Throughput: tasks in last 5 minutes
  const fiveMinAgo = now - 5 * 60 * 1000;
  const recent = records.filter((r) => r.timestamp > fiveMinAgo).length;

  return {
    pool,
    totalTasks,
    successCount,
    failureCount,
    avgDurationMs: Math.round(avgDurationMs),
    avgQueuedMs: Math.round(avgQueuedMs),
    p95DurationMs: Math.round(percentile(durations, 95)),
    p95QueuedMs: Math.round(percentile(queued, 95)),
    throughputPerMinute: Math.round(recent / 5),
  };
}

export function getSchedulingMetrics(): SchedulingMetrics {
  const pools: TaskPoolType[] = ["cpu", "io", "llm", "fallback"];
  const snapshots = pools.map(getPoolMetrics);

  const overallSuccessRate =
    snapshots.reduce((s, p) => s + p.successCount, 0) /
    Math.max(1, snapshots.reduce((s, p) => s + p.totalTasks, 0));

  const overallAvgDurationMs =
    snapshots.reduce((s, p) => s + p.avgDurationMs * p.totalTasks, 0) /
    Math.max(1, snapshots.reduce((s, p) => s + p.totalTasks, 0));

  const busiest = snapshots.reduce((a, b) => (a.totalTasks >= b.totalTasks ? a : b), snapshots[0]);
  const slowest = snapshots.reduce((a, b) => (a.avgDurationMs > b.avgDurationMs ? a : b), snapshots[0]);

  return {
    pools: snapshots,
    overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
    overallAvgDurationMs: Math.round(overallAvgDurationMs),
    busiestPool: busiest?.pool ?? "fallback",
    slowestPool: slowest?.pool ?? "fallback",
    collectedAt: Date.now(),
  };
}

export function resetSchedulingMetrics(): void {
  history.length = 0;
}

export function getSchedulingHistory(): readonly TaskExecutionRecord[] {
  return history;
}
