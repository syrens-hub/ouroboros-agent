import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  setGauge,
  observeHistogram,
  _resetMetrics,
} from "../../../skills/telemetry-v2/metrics-registry.ts";
import { buildRuntimeSummary } from "../../../skills/telemetry-v2/runtime-dashboard.ts";

describe("runtime-dashboard", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  it("builds summary with all categories", () => {
    // Seed some metrics
    incCounter("ouroboros_requests_total", { method: "GET", path: "/api/health", status: "200" }, 10);
    incCounter("ouroboros_requests_total", { method: "GET", path: "/api/health", status: "500" }, 1);
    observeHistogram("ouroboros_request_duration_seconds", { method: "GET", path: "/api/health", status: "200" }, 0.05);
    incCounter("ouroboros_llm_calls_total", { provider: "minimax" }, 5);
    incCounter("ouroboros_llm_tokens_total", { provider: "minimax" }, 1000);
    observeHistogram("ouroboros_llm_latency_seconds", { provider: "minimax" }, 0.5);
    incCounter("ouroboros_skill_calls_total", { skill: "test" }, 8);
    incCounter("ouroboros_skill_errors_total", { skill: "test" }, 1);
    incCounter("ouroboros_db_queries_total", { backend: "sqlite" }, 20);
    observeHistogram("ouroboros_db_query_duration_seconds", { backend: "sqlite" }, 0.01);
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 128 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 60);

    const summary = buildRuntimeSummary();

    expect(summary.timestamp).toBeGreaterThan(0);
    expect(summary.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(summary.healthScore).toBeLessThanOrEqual(100);
    expect(["healthy", "degraded", "critical"]).toContain(summary.status);

    expect(summary.categories.http.requestsTotal).toBe(11);
    expect(summary.categories.llm.callsTotal).toBe(5);
    expect(summary.categories.skills.callsTotal).toBe(8);
    expect(summary.categories.database.queriesTotal).toBe(20);
    expect(summary.categories.memory.heapUsedMb).toBeGreaterThan(0);

    expect(Array.isArray(summary.alerts)).toBe(true);
    expect(Array.isArray(summary.trends)).toBe(true);
  });

  it("generates memory alert when heap high", () => {
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 600 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 60);

    const summary = buildRuntimeSummary();
    const memAlert = summary.alerts.find((a) => a.category === "memory");
    expect(memAlert).toBeDefined();
    expect(memAlert!.level).toBe("warning");
  });

  it("returns healthy when no issues", () => {
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 50 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 60);

    const summary = buildRuntimeSummary();
    expect(summary.status).toBe("healthy");
    expect(summary.healthScore).toBeGreaterThanOrEqual(80);
  });
});
