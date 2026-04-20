import { describe, it, expect } from "vitest";
import { recordLLMCallMetric, getLLMMetrics, recordLLMLatencyMs } from "../../core/llm-metrics.ts";

describe("llm-metrics", () => {
  it("returns zeros when metrics are empty", () => {
    const m = getLLMMetrics();
    expect(m.callCount).toBe(0);
    expect(m.averageLatencyMs).toBe(0);
    expect(m.p95LatencyMs).toBe(0);
    expect(m.totalTokens).toBe(0);
  });

  it("recordLLMLatencyMs delegates with zero tokens", () => {
    recordLLMLatencyMs(42);
    const m = getLLMMetrics();
    expect(m.callCount).toBe(1);
    expect(m.totalTokens).toBe(0);
  });

  it("rolls off old samples after MAX_SAMPLES", () => {
    for (let i = 0; i < 105; i++) {
      recordLLMCallMetric(i, 1);
    }
    const m = getLLMMetrics();
    expect(m.callCount).toBe(100);
  });
});
