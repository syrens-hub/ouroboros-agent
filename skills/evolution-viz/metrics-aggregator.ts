/**
 * Metrics Aggregator
 * ==================
 * Computes aggregate statistics over the evolution log.
 */

import { getEvolutionLog, type EvolutionRecord } from "./metadata-store.ts";

export interface EvolutionMetrics {
  totalEvolutions: number;
  totalCostUsd: number;
  avgRiskLevel: number;
  successRate: number; // % of approved + completed
  approvalRate: number; // % of approved (excluding auto)
  rollbackRate: number;
  byTrigger: Record<string, { count: number; costUsd: number }>;
  byStatus: Record<string, number>;
  avgCostPerEvolution: number;
  highRiskCount: number; // risk >= 7
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  count: number;
  costUsd: number;
  avgRisk: number;
}

export function getEvolutionMetrics(): EvolutionMetrics {
  const records = getEvolutionLog();

  let totalCostUsd = 0;
  let totalRisk = 0;
  let approvedOrCompleted = 0;
  let approvedExplicit = 0;
  let rolledBack = 0;
  let highRisk = 0;

  const byTrigger: Record<string, { count: number; costUsd: number }> = {};
  const byStatus: Record<string, number> = {};

  for (const r of records) {
    totalCostUsd += r.costUsd;
    totalRisk += r.riskLevel;

    if (r.status === "completed" || r.userDecision === "approved") {
      approvedOrCompleted++;
    }
    if (r.userDecision === "approved") {
      approvedExplicit++;
    }
    if (r.status === "rolled_back") {
      rolledBack++;
    }
    if (r.riskLevel >= 7) {
      highRisk++;
    }

    byStatus[r.status] = (byStatus[r.status] || 0) + 1;

    const t = r.trigger || "unknown";
    if (!byTrigger[t]) {
      byTrigger[t] = { count: 0, costUsd: 0 };
    }
    byTrigger[t].count++;
    byTrigger[t].costUsd += r.costUsd;
  }

  const total = records.length || 1;

  return {
    totalEvolutions: records.length,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    avgRiskLevel: Math.round((totalRisk / total) * 100) / 100,
    successRate: Math.round((approvedOrCompleted / total) * 1000) / 10,
    approvalRate: Math.round((approvedExplicit / total) * 1000) / 10,
    rollbackRate: Math.round((rolledBack / total) * 1000) / 10,
    byTrigger,
    byStatus,
    avgCostPerEvolution: Math.round((totalCostUsd / total) * 10000) / 10000,
    highRiskCount: highRisk,
  };
}

export function getEvolutionTimeSeries(days = 30): TimeSeriesPoint[] {
  const records = getEvolutionLog();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = records.filter((r) => r.createdAt >= cutoff);

  const byDate = new Map<string, { count: number; cost: number; risks: number[] }>();

  for (const r of recent) {
    const date = new Date(r.createdAt).toISOString().slice(0, 10);
    const bucket = byDate.get(date) || { count: 0, cost: 0, risks: [] };
    bucket.count++;
    bucket.cost += r.costUsd;
    bucket.risks.push(r.riskLevel);
    byDate.set(date, bucket);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  return sortedDates.map((date) => {
    const bucket = byDate.get(date)!;
    const avgRisk = bucket.risks.reduce((a, b) => a + b, 0) / bucket.risks.length;
    return {
      date,
      count: bucket.count,
      costUsd: Math.round(bucket.cost * 10000) / 10000,
      avgRisk: Math.round(avgRisk * 100) / 100,
    };
  });
}

export function enrichHistoryWithMetadata(
  commits: Array<{ hash: string; shortHash: string; message: string; author: string; date: string; tags: string[]; stats: { filesChanged: number; insertions: number; deletions: number } }>
): Array<{ commit: typeof commits[0]; metadata?: EvolutionRecord }> {
  const records = getEvolutionLog();
  const byHash = new Map<string, EvolutionRecord>();
  for (const r of records) {
    if (!byHash.has(r.commitHash) || r.createdAt > (byHash.get(r.commitHash)?.createdAt ?? 0)) {
      byHash.set(r.commitHash, r);
    }
  }

  return commits.map((commit) => ({
    commit,
    metadata: byHash.get(commit.hash),
  }));
}
