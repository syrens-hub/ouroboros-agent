/**
 * Telemetry v2 — Metrics Registry
 * =================================
 * In-memory metric store with Prometheus text-format export.
 * Designed for Agent self-observation: lightweight, zero external deps,
 * and consumable by auto-evolve for improvement proposals.
 *
 * Metric types:
 *   - counter: monotonically increasing (e.g. requests_total)
 *   - gauge: point-in-time value (e.g. memory_bytes)
 *   - histogram: bucketed observations (e.g. request_duration_seconds)
 *
 * Time-series retention: last 1h of gauge samples, last 10k histogram observations.
 */

import { logger } from "../../core/logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricValue {
  labels: Record<string, string>;
  value: number;
  timestamp: number;
}

export interface HistogramBucket {
  le: number; // less-than-or-equal bucket boundary
  count: number;
}

export interface HistogramValue {
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: HistogramBucket[];
  timestamp: number;
}

interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  unit?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GAUGE_RETENTION_MS = 60 * 60 * 1000; // 1 hour
const MAX_HISTOGRAM_OBSERVATIONS = 10_000;
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// ---------------------------------------------------------------------------
// Registry State
// ---------------------------------------------------------------------------

const definitions = new Map<string, MetricDefinition>();
const counters = new Map<string, number>(); // key = name{label="value",...}
const gauges = new Map<string, MetricValue[]>(); // key = name{labels} → time series
const histograms = new Map<string, HistogramValue>(); // key = name{labels}
const histogramObservations = new Map<string, number[]>(); // raw observations for p99 etc.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",") + "}";
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function fullKey(name: string, labels: Record<string, string>): string {
  return name + labelKey(labels);
}

function pruneGauges(series: MetricValue[]): MetricValue[] {
  const cutoff = Date.now() - GAUGE_RETENTION_MS;
  return series.filter((s) => s.timestamp >= cutoff);
}

function pruneObservations(obs: number[]): number[] {
  if (obs.length <= MAX_HISTOGRAM_OBSERVATIONS) return obs;
  // Keep most recent; for a rolling window we could use reservoir sampling,
  // but simplicity wins: drop oldest 20%.
  const drop = Math.floor(obs.length * 0.2);
  return obs.slice(drop);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMetric(name: string, type: MetricType, help: string, unit?: string): void {
  if (definitions.has(name)) {
    const existing = definitions.get(name)!;
    if (existing.type !== type) {
      logger.warn("Metric re-registered with different type", { name, oldType: existing.type, newType: type });
    }
    return;
  }
  definitions.set(name, { name, type, help, unit });
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export function incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
  if (!definitions.has(name)) {
    registerMetric(name, "counter", name);
  }
  const key = fullKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
  if (!definitions.has(name)) {
    registerMetric(name, "gauge", name);
  }
  const key = fullKey(name, labels);
  const series = gauges.get(key) || [];
  series.push({ labels, value, timestamp: Date.now() });
  gauges.set(key, pruneGauges(series));
}

export function observeHistogram(
  name: string,
  labels: Record<string, string> = {},
  value: number,
  buckets: number[] = DEFAULT_BUCKETS
): void {
  if (!definitions.has(name)) {
    registerMetric(name, "histogram", name);
  }
  const key = fullKey(name, labels);
  let h = histograms.get(key);
  if (!h) {
    h = {
      labels,
      sum: 0,
      count: 0,
      buckets: buckets.map((b) => ({ le: b, count: 0 })),
      timestamp: Date.now(),
    };
    histograms.set(key, h);
    histogramObservations.set(key, []);
  }

  h.sum += value;
  h.count += 1;
  h.timestamp = Date.now();

  for (const bucket of h.buckets) {
    if (value <= bucket.le) {
      bucket.count += 1;
    }
  }

  const obs = histogramObservations.get(key)!;
  obs.push(value);
  histogramObservations.set(key, pruneObservations(obs));
}

// ---------------------------------------------------------------------------
// Queries (for runtime dashboard & auto-check)
// ---------------------------------------------------------------------------

export function getCounter(name: string, labels: Record<string, string> = {}): number {
  const exact = counters.get(fullKey(name, labels));
  if (exact !== undefined) return exact;

  // Partial match: sum all counters with this name that contain the given labels
  let sum = 0;
  for (const [key, value] of counters) {
    const parsed = parseKey(key);
    if (parsed.name !== name) continue;
    const matches = Object.entries(labels).every(([k, v]) => parsed.labels[k] === v);
    if (matches) sum += value;
  }
  return sum;
}

export function getGaugeLatest(name: string, labels: Record<string, string> = {}): number | undefined {
  const exact = gauges.get(fullKey(name, labels));
  if (exact && exact.length > 0) return exact[exact.length - 1].value;

  // Partial match: return the latest value from any matching series
  let latest: number | undefined;
  for (const [key, series] of gauges) {
    const parsed = parseKey(key);
    if (parsed.name !== name) continue;
    const matches = Object.entries(labels).every(([k, v]) => parsed.labels[k] === v);
    if (matches && series.length > 0) {
      const val = series[series.length - 1].value;
      if (latest === undefined || val > latest) latest = val;
    }
  }
  return latest;
}

export function getGaugeSeries(name: string, labels: Record<string, string> = {}): MetricValue[] {
  return gauges.get(fullKey(name, labels)) || [];
}

export function getHistogramPercentile(name: string, labels: Record<string, string> = {}, p: number): number | undefined {
  const key = fullKey(name, labels);
  const obs = histogramObservations.get(key);
  if (!obs || obs.length === 0) return undefined;
  const sorted = [...obs].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export interface MetricSnapshot {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  gauges: Array<{ name: string; labels: Record<string, string>; latest: number; series: MetricValue[] }>;
  histograms: Array<{ name: string; labels: Record<string, string>; count: number; sum: number; p95?: number; p99?: number }>;
}

export function getAllMetrics(): MetricSnapshot {
  const result: MetricSnapshot = { counters: [], gauges: [], histograms: [] };

  for (const [key, value] of counters) {
    const { name, labels } = parseKey(key);
    result.counters.push({ name, labels, value });
  }

  for (const [key, series] of gauges) {
    const { name, labels } = parseKey(key);
    if (series.length > 0) {
      result.gauges.push({ name, labels, latest: series[series.length - 1].value, series });
    }
  }

  for (const [key, h] of histograms) {
    const { name, labels } = parseKey(key);
    result.histograms.push({
      name,
      labels,
      count: h.count,
      sum: h.sum,
      p95: getHistogramPercentile(name, labels, 0.95),
      p99: getHistogramPercentile(name, labels, 0.99),
    });
  }

  return result;
}

function parseKey(key: string): { name: string; labels: Record<string, string> } {
  const braceIdx = key.indexOf("{");
  if (braceIdx === -1) return { name: key, labels: {} };
  const name = key.slice(0, braceIdx);
  const labelStr = key.slice(braceIdx + 1, -1);
  const labels: Record<string, string> = {};
  // Simple parser for k="v" pairs
  const regex = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(labelStr)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return { name, labels };
}

// ---------------------------------------------------------------------------
// Prometheus Export
// ---------------------------------------------------------------------------

export function exportPrometheus(): string {
  const lines: string[] = [];

  // Group by metric name for TYPE/HELP headers
  const names = new Set<string>();
  for (const key of counters.keys()) names.add(parseKey(key).name);
  for (const key of gauges.keys()) names.add(parseKey(key).name);
  for (const key of histograms.keys()) names.add(parseKey(key).name);

  for (const name of Array.from(names).sort()) {
    const def = definitions.get(name);
    if (def) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type}`);
    }

    // Counters
    for (const [key, value] of counters) {
      const parsed = parseKey(key);
      if (parsed.name === name) {
        lines.push(`${name}${labelKey(parsed.labels)} ${value}`);
      }
    }

    // Gauges (latest value only for Prometheus)
    for (const [key, series] of gauges) {
      const parsed = parseKey(key);
      if (parsed.name === name && series.length > 0) {
        lines.push(`${name}${labelKey(parsed.labels)} ${series[series.length - 1].value}`);
      }
    }

    // Histograms
    for (const [key, h] of histograms) {
      const parsed = parseKey(key);
      if (parsed.name === name) {
        for (const bucket of h.buckets) {
          lines.push(`${name}_bucket{le="${bucket.le}"${Object.entries(parsed.labels).length > 0 ? "," + Object.entries(parsed.labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",") : ""}} ${bucket.count}`);
        }
        lines.push(`${name}_bucket{le="+Inf"${Object.entries(parsed.labels).length > 0 ? "," + Object.entries(parsed.labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",") : ""}} ${h.count}`);
        lines.push(`${name}_sum${labelKey(parsed.labels)} ${h.sum}`);
        lines.push(`${name}_count${labelKey(parsed.labels)} ${h.count}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Pre-defined metrics for Ouroboros
// ---------------------------------------------------------------------------

export function registerBuiltinMetrics(): void {
  registerMetric("ouroboros_requests_total", "counter", "Total HTTP requests processed");
  registerMetric("ouroboros_request_duration_seconds", "histogram", "HTTP request duration in seconds");
  registerMetric("ouroboros_llm_calls_total", "counter", "Total LLM API calls", "calls");
  registerMetric("ouroboros_llm_tokens_total", "counter", "Total LLM tokens consumed", "tokens");
  registerMetric("ouroboros_llm_latency_seconds", "histogram", "LLM call latency in seconds");
  registerMetric("ouroboros_skill_calls_total", "counter", "Total skill invocations");
  registerMetric("ouroboros_skill_errors_total", "counter", "Total skill invocation failures");
  registerMetric("ouroboros_memory_bytes", "gauge", "Process memory usage in bytes");
  registerMetric("ouroboros_active_sessions", "gauge", "Number of active sessions");
  registerMetric("ouroboros_ws_clients", "gauge", "Number of active WebSocket clients");
  registerMetric("ouroboros_db_queries_total", "counter", "Total database queries");
  registerMetric("ouroboros_db_query_duration_seconds", "histogram", "Database query duration in seconds");
  registerMetric("ouroboros_evolution_proposals_total", "counter", "Total evolution proposals generated");
  registerMetric("ouroboros_evolution_applied_total", "counter", "Total evolution proposals applied");
  registerMetric("ouroboros_uptime_seconds", "gauge", "Process uptime in seconds");
  registerMetric("ouroboros_event_bus_queue_size", "gauge", "Event bus queue size");
  registerMetric("ouroboros_cpu_usage_percent", "gauge", "CPU usage percentage");
}

/** Reset all metrics — intended for testing only */
export function _resetMetrics(): void {
  definitions.clear();
  counters.clear();
  gauges.clear();
  histograms.clear();
  histogramObservations.clear();
  registerBuiltinMetrics();
}

// Auto-register on module load
registerBuiltinMetrics();
