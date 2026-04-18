/**
 * Trend Detector
 * ==============
 * Detects patterns and anomalies in the evolution history.
 */

import { getEvolutionLog, type EvolutionRecord } from "./metadata-store.ts";

export interface TrendReport {
  costTrend: "rising" | "falling" | "stable";
  riskTrend: "rising" | "falling" | "stable";
  frequencyTrend: "rising" | "falling" | "stable";
  anomalies: Anomaly[];
  summary: string;
}

export interface Anomaly {
  type: "cost_spike" | "risk_spike" | "rollback_cluster" | "approval_drop";
  description: string;
  severity: "low" | "medium" | "high";
  relatedRecords: string[]; // commit hashes
}

export function detectTrends(): TrendReport {
  const records = getEvolutionLog();

  if (records.length < 3) {
    return {
      costTrend: "stable",
      riskTrend: "stable",
      frequencyTrend: "stable",
      anomalies: [],
      summary: "Not enough data to detect trends (need ≥3 records).",
    };
  }

  // Sort by time ascending
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);

  // Split into first half and second half
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const avgCost = (arr: EvolutionRecord[]) =>
    arr.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, arr.length);
  const avgRisk = (arr: EvolutionRecord[]) =>
    arr.reduce((s, r) => s + r.riskLevel, 0) / Math.max(1, arr.length);

  const firstCost = avgCost(firstHalf);
  const secondCost = avgCost(secondHalf);
  const costDiff = secondCost - firstCost;
  const costTrend: TrendReport["costTrend"] =
    costDiff > firstCost * 0.2 ? "rising" : costDiff < -firstCost * 0.2 ? "falling" : "stable";

  const firstRisk = avgRisk(firstHalf);
  const secondRisk = avgRisk(secondHalf);
  const riskDiff = secondRisk - firstRisk;
  const riskTrend: TrendReport["riskTrend"] =
    riskDiff > 1.5 ? "rising" : riskDiff < -1.5 ? "falling" : "stable";

  // Frequency: compare time span per record
  const firstSpan = (firstHalf[firstHalf.length - 1]?.createdAt ?? 0) - (firstHalf[0]?.createdAt ?? 0);
  const secondSpan = (secondHalf[secondHalf.length - 1]?.createdAt ?? 0) - (secondHalf[0]?.createdAt ?? 0);
  const firstFreq = firstHalf.length / Math.max(1, firstSpan / 86400000);
  const secondFreq = secondHalf.length / Math.max(1, secondSpan / 86400000);
  const freqDiff = secondFreq - firstFreq;
  const frequencyTrend: TrendReport["frequencyTrend"] =
    freqDiff > firstFreq * 0.3 ? "rising" : freqDiff < -firstFreq * 0.3 ? "falling" : "stable";

  const anomalies = findAnomalies(sorted);

  const parts: string[] = [];
  if (costTrend !== "stable") parts.push(`cost is ${costTrend}`);
  if (riskTrend !== "stable") parts.push(`risk is ${riskTrend}`);
  if (frequencyTrend !== "stable") parts.push(`frequency is ${frequencyTrend}`);
  const summary = parts.length > 0
    ? `Evolution ${parts.join(", ")}. ${anomalies.length} anomaly(ies) detected.`
    : `Evolution metrics are stable. ${anomalies.length} anomaly(ies) detected.`;

  return {
    costTrend,
    riskTrend,
    frequencyTrend,
    anomalies,
    summary,
  };
}

function findAnomalies(records: EvolutionRecord[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (records.length === 0) return anomalies;

  const avgCost = records.reduce((s, r) => s + r.costUsd, 0) / records.length;
  const avgRisk = records.reduce((s, r) => s + r.riskLevel, 0) / records.length;

  // Cost spikes (>3x average)
  const costSpikes = records.filter((r) => r.costUsd > avgCost * 3 && r.costUsd > 0.5);
  if (costSpikes.length > 0) {
    anomalies.push({
      type: "cost_spike",
      description: `${costSpikes.length} evolution(s) with unusually high cost (>3× avg)`,
      severity: costSpikes.length > 1 ? "high" : "medium",
      relatedRecords: costSpikes.map((r) => r.commitHash),
    });
  }

  // Risk spikes (>3x average or >= 9)
  const riskSpikes = records.filter((r) => r.riskLevel >= 9 || (avgRisk > 0 && r.riskLevel > avgRisk * 3));
  if (riskSpikes.length > 0) {
    anomalies.push({
      type: "risk_spike",
      description: `${riskSpikes.length} evolution(s) with critical risk level`,
      severity: "high",
      relatedRecords: riskSpikes.map((r) => r.commitHash),
    });
  }

  // Rollback clusters (≥2 rollbacks)
  const rollbacks = records.filter((r) => r.status === "rolled_back");
  if (rollbacks.length >= 2) {
    anomalies.push({
      type: "rollback_cluster",
      description: `${rollbacks.length} rollbacks detected — review pipeline stability`,
      severity: rollbacks.length >= 3 ? "high" : "medium",
      relatedRecords: rollbacks.map((r) => r.commitHash),
    });
  }

  // Approval drop (many auto/pending, few approved)
  const explicitApproved = records.filter((r) => r.userDecision === "approved").length;
  const explicitRejected = records.filter((r) => r.userDecision === "rejected").length;
  const totalExplicit = explicitApproved + explicitRejected;
  if (totalExplicit > 3 && explicitApproved / totalExplicit < 0.3) {
    anomalies.push({
      type: "approval_drop",
      description: `Low approval rate (${Math.round((explicitApproved / totalExplicit) * 100)}%) — consider tightening review criteria`,
      severity: "medium",
      relatedRecords: records.filter((r) => r.userDecision === "rejected").map((r) => r.commitHash),
    });
  }

  return anomalies;
}
