/**
 * Telemetry v2 — Entry Point
 * ==========================
 * Exports the metrics registry, runtime dashboard, and auto-check.
 * Wires into the hook system for automatic metric collection.
 *
 * Usage:
 *   import { recordSkillCall, buildRuntimeSummary, runAutoCheck } from "./skills/telemetry-v2/index.ts";
 */

import { hookRegistry } from "../../core/hook-system.ts";
import { logger } from "../../core/logger.ts";
import {
  incCounter,
  observeHistogram,
  setGauge,
  registerBuiltinMetrics,
} from "./metrics-registry.ts";
import { scheduleAutoCheck, maybeTriggerEventCheck } from "./auto-check.ts";

export { incCounter, setGauge, observeHistogram, exportPrometheus, getAllMetrics } from "./metrics-registry.ts";
export { buildRuntimeSummary, type RuntimeSummary } from "./runtime-dashboard.ts";
export { runAutoCheck, scheduleAutoCheck, maybeTriggerEventCheck, type CheckupReport, type Finding, type Recommendation } from "./auto-check.ts";

// ---------------------------------------------------------------------------
// Automatic metric collection via hooks
// ---------------------------------------------------------------------------

let _scheduledCheckCleanup: (() => void) | null = null;
let _lastMemoryRecord = 0;

export function initTelemetryV2(): void {
  registerBuiltinMetrics();

  // Hook: agent:llmCall
  hookRegistry.register("agent:llmCall", (_event, ctx) => {
    if (ctx.latencyMs !== undefined) {
      observeHistogram("ouroboros_llm_latency_seconds", { provider: String(ctx.provider || "unknown") }, ctx.latencyMs / 1000);
    }
    if (ctx.tokens !== undefined) {
      incCounter("ouroboros_llm_tokens_total", { provider: String(ctx.provider || "unknown") }, ctx.tokens);
    }
    incCounter("ouroboros_llm_calls_total", { provider: String(ctx.provider || "unknown") });
  });

  // Hook: skill:execute
  hookRegistry.register("skill:execute", (_event, ctx) => {
    incCounter("ouroboros_skill_calls_total", { skill: String(ctx.skillName || "unknown") });
    if (ctx.success === false) {
      incCounter("ouroboros_skill_errors_total", { skill: String(ctx.skillName || "unknown") });
    }
    if (ctx.latencyMs !== undefined) {
      observeHistogram("ouroboros_skill_duration_seconds", { skill: String(ctx.skillName || "unknown") }, ctx.latencyMs / 1000);
    }
  });

  // Hook: agent:turnEnd
  hookRegistry.register("agent:turnEnd", (_event, ctx) => {
    if (ctx.success === false) {
      incCounter("ouroboros_turn_errors_total", { sessionId: String(ctx.sessionId || "unknown") });
    }
  });

  // Hook: evolution:proposed
  hookRegistry.register("evolution:proposed", () => {
    incCounter("ouroboros_evolution_proposals_total");
  });

  // Hook: evolution:executed
  hookRegistry.register("evolution:executed", () => {
    incCounter("ouroboros_evolution_applied_total");
  });

  // Hook: evolution:failed
  hookRegistry.register("evolution:failed", () => {
    incCounter("ouroboros_evolution_failed_total");
  });

  // Hook: session:create / session:close
  hookRegistry.register("session:create", () => {
    setGauge("ouroboros_active_sessions", {}, getActiveSessionEstimate());
  });
  hookRegistry.register("session:close", () => {
    setGauge("ouroboros_active_sessions", {}, getActiveSessionEstimate());
  });

  // Periodic: memory & uptime gauges
  setInterval(() => {
    const mem = process.memoryUsage();
    setGauge("ouroboros_memory_bytes", { type: "rss" }, mem.rss);
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, mem.heapUsed);
    setGauge("ouroboros_memory_bytes", { type: "heapTotal" }, mem.heapTotal);
    setGauge("ouroboros_memory_bytes", { type: "external" }, mem.external);
    setGauge("ouroboros_uptime_seconds", {}, process.uptime());

    _lastMemoryRecord = Date.now();

    // Event-driven auto-check trigger
    maybeTriggerEventCheck();
  }, 30_000);

  // Scheduled auto-check (daily)
  _scheduledCheckCleanup = scheduleAutoCheck(24 * 60 * 60 * 1000);

  logger.info("Telemetry v2 initialized", { hooks: 8, scheduledCheck: true });
}

export function shutdownTelemetryV2(): void {
  if (_scheduledCheckCleanup) {
    _scheduledCheckCleanup();
    _scheduledCheckCleanup = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActiveSessionEstimate(): number {
  // We don't have direct access to session count here without importing session-db,
  // which would create a circular dependency risk.  Use a simple heuristic:
  // track creates minus closes via a module-local counter.
  // For now, return 0 and let the health endpoint provide the real count.
  return 0;
}

// Convenience: record a skill call with automatic error tracking
export function recordSkillCall(skillName: string, latencyMs: number, success: boolean, meta?: Record<string, unknown>): void {
  const labels: Record<string, string> = { skill: skillName };
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        labels[k] = String(v);
      }
    }
  }
  incCounter("ouroboros_skill_calls_total", labels);
  if (!success) {
    incCounter("ouroboros_skill_errors_total", labels);
  }
  observeHistogram("ouroboros_skill_duration_seconds", labels, latencyMs / 1000);
}

// Convenience: record HTTP request (to be called from request handler)
export function recordHttpRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  const labels = { method, path: normalizePath(path), status: String(statusCode) };
  incCounter("ouroboros_requests_total", labels);
  observeHistogram("ouroboros_request_duration_seconds", labels, durationMs / 1000);
}

// Convenience: record DB query
export function recordDbQuery(backend: "sqlite" | "postgres", durationMs: number): void {
  incCounter("ouroboros_db_queries_total", { backend });
  observeHistogram("ouroboros_db_query_duration_seconds", { backend }, durationMs / 1000);
}

function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[a-f0-9]{16,}/gi, "/:hash")
    .replace(/\/\d+/g, "/:id");
}
