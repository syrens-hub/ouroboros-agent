/**
 * Resilience Engine v2
 * =====================
 * System health monitoring, tool degradation strategies, and self-diagnosis.
 * Builds on top of llm-resilience.ts to provide holistic resilience coverage
 * for the entire agent system (LLM, tools, database, disk, memory).
 *
 * Integrates with telemetry-v2 for automatic metric collection.
 */

import { logger } from "./logger.ts";
import { getDb } from "./db-manager.ts";
import { hookRegistry } from "./hook-system.ts";
import { incCounter, setGauge, observeHistogram } from "../skills/telemetry-v2/metrics-registry.ts";
import { safeFailOpen } from "./safe-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComponentType = "llm" | "tool" | "database" | "disk" | "memory" | "network" | "bridge";
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthSnapshot {
  component: ComponentType;
  name: string;
  status: HealthStatus;
  lastCheckAt: number;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  message?: string;
}

export interface DegradationStrategy {
  type: "retry" | "fallback" | "skip" | "throttle" | "circuit_break";
  config: Record<string, unknown>;
}

export interface DegradationRule {
  componentType: ComponentType;
  componentName?: string;
  trigger: { consecutiveFailures: number; errorPattern?: string };
  strategy: DegradationStrategy;
  cooldownMs: number;
}

export interface DiagnosisReport {
  generatedAt: number;
  overallHealth: HealthStatus;
  components: HealthSnapshot[];
  findings: DiagnosisFinding[];
  recommendations: string[];
}

export interface DiagnosisFinding {
  severity: "critical" | "warning" | "info";
  component: ComponentType;
  message: string;
  metric?: string;
  value?: number;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export function initResilienceTables(db = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resilience_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      message TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resilience_health_component ON resilience_health_log(component, name);
    CREATE INDEX IF NOT EXISTS idx_resilience_health_timestamp ON resilience_health_log(timestamp DESC);

    CREATE TABLE IF NOT EXISTS resilience_degradation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component TEXT NOT NULL,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      resolved_at INTEGER,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resilience_degradation_timestamp ON resilience_degradation_log(timestamp DESC);
  `);
}

function logHealthEvent(
  db: ReturnType<typeof getDb>,
  component: ComponentType,
  name: string,
  status: HealthStatus,
  latencyMs?: number,
  message?: string
): void {
  safeFailOpen(() => {
    db.prepare(
      `INSERT INTO resilience_health_log (component, name, status, latency_ms, message, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(component, name, status, latencyMs ?? null, message ?? null, Date.now());
  }, "logHealthEvent", undefined);
}

function logDegradationEvent(
  db: ReturnType<typeof getDb>,
  component: ComponentType,
  name: string,
  strategy: string,
  triggeredBy: string
): void {
  safeFailOpen(() => {
    db.prepare(
      `INSERT INTO resilience_degradation_log (component, name, strategy, triggered_by, timestamp)
       VALUES (?, ?, ?, ?, ?)`
    ).run(component, name, strategy, triggeredBy, Date.now());
  }, "logDegradationEvent", undefined);
}

// ---------------------------------------------------------------------------
// Health Monitor
// ---------------------------------------------------------------------------

class ComponentHealthTracker {
  status: HealthStatus = "unknown";
  lastCheckAt = 0;
  failureCount = 0;
  successCount = 0;
  consecutiveFailures = 0;
  latencies: number[] = [];
  message?: string;

  recordSuccess(latencyMs: number): void {
    this.status = "healthy";
    this.lastCheckAt = Date.now();
    this.successCount++;
    this.consecutiveFailures = 0;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 50) this.latencies.shift();
    this.message = undefined;
  }

  recordFailure(message?: string): void {
    this.status = "unhealthy";
    this.lastCheckAt = Date.now();
    this.failureCount++;
    this.consecutiveFailures++;
    this.message = message;
  }

  recordDegraded(message?: string): void {
    this.status = "degraded";
    this.lastCheckAt = Date.now();
    this.message = message;
  }

  getAvgLatency(): number {
    if (this.latencies.length === 0) return 0;
    return Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length);
  }

  toSnapshot(component: ComponentType, name: string): HealthSnapshot {
    return {
      component,
      name,
      status: this.status,
      lastCheckAt: this.lastCheckAt,
      failureCount: this.failureCount,
      successCount: this.successCount,
      consecutiveFailures: this.consecutiveFailures,
      avgLatencyMs: this.getAvgLatency(),
      message: this.message,
    };
  }
}

const healthTrackers = new Map<string, ComponentHealthTracker>();

function trackerKey(component: ComponentType, name: string): string {
  return `${component}:${name}`;
}

function getTracker(component: ComponentType, name: string): ComponentHealthTracker {
  const key = trackerKey(component, name);
  if (!healthTrackers.has(key)) {
    healthTrackers.set(key, new ComponentHealthTracker());
  }
  return healthTrackers.get(key)!;
}

/** Record a successful health check for a component. */
export function recordHealthSuccess(component: ComponentType, name: string, latencyMs: number): void {
  const tracker = getTracker(component, name);
  tracker.recordSuccess(latencyMs);
  logHealthEvent(getDb(), component, name, "healthy", latencyMs);
  setGauge("ouroboros_component_health", { component, name }, 1);
  observeHistogram("ouroboros_component_latency_ms", { component, name }, latencyMs);
}

/** Record a failed health check for a component. */
export function recordHealthFailure(component: ComponentType, name: string, message?: string): void {
  const tracker = getTracker(component, name);
  tracker.recordFailure(message);
  logHealthEvent(getDb(), component, name, "unhealthy", undefined, message);
  setGauge("ouroboros_component_health", { component, name }, 0);
  incCounter("ouroboros_component_failures_total", { component, name });
}

/** Record a degraded health check for a component. */
export function recordHealthDegraded(component: ComponentType, name: string, message?: string): void {
  const tracker = getTracker(component, name);
  tracker.recordDegraded(message);
  logHealthEvent(getDb(), component, name, "degraded", undefined, message);
  setGauge("ouroboros_component_health", { component, name }, 0.5);
  incCounter("ouroboros_component_degraded_total", { component, name });
}

/** Get snapshot of all tracked components or a specific one. */
export function getHealthSnapshot(component?: ComponentType, name?: string): HealthSnapshot[] {
  if (component && name) {
    const tracker = healthTrackers.get(trackerKey(component, name));
    return tracker ? [tracker.toSnapshot(component, name)] : [];
  }
  const results: HealthSnapshot[] = [];
  for (const [key, tracker] of healthTrackers) {
    const [c, n] = key.split(":");
    if (!component || c === component) {
      results.push(tracker.toSnapshot(c as ComponentType, n));
    }
  }
  return results;
}

/** Get overall system health — the worst of all components. */
export function getOverallHealth(): HealthStatus {
  const snaps = getHealthSnapshot();
  if (snaps.length === 0) return "unknown";
  let worst: HealthStatus = "healthy";
  const priority: Record<HealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unhealthy: 3 };
  for (const snap of snaps) {
    if (priority[snap.status] > priority[worst]) {
      worst = snap.status;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Tool Degradation Manager
// ---------------------------------------------------------------------------

const DEFAULT_DEGRADATION_RULES: DegradationRule[] = [
  {
    componentType: "llm",
    trigger: { consecutiveFailures: 3 },
    strategy: { type: "circuit_break", config: { timeoutMs: 30_000 } },
    cooldownMs: 60_000,
  },
  {
    componentType: "tool",
    trigger: { consecutiveFailures: 2 },
    strategy: { type: "retry", config: { maxRetries: 2, backoffMs: 1000 } },
    cooldownMs: 10_000,
  },
  {
    componentType: "database",
    trigger: { consecutiveFailures: 2 },
    strategy: { type: "throttle", config: { maxQps: 1 } },
    cooldownMs: 30_000,
  },
];

const activeDegradations = new Map<string, { strategy: DegradationStrategy; triggeredAt: number; rule: DegradationRule }>();
const lastTriggerTime = new Map<string, number>();

function degradationKey(component: ComponentType, name: string): string {
  return `${component}:${name}`;
}

/** Register custom degradation rules (replaces defaults). */
export function setDegradationRules(rules: DegradationRule[]): void {
  _customRules = rules;
}

let _customRules: DegradationRule[] | null = null;

function getRules(): DegradationRule[] {
  return _customRules ?? DEFAULT_DEGRADATION_RULES;
}

/** Evaluate whether a component should trigger degradation. */
export function evaluateDegradation(component: ComponentType, name: string): DegradationStrategy | null {
  const tracker = getTracker(component, name);
  const key = degradationKey(component, name);
  const now = Date.now();

  // Cooldown check
  const lastTrigger = lastTriggerTime.get(key);
  if (lastTrigger !== undefined) {
    const active = activeDegradations.get(key);
    if (active && now - lastTrigger < active.rule.cooldownMs) {
      return active.strategy;
    }
    // Cooldown expired — clear
    if (active && now - lastTrigger >= active.rule.cooldownMs) {
      activeDegradations.delete(key);
    }
  }

  for (const rule of getRules()) {
    if (rule.componentType !== component) continue;
    if (rule.componentName && rule.componentName !== name) continue;

    if (tracker.consecutiveFailures >= rule.trigger.consecutiveFailures) {
      if (lastTrigger && now - lastTrigger < rule.cooldownMs) {
        continue; // Still in cooldown
      }

      lastTriggerTime.set(key, now);
      activeDegradations.set(key, { strategy: rule.strategy, triggeredAt: now, rule });
      logDegradationEvent(getDb(), component, name, rule.strategy.type, `consecutiveFailures=${tracker.consecutiveFailures}`);
      incCounter("ouroboros_degradations_triggered_total", { component, name, strategy: rule.strategy.type });
      logger.warn("Degradation triggered", { component, name, strategy: rule.strategy.type });
      return rule.strategy;
    }
  }

  return null;
}

/** Clear active degradation for a component (e.g. after recovery). */
export function clearDegradation(component: ComponentType, name: string): void {
  const key = degradationKey(component, name);
  activeDegradations.delete(key);
  lastTriggerTime.delete(key);
}

/** Get currently active degradations. */
export function getActiveDegradations(): Array<{
  component: ComponentType;
  name: string;
  strategy: DegradationStrategy;
  triggeredAt: number;
}> {
  const results: Array<{ component: ComponentType; name: string; strategy: DegradationStrategy; triggeredAt: number }> = [];
  for (const [key, active] of activeDegradations) {
    const [component, name] = key.split(":");
    results.push({
      component: component as ComponentType,
      name,
      strategy: active.strategy,
      triggeredAt: active.triggeredAt,
    });
  }
  return results;
}

/** Check if a component is currently under degradation. */
export function isDegraded(component: ComponentType, name: string): boolean {
  return activeDegradations.has(degradationKey(component, name));
}

// ---------------------------------------------------------------------------
// Self-Diagnosis Engine
// ---------------------------------------------------------------------------

function diagnoseComponent(snap: HealthSnapshot): DiagnosisFinding[] {
  const findings: DiagnosisFinding[] = [];

  if (snap.status === "unhealthy") {
    findings.push({
      severity: "critical",
      component: snap.component,
      message: `${snap.name} is unhealthy: ${snap.message || "no message"}`,
    });
  } else if (snap.status === "degraded") {
    findings.push({
      severity: "warning",
      component: snap.component,
      message: `${snap.name} is degraded: ${snap.message || "no message"}`,
    });
  }

  if (snap.consecutiveFailures >= 3) {
    findings.push({
      severity: "critical",
      component: snap.component,
      message: `${snap.name} has ${snap.consecutiveFailures} consecutive failures`,
      metric: "consecutiveFailures",
      value: snap.consecutiveFailures,
    });
  } else if (snap.consecutiveFailures >= 1) {
    findings.push({
      severity: "warning",
      component: snap.component,
      message: `${snap.name} has ${snap.consecutiveFailures} consecutive failures`,
      metric: "consecutiveFailures",
      value: snap.consecutiveFailures,
    });
  }

  if (snap.avgLatencyMs > 5000) {
    findings.push({
      severity: "warning",
      component: snap.component,
      message: `${snap.name} average latency is ${snap.avgLatencyMs}ms (>5s)`,
      metric: "avgLatencyMs",
      value: snap.avgLatencyMs,
    });
  }

  const total = snap.successCount + snap.failureCount;
  if (total >= 10) {
    const errorRate = snap.failureCount / total;
    if (errorRate > 0.5) {
      findings.push({
        severity: "critical",
        component: snap.component,
        message: `${snap.name} error rate is ${(errorRate * 100).toFixed(1)}%`,
        metric: "errorRate",
        value: errorRate,
      });
    } else if (errorRate > 0.2) {
      findings.push({
        severity: "warning",
        component: snap.component,
        message: `${snap.name} error rate is ${(errorRate * 100).toFixed(1)}%`,
        metric: "errorRate",
        value: errorRate,
      });
    }
  }

  return findings;
}

/** Run a full self-diagnosis and return a report. */
export function runSelfDiagnosis(): DiagnosisReport {
  const snapshots = getHealthSnapshot();
  const findings: DiagnosisFinding[] = [];
  const recommendations: string[] = [];

  for (const snap of snapshots) {
    findings.push(...diagnoseComponent(snap));
  }

  // Active degradations
  const degradations = getActiveDegradations();
  for (const deg of degradations) {
    findings.push({
      severity: "warning",
      component: deg.component,
      message: `${deg.name} is under ${deg.strategy.type} degradation`,
    });
  }

  // Generate recommendations
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasUnhealthyLLM = snapshots.some((s) => s.component === "llm" && s.status === "unhealthy");
  const hasUnhealthyDB = snapshots.some((s) => s.component === "database" && s.status === "unhealthy");
  const hasHighErrorRate = findings.some((f) => f.metric === "errorRate" && (f.value ?? 0) > 0.5);

  if (hasUnhealthyLLM) {
    recommendations.push("Check LLM provider API key and network connectivity. Consider enabling fallback LLM.");
  }
  if (hasUnhealthyDB) {
    recommendations.push("Check database connectivity. Verify disk space and connection pool settings.");
  }
  if (hasHighErrorRate) {
    recommendations.push("Review recent error logs. Consider increasing retry limits or enabling circuit breaker.");
  }
  if (degradations.length > 0) {
    recommendations.push("Review active degradations. Verify if root causes have been resolved.");
  }
  if (!hasCritical && degradations.length === 0) {
    recommendations.push("System is operating normally. Continue monitoring.");
  }

  const overallHealth = getOverallHealth();

  const report: DiagnosisReport = {
    generatedAt: Date.now(),
    overallHealth,
    components: snapshots,
    findings,
    recommendations,
  };

  incCounter("ouroboros_self_diagnosis_runs_total", { health: overallHealth });
  return report;
}

// ---------------------------------------------------------------------------
// Scheduled Health Checks
// ---------------------------------------------------------------------------

export interface HealthChecker {
  component: ComponentType;
  name: string;
  check(): Promise<{ healthy: boolean; latencyMs: number; message?: string }>;
}

const healthCheckers: HealthChecker[] = [];

export function registerHealthChecker(checker: HealthChecker): void {
  healthCheckers.push(checker);
}

export function unregisterHealthChecker(component: ComponentType, name: string): void {
  const idx = healthCheckers.findIndex((c) => c.component === component && c.name === name);
  if (idx >= 0) healthCheckers.splice(idx, 1);
}

let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export async function runHealthChecks(): Promise<void> {
  for (const checker of healthCheckers) {
    try {
      const result = await checker.check();
      if (result.healthy) {
        recordHealthSuccess(checker.component, checker.name, result.latencyMs);
      } else {
        recordHealthFailure(checker.component, checker.name, result.message);
        evaluateDegradation(checker.component, checker.name);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordHealthFailure(checker.component, checker.name, msg);
      evaluateDegradation(checker.component, checker.name);
    }
  }
}

export function startScheduledHealthChecks(intervalMs = 30_000): () => void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
  }
  _healthCheckInterval = setInterval(() => {
    runHealthChecks().catch((e) => logger.error("Health check batch failed", { error: String(e) }));
  }, intervalMs);
  return () => {
    if (_healthCheckInterval) {
      clearInterval(_healthCheckInterval);
      _healthCheckInterval = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Query Recent Health / Degradation History
// ---------------------------------------------------------------------------

export function getRecentHealthEvents(
  component?: ComponentType,
  name?: string,
  limit = 50
): Array<{
  id: number;
  component: string;
  name: string;
  status: string;
  latency_ms: number | null;
  message: string | null;
  timestamp: number;
}> {
  const db = getDb();
  if (component && name) {
    return rowsAs(
      db.prepare(
        `SELECT * FROM resilience_health_log WHERE component = ? AND name = ? ORDER BY timestamp DESC LIMIT ?`
      ).all(component, name, limit)
    );
  }
  if (component) {
    return rowsAs(
      db.prepare(`SELECT * FROM resilience_health_log WHERE component = ? ORDER BY timestamp DESC LIMIT ?`).all(component, limit)
    );
  }
  return rowsAs(db.prepare(`SELECT * FROM resilience_health_log ORDER BY timestamp DESC LIMIT ?`).all(limit));
}

export function getRecentDegradationEvents(limit = 50): Array<{
  id: number;
  component: string;
  name: string;
  strategy: string;
  triggered_by: string;
  resolved_at: number | null;
  timestamp: number;
}> {
  const db = getDb();
  return rowsAs(db.prepare(`SELECT * FROM resilience_degradation_log ORDER BY timestamp DESC LIMIT ?`).all(limit));
}

export function pruneResilienceLogs(olderThanMs: number): { healthDeleted: number; degradationDeleted: number } {
  const db = getDb();
  const cutoff = Date.now() - olderThanMs;
  const healthDeleted = rowCount(db.prepare("DELETE FROM resilience_health_log WHERE timestamp < ?").run(cutoff));
  const degradationDeleted = rowCount(db.prepare("DELETE FROM resilience_degradation_log WHERE timestamp < ?").run(cutoff));
  return { healthDeleted, degradationDeleted };
}

// ---------------------------------------------------------------------------
// Hook Integration
// ---------------------------------------------------------------------------

export function initResilienceHooks(): void {
  // Auto-record tool call outcomes for health tracking
  hookRegistry.register("agent:toolCall", (_event, ctx) => {
    const toolName = ctx.toolName ?? "unknown";
    const success = ctx.success ?? false;
    const latencyMs = ctx.latencyMs ?? 0;
    if (success) {
      recordHealthSuccess("tool", toolName, latencyMs);
      if (isDegraded("tool", toolName)) {
        clearDegradation("tool", toolName);
      }
    } else {
      recordHealthFailure("tool", toolName, ctx.error as string);
      evaluateDegradation("tool", toolName);
    }
  });

  // Auto-record LLM call outcomes
  hookRegistry.register("agent:llmCall", (_event, ctx) => {
    const provider = (ctx.provider as string) ?? "unknown";
    const model = (ctx.model as string) ?? "unknown";
    const name = `${provider}/${model}`;
    const success = ctx.success ?? false;
    const latencyMs = ctx.latencyMs ?? 0;
    if (success) {
      recordHealthSuccess("llm", name, latencyMs);
      if (isDegraded("llm", name)) {
        clearDegradation("llm", name);
      }
    } else {
      recordHealthFailure("llm", name, ctx.error as string);
      evaluateDegradation("llm", name);
    }
  });
}

// ---------------------------------------------------------------------------
// Init / Shutdown
// ---------------------------------------------------------------------------

let _healthCheckCleanup: (() => void) | null = null;

/** Reset all internal state — intended for testing only. */
export function _resetResilienceState(): void {
  healthTrackers.clear();
  activeDegradations.clear();
  lastTriggerTime.clear();
}

export function initResilienceV2(): void {
  initResilienceTables();
  initResilienceHooks();
  _healthCheckCleanup = startScheduledHealthChecks(30_000);
  logger.info("Resilience v2 initialized");
}

export function shutdownResilienceV2(): void {
  if (_healthCheckCleanup) {
    _healthCheckCleanup();
    _healthCheckCleanup = null;
  }
}

// Import helpers at bottom to avoid circular import issues with db-utils
import { rowsAs, rowCount } from "./db-utils.ts";
