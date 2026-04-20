/**
 * Telemetry v2 — Runtime Dashboard
 * =================================
 * Aggregates in-memory metrics into a structured "runtime snapshot"
 * served at GET /admin/runtime.  Designed for both human eyes and
 * auto-evolve consumption.
 */

import {
  getAllMetrics,
  getCounter,
  getGaugeLatest,
  getGaugeSeries,
  getHistogramPercentile,
  type MetricSnapshot,
} from "./metrics-registry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuntimeSummary {
  timestamp: number;
  uptimeSeconds: number;
  healthScore: number; // 0-100
  status: "healthy" | "degraded" | "critical";
  categories: {
    http: HttpSummary;
    llm: LlmSummary;
    skills: SkillsSummary;
    memory: MemorySummary;
    database: DatabaseSummary;
    evolution: EvolutionSummary;
  };
  alerts: Alert[];
  trends: Trend[];
}

export interface HttpSummary {
  requestsTotal: number;
  requestsPerMinute: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number; // 0-1
  topRoutes: Array<{ route: string; count: number; avgMs: number }>;
}

export interface LlmSummary {
  callsTotal: number;
  callsPerMinute: number;
  tokensTotal: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  providerBreakdown: Array<{ provider: string; calls: number; avgMs: number }>;
}

export interface SkillsSummary {
  callsTotal: number;
  errorsTotal: number;
  errorRate: number;
  topSkills: Array<{ skill: string; calls: number; errors: number }>;
}

export interface MemorySummary {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  trend: "rising" | "stable" | "falling";
}

export interface DatabaseSummary {
  queriesTotal: number;
  queriesPerMinute: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  slowQueries: number;
}

export interface EvolutionSummary {
  proposalsTotal: number;
  appliedTotal: number;
  pendingProposals: number;
  successRate: number;
}

export interface Alert {
  level: "info" | "warning" | "critical";
  category: string;
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

export interface Trend {
  metric: string;
  direction: "up" | "down" | "flat";
  changePercent: number;
  windowMinutes: number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function buildRuntimeSummary(): RuntimeSummary {
  const now = Date.now();
  const snapshot = getAllMetrics();
  const uptime = getGaugeLatest("ouroboros_uptime_seconds") || process.uptime();

  const http = summarizeHttp(snapshot, now);
  const llm = summarizeLlm(snapshot, now);
  const skills = summarizeSkills(snapshot, now);
  const memory = summarizeMemory(snapshot, now);
  const database = summarizeDatabase(snapshot, now);
  const evolution = summarizeEvolution(snapshot, now);

  const alerts = generateAlerts({ http, llm, skills, memory, database, evolution });
  const trends = generateTrends(snapshot, now);
  const healthScore = computeHealthScore({ http, llm, skills, memory, database, evolution }, alerts);
  const status = healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "critical";

  return {
    timestamp: now,
    uptimeSeconds: uptime,
    healthScore,
    status,
    categories: { http, llm, skills, memory, database, evolution },
    alerts,
    trends,
  };
}

// ---------------------------------------------------------------------------
// Category Summaries
// ---------------------------------------------------------------------------

function summarizeHttp(snapshot: MetricSnapshot, now: number): HttpSummary {
  const requestsTotal = getCounter("ouroboros_requests_total");
  const errors = snapshot.counters.filter((c) => c.name === "ouroboros_requests_total" && c.labels.status && c.labels.status.startsWith("5"));
  const errorCount = errors.reduce((s, c) => s + c.value, 0);
  const errorRate = requestsTotal > 0 ? errorCount / requestsTotal : 0;

  // Latency from histogram
  const p95Ms = (getHistogramPercentile("ouroboros_request_duration_seconds", {}, 0.95) || 0) * 1000;
  const avgMs = estimateHistogramMean("ouroboros_request_duration_seconds", {}) * 1000;

  // Per-route breakdown
  const routeCounts = new Map<string, { count: number; totalMs: number }>();
  for (const c of snapshot.counters) {
    if (c.name === "ouroboros_requests_total" && c.labels.path) {
      const existing = routeCounts.get(c.labels.path) || { count: 0, totalMs: 0 };
      existing.count += c.value;
      routeCounts.set(c.labels.path, existing);
    }
  }
  const topRoutes = Array.from(routeCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([route, data]) => ({ route, count: data.count, avgMs: Math.round(data.totalMs / Math.max(data.count, 1)) }));

  return {
    requestsTotal,
    requestsPerMinute: Math.round((requestsTotal / Math.max(now - processStartTime(), 1)) * 60_000),
    avgLatencyMs: Math.round(avgMs),
    p95LatencyMs: Math.round(p95Ms),
    errorRate: Math.round(errorRate * 1000) / 1000,
    topRoutes,
  };
}

function summarizeLlm(_snapshot: MetricSnapshot, now: number): LlmSummary {
  const callsTotal = getCounter("ouroboros_llm_calls_total");
  const tokensTotal = getCounter("ouroboros_llm_tokens_total");
  const p95Ms = (getHistogramPercentile("ouroboros_llm_latency_seconds", {}, 0.95) || 0) * 1000;
  const avgMs = estimateHistogramMean("ouroboros_llm_latency_seconds", {}) * 1000;

  // Provider breakdown if labels exist
  const providerBreakdown: Array<{ provider: string; calls: number; avgMs: number }> = [];
  // We don't have per-provider histograms yet; placeholder for future.

  return {
    callsTotal,
    callsPerMinute: Math.round((callsTotal / Math.max(now - processStartTime(), 1)) * 60_000),
    tokensTotal,
    avgLatencyMs: Math.round(avgMs),
    p95LatencyMs: Math.round(p95Ms),
    errorRate: 0, // TODO: add llm_errors_total counter
    providerBreakdown,
  };
}

function summarizeSkills(snapshot: MetricSnapshot, _now: number): SkillsSummary {
  const callsTotal = getCounter("ouroboros_skill_calls_total");
  const errorsTotal = getCounter("ouroboros_skill_errors_total");
  const errorRate = callsTotal > 0 ? errorsTotal / callsTotal : 0;

  const skillCounts = new Map<string, { calls: number; errors: number }>();
  for (const c of snapshot.counters) {
    if (c.name === "ouroboros_skill_calls_total" && c.labels.skill) {
      const existing = skillCounts.get(c.labels.skill) || { calls: 0, errors: 0 };
      existing.calls += c.value;
      skillCounts.set(c.labels.skill, existing);
    }
    if (c.name === "ouroboros_skill_errors_total" && c.labels.skill) {
      const existing = skillCounts.get(c.labels.skill) || { calls: 0, errors: 0 };
      existing.errors += c.value;
      skillCounts.set(c.labels.skill, existing);
    }
  }

  const topSkills = Array.from(skillCounts.entries())
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 5)
    .map(([skill, data]) => ({ skill, calls: data.calls, errors: data.errors }));

  return { callsTotal, errorsTotal, errorRate: Math.round(errorRate * 1000) / 1000, topSkills };
}

function summarizeMemory(_snapshot: MetricSnapshot, _now: number): MemorySummary {
  // Prefer metrics registry gauge if available; fallback to process.memoryUsage()
  const gaugeHeapUsed = getGaugeLatest("ouroboros_memory_bytes", { type: "heapUsed" });
  const gaugeHeapTotal = getGaugeLatest("ouroboros_memory_bytes", { type: "heapTotal" });
  const gaugeRss = getGaugeLatest("ouroboros_memory_bytes", { type: "rss" });
  const gaugeExternal = getGaugeLatest("ouroboros_memory_bytes", { type: "external" });

  const mem = process.memoryUsage();
  const heapUsed = gaugeHeapUsed ?? mem.heapUsed;
  const heapTotal = gaugeHeapTotal ?? mem.heapTotal;
  const rss = gaugeRss ?? mem.rss;
  const external = gaugeExternal ?? mem.external;

  const series = getGaugeSeries("ouroboros_memory_bytes", { type: "heapUsed" });
  let trend: "rising" | "stable" | "falling" = "stable";
  if (series.length >= 3) {
    const recent = series.slice(-3).reduce((s, v) => s + v.value, 0) / 3;
    const older = series.slice(0, Math.min(series.length, 10)).reduce((s, v) => s + v.value, 0) / Math.min(series.length, 10);
    const change = (recent - older) / Math.max(older, 1);
    trend = change > 0.1 ? "rising" : change < -0.1 ? "falling" : "stable";
  }

  return {
    heapUsedMb: Math.round(heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(heapTotal / 1024 / 1024),
    rssMb: Math.round(rss / 1024 / 1024),
    externalMb: Math.round(external / 1024 / 1024),
    trend,
  };
}

function summarizeDatabase(_snapshot: MetricSnapshot, _now: number): DatabaseSummary {
  const queriesTotal = getCounter("ouroboros_db_queries_total");
  const p95Ms = (getHistogramPercentile("ouroboros_db_query_duration_seconds", {}, 0.95) || 0) * 1000;
  const avgMs = estimateHistogramMean("ouroboros_db_query_duration_seconds", {}) * 1000;

  return {
    queriesTotal,
    queriesPerMinute: Math.round((queriesTotal / Math.max(process.uptime(), 1)) * 60),
    avgLatencyMs: Math.round(avgMs),
    p95LatencyMs: Math.round(p95Ms),
    slowQueries: 0, // TODO: track slow query counter
  };
}

function summarizeEvolution(_snapshot: MetricSnapshot, _now: number): EvolutionSummary {
  const proposalsTotal = getCounter("ouroboros_evolution_proposals_total");
  const appliedTotal = getCounter("ouroboros_evolution_applied_total");
  const successRate = proposalsTotal > 0 ? appliedTotal / proposalsTotal : 0;

  return {
    proposalsTotal,
    appliedTotal,
    pendingProposals: 0, // TODO: query proposal queue
    successRate: Math.round(successRate * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function generateAlerts(categories: {
  http: HttpSummary;
  llm: LlmSummary;
  skills: SkillsSummary;
  memory: MemorySummary;
  database: DatabaseSummary;
  evolution: EvolutionSummary;
}): Alert[] {
  const alerts: Alert[] = [];

  if (categories.http.errorRate > 0.05) {
    alerts.push({
      level: "warning",
      category: "http",
      message: `HTTP error rate elevated: ${(categories.http.errorRate * 100).toFixed(1)}%`,
      metric: "errorRate",
      value: categories.http.errorRate,
      threshold: 0.05,
    });
  }
  if (categories.http.p95LatencyMs > 5000) {
    alerts.push({
      level: "warning",
      category: "http",
      message: `HTTP P95 latency high: ${categories.http.p95LatencyMs}ms`,
      metric: "p95LatencyMs",
      value: categories.http.p95LatencyMs,
      threshold: 5000,
    });
  }
  if (categories.llm.p95LatencyMs > 30000) {
    alerts.push({
      level: "warning",
      category: "llm",
      message: `LLM P95 latency high: ${categories.llm.p95LatencyMs}ms`,
      metric: "p95LatencyMs",
      value: categories.llm.p95LatencyMs,
      threshold: 30000,
    });
  }
  if (categories.memory.heapUsedMb > 512) {
    alerts.push({
      level: categories.memory.heapUsedMb > 1024 ? "critical" : "warning",
      category: "memory",
      message: `Heap usage high: ${categories.memory.heapUsedMb}MB`,
      metric: "heapUsedMb",
      value: categories.memory.heapUsedMb,
      threshold: 512,
    });
  }
  if (categories.memory.trend === "rising" && categories.memory.heapUsedMb > 300) {
    alerts.push({
      level: "warning",
      category: "memory",
      message: `Memory usage trending up: ${categories.memory.heapUsedMb}MB`,
      metric: "heapTrend",
      value: categories.memory.heapUsedMb,
      threshold: 300,
    });
  }
  if (categories.skills.errorRate > 0.1) {
    alerts.push({
      level: "warning",
      category: "skills",
      message: `Skill error rate elevated: ${(categories.skills.errorRate * 100).toFixed(1)}%`,
      metric: "errorRate",
      value: categories.skills.errorRate,
      threshold: 0.1,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function generateTrends(snapshot: MetricSnapshot, now: number): Trend[] {
  const trends: Trend[] = [];
  const windowMs = 10 * 60 * 1000; // 10 min

  for (const g of snapshot.gauges) {
    if (g.series.length < 3) continue;
    const recent = g.series.filter((s) => s.timestamp > now - windowMs);
    if (recent.length < 2) continue;
    const olderAvg = g.series.filter((s) => s.timestamp <= now - windowMs).reduce((s, v) => s + v.value, 0) / Math.max(g.series.length - recent.length, 1);
    const recentAvg = recent.reduce((s, v) => s + v.value, 0) / recent.length;
    const change = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;

    trends.push({
      metric: g.name,
      direction: change > 0.05 ? "up" : change < -0.05 ? "down" : "flat",
      changePercent: Math.round(change * 1000) / 10,
      windowMinutes: 10,
    });
  }

  return trends.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

function computeHealthScore(
  categories: {
    http: HttpSummary;
    llm: LlmSummary;
    skills: SkillsSummary;
    memory: MemorySummary;
    database: DatabaseSummary;
    evolution: EvolutionSummary;
  },
  alerts: Alert[]
): number {
  let score = 100;

  // Deduct for latency
  if (categories.http.p95LatencyMs > 1000) score -= 5;
  if (categories.http.p95LatencyMs > 3000) score -= 10;
  if (categories.llm.p95LatencyMs > 10000) score -= 5;
  if (categories.llm.p95LatencyMs > 30000) score -= 10;

  // Deduct for errors
  if (categories.http.errorRate > 0.01) score -= 5;
  if (categories.http.errorRate > 0.05) score -= 10;
  if (categories.skills.errorRate > 0.05) score -= 5;
  if (categories.skills.errorRate > 0.1) score -= 10;

  // Deduct for memory
  if (categories.memory.heapUsedMb > 300) score -= 5;
  if (categories.memory.heapUsedMb > 512) score -= 10;
  if (categories.memory.heapUsedMb > 1024) score -= 20;

  // Deduct for alerts
  score -= alerts.filter((a) => a.level === "warning").length * 3;
  score -= alerts.filter((a) => a.level === "critical").length * 10;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateHistogramMean(name: string, labels: Record<string, string>): number {
  // Very rough estimate: assume uniform distribution within each bucket
  // For production, use actual observations if available
  const p50 = getHistogramPercentile(name, labels, 0.5);
  return p50 || 0;
}

let _processStartTime = 0;
function processStartTime(): number {
  if (_processStartTime === 0) {
    _processStartTime = Date.now() - process.uptime() * 1000;
  }
  return _processStartTime;
}
