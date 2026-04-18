import type { IncomingMessage, ServerResponse } from "http";
import { logger } from "../../../core/logger.ts";
import { getLLMMetrics } from "../../../core/llm-metrics.ts";
import { getCircuitBreakerStates } from "../../../core/llm-resilience.ts";
import { getRunnerPoolStats } from "../../runner-pool.ts";
import { getWorkerRunnerStats } from "../../../skills/orchestrator/index.ts";
import { getWsClientCount, getWsConnectionsTotal } from "../../ws-server.ts";
import { MAX_METRIC_HISTOGRAM_KEYS } from "../constants.ts";
import type { ReqContext } from "./context.ts";
import { getClientIp } from "./context.ts";
import type { TaskScheduler } from "../../../skills/task-scheduler/index.ts";

const requestCounter = new Map<string, number>();
const requestDurationHistogram = new Map<string, number>();
const requestDurationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MAX_METRIC_COUNTER_KEYS = 2_000;

function normalizeMetricPath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[a-f0-9]{16,}/gi, "/:hash")
    .replace(/\/\d+/g, "/:id");
}

function pruneMetricsIfNeeded() {
  if (requestCounter.size > MAX_METRIC_COUNTER_KEYS) {
    requestCounter.clear();
  }
  if (requestDurationHistogram.size > MAX_METRIC_HISTOGRAM_KEYS) {
    requestDurationHistogram.clear();
  }
}

function incCounter(name: string, labels: Record<string, string>, value = 1) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  const key = `${name}{${labelStr}}`;
  requestCounter.set(key, (requestCounter.get(key) || 0) + value);
}

function observeHistogram(name: string, labels: Record<string, string>, value: number) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  for (const bucket of requestDurationBuckets) {
    const key = `${name}_bucket{le="${bucket}",${labelStr}}`;
    if (value <= bucket) {
      requestDurationHistogram.set(key, (requestDurationHistogram.get(key) || 0) + 1);
    }
  }
  const infKey = `${name}_bucket{le="+Inf",${labelStr}}`;
  requestDurationHistogram.set(infKey, (requestDurationHistogram.get(infKey) || 0) + 1);
}

export function recordRequestMetrics(method: string, path: string, statusCode: number, durationSec: number) {
  pruneMetricsIfNeeded();
  const labels = { method: method || "GET", path: normalizeMetricPath(path || "/"), status: String(statusCode) };
  incCounter("http_requests_total", labels);
  observeHistogram("http_request_duration_seconds", labels, durationSec);
}

export async function getPrometheusMetrics(taskScheduler?: TaskScheduler): Promise<string> {
  const lines: string[] = [];
  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, value] of requestCounter) {
    lines.push(`${key} ${value}`);
  }
  lines.push("# HELP http_request_duration_seconds HTTP request duration");
  lines.push("# TYPE http_request_duration_seconds histogram");
  for (const [key, value] of requestDurationHistogram) {
    lines.push(`${key} ${value}`);
  }
  lines.push("# HELP active_runners Active agent runners");
  lines.push("# TYPE active_runners gauge");
  lines.push(`active_runners ${getRunnerPoolStats().size}`);
  lines.push("# HELP runner_pool_size Runner pool size");
  lines.push("# TYPE runner_pool_size gauge");
  lines.push(`runner_pool_size ${getRunnerPoolStats().size}`);
  lines.push("# HELP ws_clients Active WebSocket clients");
  lines.push("# TYPE ws_clients gauge");
  lines.push(`ws_clients ${getWsClientCount()}`);
  lines.push("# HELP ws_connections_total Total WebSocket connections accepted");
  lines.push("# TYPE ws_connections_total counter");
  lines.push(`ws_connections_total ${getWsConnectionsTotal()}`);
  const llmMetrics = getLLMMetrics();
  lines.push("# HELP llm_latency_ms Average LLM latency in milliseconds");
  lines.push("# TYPE llm_latency_ms gauge");
  lines.push(`llm_latency_ms ${llmMetrics.averageLatencyMs}`);
  lines.push("# HELP llm_p95_latency_ms P95 LLM latency in milliseconds");
  lines.push("# TYPE llm_p95_latency_ms gauge");
  lines.push(`llm_p95_latency_ms ${llmMetrics.p95LatencyMs}`);
  lines.push("# HELP llm_calls_total Total LLM calls recorded");
  lines.push("# TYPE llm_calls_total gauge");
  lines.push(`llm_calls_total ${llmMetrics.callCount}`);
  lines.push("# HELP llm_total_tokens Total LLM tokens consumed");
  lines.push("# TYPE llm_total_tokens gauge");
  lines.push(`llm_total_tokens ${llmMetrics.totalTokens}`);
  const workerStats = getWorkerRunnerStats();
  lines.push("# HELP active_workers Active worker agents");
  lines.push("# TYPE active_workers gauge");
  lines.push(`active_workers ${workerStats.activeWorkers}`);
  lines.push("# HELP queued_workers Worker agents waiting for concurrency slot");
  lines.push("# TYPE queued_workers gauge");
  lines.push(`queued_workers ${workerStats.queuedWorkers}`);

  const queueStats = taskScheduler?.getQueueStats ? await taskScheduler.getQueueStats() : null;
  if (queueStats) {
    lines.push("# HELP ouroboros_task_queue_pending Number of pending tasks in queue");
    lines.push("# TYPE ouroboros_task_queue_pending gauge");
    lines.push(`ouroboros_task_queue_pending ${queueStats.pending}`);
    lines.push("# HELP ouroboros_task_queue_failed Number of failed tasks in queue");
    lines.push("# TYPE ouroboros_task_queue_failed gauge");
    lines.push(`ouroboros_task_queue_failed ${queueStats.failed}`);
    lines.push("# HELP ouroboros_task_queue_delayed Number of delayed tasks in queue");
    lines.push("# TYPE ouroboros_task_queue_delayed gauge");
    lines.push(`ouroboros_task_queue_delayed ${queueStats.delayed}`);
  }

  const cbStates = getCircuitBreakerStates();
  lines.push("# HELP ouroboros_circuit_breaker_state Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)");
  lines.push("# TYPE ouroboros_circuit_breaker_state gauge");
  for (const cb of cbStates) {
    const stateValue = cb.state === "OPEN" ? 1 : cb.state === "HALF_OPEN" ? 2 : 0;
    lines.push(`ouroboros_circuit_breaker_state{provider="${cb.provider}"} ${stateValue}`);
  }

  return lines.join("\n") + "\n";
}

export function logRequest(req: IncomingMessage, res: ServerResponse, ctx: ReqContext, path: string, durationMs: number) {
  logger.info("HTTP request", {
    requestId: ctx.requestId,
    method: req.method,
    path,
    status: res.statusCode || 200,
    durationMs,
    clientIp: getClientIp(req),
  });
}

export { requestCounter, requestDurationHistogram, requestDurationBuckets, MAX_METRIC_COUNTER_KEYS };
