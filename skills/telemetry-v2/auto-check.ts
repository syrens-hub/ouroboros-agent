/**
 * Telemetry v2 — Auto-Check (Self-Diagnosis)
 * ==========================================
 * Agent runs a "health checkup" on itself by analysing metrics,
 * then produces structured findings for auto-evolve to consume.
 *
 * Trigger modes:
 *   - scheduled:  every 24h
 *   - event:      error rate spike, memory threshold breach
 *   - manual:     user says "check yourself"
 *
 * Output: CheckupReport with Findings → fed into auto-evolve proposal queue.
 */

import { getCounter, getGaugeLatest } from "./metrics-registry.ts";
import { buildRuntimeSummary, type RuntimeSummary } from "./runtime-dashboard.ts";
import { logger } from "../../core/logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckupReport {
  id: string;
  timestamp: number;
  trigger: "scheduled" | "event" | "manual";
  durationMs: number;
  overallStatus: "healthy" | "degraded" | "critical";
  healthScore: number;
  findings: Finding[];
  recommendations: Recommendation[];
  rawMetrics: RuntimeSummary;
}

export interface Finding {
  category: "performance" | "reliability" | "resource" | "security" | "evolution";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  threshold: number;
  evidence: Record<string, unknown>;
}

export interface Recommendation {
  category: "performance" | "reliability" | "resource" | "security" | "evolution";
  priority: "low" | "medium" | "high";
  title: string;
  description: string;
  suggestedAction: string;
  expectedImpact: string;
  autoApplicable: boolean;
  riskLevel: "low" | "medium" | "high";
  relatedFindingId?: string;
}

// ---------------------------------------------------------------------------
// Main Entry
// ---------------------------------------------------------------------------

export function runAutoCheck(trigger: "scheduled" | "event" | "manual" = "manual"): CheckupReport {
  const start = Date.now();
  const summary = buildRuntimeSummary();
  const findings = collectFindings(summary);
  const recommendations = generateRecommendations(findings);

  const overallStatus = summary.status;
  const report: CheckupReport = {
    id: `checkup-${Date.now()}`,
    timestamp: Date.now(),
    trigger,
    durationMs: Date.now() - start,
    overallStatus,
    healthScore: summary.healthScore,
    findings,
    recommendations,
    rawMetrics: summary,
  };

  logger.info("Auto-check completed", {
    checkupId: report.id,
    trigger,
    healthScore: report.healthScore,
    findings: findings.length,
    recommendations: recommendations.length,
  });

  return report;
}

// ---------------------------------------------------------------------------
// Finding Collectors
// ---------------------------------------------------------------------------

function collectFindings(summary: RuntimeSummary): Finding[] {
  const findings: Finding[] = [];

  // --- Performance ---
  if (summary.categories.http.p95LatencyMs > 1000) {
    findings.push({
      category: "performance",
      severity: summary.categories.http.p95LatencyMs > 3000 ? "critical" : "warning",
      title: "HTTP P95 latency elevated",
      description: `HTTP P95 latency is ${summary.categories.http.p95LatencyMs}ms, above threshold of 1000ms.`,
      metric: "http.p95LatencyMs",
      currentValue: summary.categories.http.p95LatencyMs,
      threshold: 1000,
      evidence: { topRoutes: summary.categories.http.topRoutes },
    });
  }

  if (summary.categories.llm.p95LatencyMs > 10000) {
    findings.push({
      category: "performance",
      severity: summary.categories.llm.p95LatencyMs > 30000 ? "critical" : "warning",
      title: "LLM P95 latency elevated",
      description: `LLM P95 latency is ${summary.categories.llm.p95LatencyMs}ms, above threshold of 10000ms.`,
      metric: "llm.p95LatencyMs",
      currentValue: summary.categories.llm.p95LatencyMs,
      threshold: 10000,
      evidence: { providerBreakdown: summary.categories.llm.providerBreakdown },
    });
  }

  if (summary.categories.database.p95LatencyMs > 500) {
    findings.push({
      category: "performance",
      severity: "warning",
      title: "Database P95 latency elevated",
      description: `DB P95 latency is ${summary.categories.database.p95LatencyMs}ms, above threshold of 500ms.`,
      metric: "db.p95LatencyMs",
      currentValue: summary.categories.database.p95LatencyMs,
      threshold: 500,
      evidence: { queriesTotal: summary.categories.database.queriesTotal },
    });
  }

  // --- Reliability ---
  if (summary.categories.http.errorRate > 0.01) {
    findings.push({
      category: "reliability",
      severity: summary.categories.http.errorRate > 0.05 ? "critical" : "warning",
      title: "HTTP error rate elevated",
      description: `HTTP error rate is ${(summary.categories.http.errorRate * 100).toFixed(2)}%.`,
      metric: "http.errorRate",
      currentValue: summary.categories.http.errorRate,
      threshold: 0.01,
      evidence: {},
    });
  }

  if (summary.categories.skills.errorRate > 0.05) {
    findings.push({
      category: "reliability",
      severity: summary.categories.skills.errorRate > 0.1 ? "critical" : "warning",
      title: "Skill error rate elevated",
      description: `Skill error rate is ${(summary.categories.skills.errorRate * 100).toFixed(2)}%.`,
      metric: "skills.errorRate",
      currentValue: summary.categories.skills.errorRate,
      threshold: 0.05,
      evidence: { topSkills: summary.categories.skills.topSkills },
    });
  }

  // --- Resource ---
  const heapMb = summary.categories.memory.heapUsedMb;
  if (heapMb > 256) {
    findings.push({
      category: "resource",
      severity: heapMb > 512 ? "critical" : "warning",
      title: "Heap memory usage high",
      description: `Heap used is ${heapMb}MB (total ${summary.categories.memory.heapTotalMb}MB).`,
      metric: "memory.heapUsedMb",
      currentValue: heapMb,
      threshold: 256,
      evidence: { trend: summary.categories.memory.trend },
    });
  }

  if (summary.categories.memory.trend === "rising" && heapMb > 200) {
    findings.push({
      category: "resource",
      severity: "warning",
      title: "Memory usage trending up",
      description: `Heap is ${heapMb}MB and rising. Possible leak.`,
      metric: "memory.heapTrend",
      currentValue: heapMb,
      threshold: 200,
      evidence: { trend: summary.categories.memory.trend },
    });
  }

  // --- Evolution ---
  if (summary.categories.evolution.proposalsTotal > 0 && summary.categories.evolution.successRate < 0.5) {
    findings.push({
      category: "evolution",
      severity: "warning",
      title: "Evolution success rate low",
      description: `Only ${(summary.categories.evolution.successRate * 100).toFixed(0)}% of proposals were applied successfully.`,
      metric: "evolution.successRate",
      currentValue: summary.categories.evolution.successRate,
      threshold: 0.5,
      evidence: { proposalsTotal: summary.categories.evolution.proposalsTotal, appliedTotal: summary.categories.evolution.appliedTotal },
    });
  }

  // --- Info-level baseline ---
  if (findings.length === 0) {
    findings.push({
      category: "performance",
      severity: "info",
      title: "All systems nominal",
      description: `Health score ${summary.healthScore}/100. No issues detected.`,
      metric: "healthScore",
      currentValue: summary.healthScore,
      threshold: 80,
      evidence: {},
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Recommendation Generator
// ---------------------------------------------------------------------------

function generateRecommendations(findings: Finding[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const f of findings) {
    switch (f.category + ":" + f.title) {
      case "performance:HTTP P95 latency elevated":
        recommendations.push({
          category: "performance",
          priority: f.severity === "critical" ? "high" : "medium",
          title: "Investigate slow HTTP routes",
          description: `Top routes by latency should be reviewed for optimisation.`,
          suggestedAction: "Review slow route handlers; consider adding caching or async offloading.",
          expectedImpact: "Reduce P95 latency by 20-50%.",
          autoApplicable: false,
          riskLevel: "low",
        });
        break;

      case "performance:LLM P95 latency elevated":
        recommendations.push({
          category: "performance",
          priority: "medium",
          title: "Enable LLM response caching",
          description: "Frequently asked queries can be cached to reduce LLM calls.",
          suggestedAction: "Add cache layer for identical prompts within 1h window.",
          expectedImpact: "Reduce LLM latency P95 by 30-60% for repeated queries.",
          autoApplicable: true,
          riskLevel: "low",
        });
        break;

      case "performance:Database P95 latency elevated":
        recommendations.push({
          category: "performance",
          priority: "high",
          title: "Add database indexes",
          description: "Slow queries detected. Missing indexes are the most common cause.",
          suggestedAction: "Run EXPLAIN on slow queries and add suggested indexes.",
          expectedImpact: "Reduce DB P95 latency by 50-90%.",
          autoApplicable: true,
          riskLevel: "low",
        });
        break;

      case "reliability:Skill error rate elevated":
        recommendations.push({
          category: "reliability",
          priority: "high",
          title: "Review failing skills",
          description: `Skills with high error rates need prompt or timeout tuning.`,
          suggestedAction: "Inspect error logs for top failing skills; improve error handling and retry logic.",
          expectedImpact: "Reduce skill error rate below 1%.",
          autoApplicable: false,
          riskLevel: "low",
        });
        break;

      case "resource:Heap memory usage high":
      case "resource:Memory usage trending up":
        recommendations.push({
          category: "resource",
          priority: "medium",
          title: "Investigate memory growth",
          description: "Memory is high or trending up. Possible causes: large caches, event listeners, or closures.",
          suggestedAction: "Generate heap snapshot and inspect retaining paths for largest objects.",
          expectedImpact: "Identify and fix memory leak source.",
          autoApplicable: false,
          riskLevel: "medium",
        });
        break;

      case "evolution:Evolution success rate low":
        recommendations.push({
          category: "evolution",
          priority: "high",
          title: "Strengthen evolution test gate",
          description: "Many proposals fail after application. Tests may be too weak or proposals too risky.",
          suggestedAction: "Require higher test coverage threshold before auto-applying proposals; add integration tests.",
          expectedImpact: "Increase evolution success rate to >80%.",
          autoApplicable: false,
          riskLevel: "low",
        });
        break;
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return recommendations.filter((r) => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scheduled Check (to be wired into cron/task-scheduler)
// ---------------------------------------------------------------------------

export function scheduleAutoCheck(intervalMs = 24 * 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    try {
      runAutoCheck("scheduled");
    } catch (e) {
      logger.error("Scheduled auto-check failed", { error: String(e) });
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Event-driven trigger (to be wired into hook-system)
// ---------------------------------------------------------------------------

let lastErrorRate = 0;
let lastMemoryMb = 0;

export function maybeTriggerEventCheck(): CheckupReport | null {
  const httpErrorRate = getCounter("ouroboros_requests_total", { status: "500" }) / Math.max(getCounter("ouroboros_requests_total"), 1);
  const memoryMb = (getGaugeLatest("ouroboros_memory_bytes", { type: "heapUsed" }) || 0) / 1024 / 1024;

  let triggered = false;
  if (httpErrorRate > lastErrorRate * 2 && httpErrorRate > 0.05) triggered = true;
  if (memoryMb > lastMemoryMb * 1.5 && memoryMb > 400) triggered = true;

  lastErrorRate = httpErrorRate;
  lastMemoryMb = memoryMb;

  if (triggered) {
    return runAutoCheck("event");
  }
  return null;
}
