/**
 * Evolution Observability v8.1
 * =============================
 * Webhook notifications, WebSocket real-time push, and Prometheus-style metrics
 * for the evolution pipeline.
 */

import { hookRegistry } from "../../core/hook-system.ts";
import { logger } from "../../core/logger.ts";
import { notificationBus } from "../notification/index.ts";
import { getDb } from "../../core/db-manager.ts";

// =============================================================================
// Types
// =============================================================================

export interface EvolutionWebhookTarget {
  url: string;
  eventTypes: string[]; // e.g. ["evolution:executed", "evolution:failed"]
  secret?: string;
  headers?: Record<string, string>;
}

export interface EvolutionMetricsSnapshot {
  totalProposed: number;
  totalExecuted: number;
  totalFailed: number;
  totalRolledBack: number;
  avgExecutionTimeMs: number;
  pendingApprovals: number;
  activeExecutions: number;
}

// =============================================================================
// In-memory metrics (Prometheus-style counters & gauges)
// =============================================================================

const counters = {
  proposed: 0,
  approved: 0,
  executed: 0,
  failed: 0,
  rolledBack: 0,
};

const executionTimes: number[] = [];
let activeExecutions = 0;

function recordExecutionTime(durationMs: number): void {
  executionTimes.push(durationMs);
  if (executionTimes.length > 1000) executionTimes.shift();
}

function avgExecutionTime(): number {
  if (executionTimes.length === 0) return 0;
  return executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
}

// =============================================================================
// Webhook delivery
// =============================================================================

async function deliverWebhook(target: EvolutionWebhookTarget, payload: unknown): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...target.headers,
    };
    if (target.secret) {
      const { createHmac } = await import("crypto");
      const sig = createHmac("sha256", target.secret).update(JSON.stringify(payload)).digest("hex");
      headers["X-Evolution-Signature"] = `sha256=${sig}`;
    }

    const res = await fetch(target.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      logger.warn("Webhook delivery failed", { url: target.url, status: res.status });
    }
  } catch (e) {
    logger.warn("Webhook delivery error", { url: target.url, error: String(e) });
  }
}

// =============================================================================
// Public API
// =============================================================================

export function getEvolutionMetricsSnapshot(): EvolutionMetricsSnapshot {
  const db = getDb();
  let pendingApprovals = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM evolution_approvals WHERE resolved_at IS NULL").get() as { c: number } | undefined;
    pendingApprovals = row?.c ?? 0;
  } catch {
    // table may not exist in all contexts
  }

  return {
    totalProposed: counters.proposed,
    totalExecuted: counters.executed,
    totalFailed: counters.failed,
    totalRolledBack: counters.rolledBack,
    avgExecutionTimeMs: Math.round(avgExecutionTime()),
    pendingApprovals,
    activeExecutions,
  };
}

export function formatPrometheusMetrics(): string {
  const snap = getEvolutionMetricsSnapshot();
  const lines: string[] = [
    "# HELP evolution_total_proposed Total number of proposed evolutions",
    "# TYPE evolution_total_proposed counter",
    `evolution_total_proposed ${snap.totalProposed}`,
    "# HELP evolution_total_executed Total number of executed evolutions",
    "# TYPE evolution_total_executed counter",
    `evolution_total_executed ${snap.totalExecuted}`,
    "# HELP evolution_total_failed Total number of failed evolutions",
    "# TYPE evolution_total_failed counter",
    `evolution_total_failed ${snap.totalFailed}`,
    "# HELP evolution_total_rolledback Total number of rolled-back evolutions",
    "# TYPE evolution_total_rolledback counter",
    `evolution_total_rolledback ${snap.totalRolledBack}`,
    "# HELP evolution_avg_execution_time_ms Average execution time in milliseconds",
    "# TYPE evolution_avg_execution_time_ms gauge",
    `evolution_avg_execution_time_ms ${snap.avgExecutionTimeMs}`,
    "# HELP evolution_pending_approvals Number of pending approvals",
    "# TYPE evolution_pending_approvals gauge",
    `evolution_pending_approvals ${snap.pendingApprovals}`,
    "# HELP evolution_active_executions Number of currently active executions",
    "# TYPE evolution_active_executions gauge",
    `evolution_active_executions ${snap.activeExecutions}`,
  ];
  return lines.join("\n") + "\n";
}

export function recordEvolutionEvent(eventType: string, ctx: Record<string, unknown>): void {
  const startTs = ctx.startedAt as number | undefined;
  const endTs = ctx.completedAt as number | undefined;

  switch (eventType) {
    case "evolution:proposed":
      counters.proposed++;
      break;
    case "evolution:approved":
      counters.approved++;
      break;
    case "evolution:executed":
      if (ctx.status === "started") {
        activeExecutions++;
      } else if (ctx.status === "completed") {
        counters.executed++;
        activeExecutions = Math.max(0, activeExecutions - 1);
        if (typeof startTs === "number" && typeof endTs === "number") {
          recordExecutionTime(endTs - startTs);
        }
      }
      break;
    case "evolution:failed":
      counters.failed++;
      activeExecutions = Math.max(0, activeExecutions - 1);
      break;
    case "evolution:rolledBack":
      counters.rolledBack++;
      break;
  }

  // Push to notification bus for WebSocket broadcast
  notificationBus.emitEvent({
    type: "system",
    title: `Evolution ${eventType}`,
    message: typeof ctx.message === "string" ? ctx.message : JSON.stringify(ctx),
    timestamp: Date.now(),
    meta: { eventType, ...ctx },
  });
}

/** Reset all in-memory counters (useful for testing). */
export function resetEvolutionMetrics(): void {
  counters.proposed = 0;
  counters.approved = 0;
  counters.executed = 0;
  counters.failed = 0;
  counters.rolledBack = 0;
  executionTimes.length = 0;
  activeExecutions = 0;
}

/**
 * Register observability hooks. Call once at startup.
 */
export function registerEvolutionObservability(targets?: EvolutionWebhookTarget[]): void {
  const webhookTargets = targets ?? [];

  const events = ["evolution:proposed", "evolution:approved", "evolution:executed", "evolution:failed", "evolution:rolledBack"];

  for (const event of events) {
    hookRegistry.register(event as any, async (_evt, context) => {
      const ctx = context as Record<string, unknown>;
      recordEvolutionEvent(event, ctx);

      // Deliver webhooks for matching targets
      const payload = { event, timestamp: Date.now(), data: ctx };
      for (const target of webhookTargets) {
        if (target.eventTypes.includes(event) || target.eventTypes.includes("*")) {
          await deliverWebhook(target, payload);
        }
      }
    });
  }

  logger.info("Evolution Observability v8.1 registered", { webhookTargets: webhookTargets.length });
}
