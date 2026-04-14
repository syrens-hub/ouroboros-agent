/**
 * LLM Call Metrics
 * ================
 * Rolling-window latency and token usage tracking for LLM calls.
 */

interface CallMetric {
  latencyMs: number;
  tokens: number;
}

const MAX_SAMPLES = 100;
const metrics: CallMetric[] = [];

export function recordLLMCallMetric(latencyMs: number, tokens = 0): void {
  metrics.push({ latencyMs, tokens });
  if (metrics.length > MAX_SAMPLES) {
    metrics.shift();
  }
}

export function getLLMMetrics(): {
  averageLatencyMs: number;
  p95LatencyMs: number;
  callCount: number;
  totalTokens: number;
} {
  if (metrics.length === 0) {
    return { averageLatencyMs: 0, p95LatencyMs: 0, callCount: 0, totalTokens: 0 };
  }
  const sortedLatencies = [...metrics].map((m) => m.latencyMs).sort((a, b) => a - b);
  const avg = Math.round(sortedLatencies.reduce((s, v) => s + v, 0) / sortedLatencies.length);
  const p95Index = Math.floor(sortedLatencies.length * 0.95);
  const p95 = Math.round(sortedLatencies[Math.min(p95Index, sortedLatencies.length - 1)]);
  const totalTokens = metrics.reduce((s, m) => s + m.tokens, 0);
  return { averageLatencyMs: avg, p95LatencyMs: p95, callCount: metrics.length, totalTokens };
}

// Backward compatibility: alias for latency-only recording
export function recordLLMLatencyMs(duration: number): void {
  recordLLMCallMetric(duration, 0);
}
