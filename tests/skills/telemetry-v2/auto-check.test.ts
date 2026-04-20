import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  setGauge,
  _resetMetrics,
} from "../../../skills/telemetry-v2/metrics-registry.ts";
import { runAutoCheck } from "../../../skills/telemetry-v2/auto-check.ts";

describe("auto-check", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  it("returns report with findings and recommendations", () => {
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 100 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 120);

    const report = runAutoCheck("manual");

    expect(report.id).toMatch(/^checkup-/);
    expect(report.trigger).toBe("manual");
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
    expect(["healthy", "degraded", "critical"]).toContain(report.overallStatus);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.rawMetrics).toBeDefined();
  });

  it("detects high memory usage", () => {
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 600 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 120);

    const report = runAutoCheck("scheduled");
    const memFinding = report.findings.find((f) => f.title.includes("Heap memory"));
    expect(memFinding).toBeDefined();
    expect(memFinding!.severity).toBe("critical");
    expect(memFinding!.currentValue).toBeGreaterThan(256);

    const memRec = report.recommendations.find((r) => r.title.includes("memory"));
    expect(memRec).toBeDefined();
    expect(memRec!.autoApplicable).toBe(false);
  });

  it("detects high skill error rate", () => {
    incCounter("ouroboros_skill_calls_total", { skill: "bad-skill" }, 10);
    incCounter("ouroboros_skill_errors_total", { skill: "bad-skill" }, 3);
    setGauge("ouroboros_uptime_seconds", {}, 120);

    const report = runAutoCheck("event");
    const errFinding = report.findings.find((f) => f.title.includes("Skill error rate"));
    expect(errFinding).toBeDefined();
    expect(errFinding!.severity).toBe("critical");

    const errRec = report.recommendations.find((r) => r.title.includes("failing skills"));
    expect(errRec).toBeDefined();
  });

  it("detects high HTTP error rate", () => {
    incCounter("ouroboros_requests_total", { method: "GET", path: "/", status: "200" }, 10);
    incCounter("ouroboros_requests_total", { method: "GET", path: "/", status: "500" }, 2);
    setGauge("ouroboros_uptime_seconds", {}, 120);

    const report = runAutoCheck("manual");
    const httpFinding = report.findings.find((f) => f.title.includes("HTTP error rate"));
    expect(httpFinding).toBeDefined();
  });

  it("generates healthy info when all nominal", () => {
    setGauge("ouroboros_memory_bytes", { type: "heapUsed" }, 50 * 1024 * 1024);
    setGauge("ouroboros_uptime_seconds", {}, 120);

    const report = runAutoCheck("manual");
    expect(report.overallStatus).toBe("healthy");
    expect(report.findings.some((f) => f.title.includes("All systems nominal"))).toBe(true);
  });
});
