import { callLLM, type LLMConfig } from "../core/llm-router.ts";
import type { BenchmarkResult } from "./types.ts";

type ProviderKey = "openai" | "anthropic" | "gemini" | "minimax" | "qwen";

const PROVIDERS: ProviderKey[] = ["openai", "anthropic", "gemini", "minimax", "qwen"];

const ENV_KEY_MAP: Record<ProviderKey, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
};

const MODEL_DEFAULTS: Record<ProviderKey, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  gemini: "gemini-2.0-flash",
  minimax: "MiniMax-Text-01",
  qwen: "qwen-turbo",
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export async function runLLMRouterBenchmark(opts?: { iterations?: number }): Promise<BenchmarkResult> {
  const iterations = opts?.iterations ?? 5;
  const details: Array<{ provider: string; latencyMs: number; success: boolean }> = [];

  for (const provider of PROVIDERS) {
    const apiKey = process.env[ENV_KEY_MAP[provider]];
    if (!apiKey) {
      details.push({ provider, latencyMs: 0, success: false });
      continue;
    }

    const cfg: LLMConfig = {
      provider,
      apiKey,
      model: MODEL_DEFAULTS[provider],
      temperature: 0.2,
      maxTokens: 64,
    };

    const messages = [{ role: "user" as const, content: "Say 'pong' and nothing else." }];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const result = await callLLM(cfg, messages, []);
      const latencyMs = performance.now() - start;
      const success = result.success;
      details.push({ provider, latencyMs, success });
    }
  }

  const metrics: Record<string, number> = {};

  for (const provider of PROVIDERS) {
    const rows = details.filter((d) => d.provider === provider && d.latencyMs > 0);
    if (rows.length === 0) {
      metrics[`${provider}_skipped`] = 1;
      continue;
    }
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const successes = rows.filter((r) => r.success).length;
    metrics[`${provider}_p50_ms`] = percentile(latencies, 50);
    metrics[`${provider}_p95_ms`] = percentile(latencies, 95);
    metrics[`${provider}_success_rate`] = successes / rows.length;
    metrics[`${provider}_calls`] = rows.length;
  }

  return {
    name: "llm-router",
    metrics,
    details,
    timestamp: Date.now(),
  };
}
