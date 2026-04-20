import { describe, it, expect, beforeEach } from "vitest";
import {
  registerMetric,
  incCounter,
  setGauge,
  observeHistogram,
  getCounter,
  getGaugeLatest,
  getHistogramPercentile,
  exportPrometheus,
  getAllMetrics,
  _resetMetrics,
} from "../../../skills/telemetry-v2/metrics-registry.ts";

describe("metrics-registry", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  describe("counter", () => {
    it("increments and retrieves counter", () => {
      registerMetric("test_counter", "counter", "A test counter");
      incCounter("test_counter", { label: "a" }, 5);
      incCounter("test_counter", { label: "a" }, 3);
      expect(getCounter("test_counter", { label: "a" })).toBe(8);
    });

    it("auto-registers unknown counter", () => {
      incCounter("auto_counter", {}, 1);
      expect(getCounter("auto_counter")).toBe(1);
    });

    it("separates counters by label", () => {
      registerMetric("sep_counter", "counter", "Separated");
      incCounter("sep_counter", { env: "prod" }, 10);
      incCounter("sep_counter", { env: "dev" }, 5);
      expect(getCounter("sep_counter", { env: "prod" })).toBe(10);
      expect(getCounter("sep_counter", { env: "dev" })).toBe(5);
    });
  });

  describe("gauge", () => {
    it("sets and retrieves latest gauge", () => {
      registerMetric("test_gauge", "gauge", "A test gauge");
      setGauge("test_gauge", { host: "A" }, 42);
      setGauge("test_gauge", { host: "A" }, 43);
      expect(getGaugeLatest("test_gauge", { host: "A" })).toBe(43);
    });

    it("returns undefined for missing gauge", () => {
      expect(getGaugeLatest("missing_gauge")).toBeUndefined();
    });
  });

  describe("histogram", () => {
    it("observes and calculates percentiles", () => {
      registerMetric("test_hist", "histogram", "A test histogram");
      for (let i = 1; i <= 100; i++) {
        observeHistogram("test_hist", {}, i / 1000, [0.001, 0.01, 0.1, 1, 10]);
      }
      const p50 = getHistogramPercentile("test_hist", {}, 0.5);
      const p95 = getHistogramPercentile("test_hist", {}, 0.95);
      expect(p50).toBeGreaterThanOrEqual(0.05);
      expect(p50).toBeLessThanOrEqual(0.06);
      expect(p95).toBeGreaterThanOrEqual(0.095);
    });
  });

  describe("prometheus export", () => {
    it("exports counters in prometheus format", () => {
      registerMetric("prom_counter", "counter", "Prom counter");
      incCounter("prom_counter", { method: "GET" }, 7);
      const text = exportPrometheus();
      expect(text).toContain("# HELP prom_counter Prom counter");
      expect(text).toContain("# TYPE prom_counter counter");
      expect(text).toContain('prom_counter{method="GET"} 7');
    });

    it("exports gauges in prometheus format", () => {
      registerMetric("prom_gauge", "gauge", "Prom gauge");
      setGauge("prom_gauge", {}, 99);
      const text = exportPrometheus();
      expect(text).toContain('prom_gauge 99');
    });

    it("exports histogram buckets", () => {
      registerMetric("prom_hist", "histogram", "Prom histogram");
      observeHistogram("prom_hist", {}, 0.05, [0.01, 0.1, 1]);
      const text = exportPrometheus();
      expect(text).toContain("prom_hist_bucket{le=\"0.01\"}");
      expect(text).toContain("prom_hist_bucket{le=\"0.1\"}");
      expect(text).toContain("prom_hist_bucket{le=\"+Inf\"}");
      expect(text).toContain("prom_hist_sum 0.05");
      expect(text).toContain("prom_hist_count 1");
    });
  });

  describe("getAllMetrics snapshot", () => {
    it("returns complete snapshot", () => {
      incCounter("snap_counter", { a: "1" }, 1);
      setGauge("snap_gauge", { b: "2" }, 3);
      observeHistogram("snap_hist", { c: "3" }, 0.1);
      const snap = getAllMetrics();
      expect(snap.counters.some((c) => c.name === "snap_counter")).toBe(true);
      expect(snap.gauges.some((g) => g.name === "snap_gauge")).toBe(true);
      expect(snap.histograms.some((h) => h.name === "snap_hist")).toBe(true);
    });
  });
});
