/**
 * LLM Resilience Layer
 * =====================
 * Retry, fallback, circuit breaker, and error mapping for LLM calls.
 */

import { callLLM, maskApiKey } from "./llm-router.ts";
import type { LLMConfig } from "./llm-router.ts";

export type { LLMConfig } from "./llm-router.ts";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { captureException } from "./sentry.ts";
import { recordLLMCallMetric } from "./llm-metrics.ts";
import type { BaseMessage, AssistantMessage, Tool, Result } from "../types/index.ts";
import { err } from "../types/index.ts";

type ResilienceErrorCode = "TIMEOUT" | "RATE_LIMIT" | "AUTH_ERROR" | "CIRCUIT_OPEN" | "UNKNOWN";

function mapError(error: unknown): { code: ResilienceErrorCode; message: string; retryable: boolean } {
  const msg = String(error).toLowerCase();
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset")) {
    return { code: "TIMEOUT", message: String(error), retryable: true };
  }
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) {
    return { code: "RATE_LIMIT", message: String(error), retryable: true };
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return { code: "AUTH_ERROR", message: String(error), retryable: false };
  }
  return { code: "UNKNOWN", message: String(error), retryable: true };
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "CLOSED" | "OPEN" = "CLOSED";
  private readonly threshold = 5;
  private readonly timeoutMs = 10_000;

  recordSuccess() {
    this.failures = 0;
    this.state = "CLOSED";
  }

  recordFailure() {
    this.failures += 1;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "OPEN";
    }
  }

  isOpen(): boolean {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = "CLOSED";
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(key: string): CircuitBreaker {
  if (!circuitBreakers.has(key)) {
    circuitBreakers.set(key, new CircuitBreaker());
  }
  return circuitBreakers.get(key)!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildFallbackConfig(): LLMConfig | undefined {
  const fb = appConfig.fallbackLlm;
  if (!fb.provider || !fb.apiKey) return undefined;
  return {
    provider: fb.provider,
    model: fb.model || "gpt-4o-mini",
    apiKey: fb.apiKey,
    baseUrl: fb.baseUrl,
    temperature: fb.temperature ?? 0.2,
    maxTokens: fb.maxTokens ?? 4096,
  };
}

export async function callLLMWithResilience(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  opts?: { maxRetries?: number; fallback?: LLMConfig; signal?: AbortSignal }
): Promise<Result<AssistantMessage>> {
  const primaryCb = getCircuitBreaker(`${cfg.provider}:${cfg.model}`);
  const maxRetries = opts?.maxRetries ?? 2;

  async function attempt(config: LLMConfig, cb: CircuitBreaker, label: string): Promise<Result<AssistantMessage>> {
    if (cb.isOpen()) {
      return err({ code: "CIRCUIT_OPEN", message: `Circuit breaker open for ${label}` });
    }
    let lastError: { code: ResilienceErrorCode; message: string } = { code: "UNKNOWN", message: "No attempts made" };
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const start = performance.now();
        const res = await callLLM(config, messages, tools, opts?.signal);
        const duration = Math.round(performance.now() - start);
        const tokens = res.success && res.data.usage ? res.data.usage.totalTokens : 0;
        recordLLMCallMetric(duration, tokens);
        if (res.success) {
          cb.recordSuccess();
          return res;
        }
        const mapped = mapError(res.error?.message || res.error);
        lastError = { code: mapped.code, message: maskApiKey(mapped.message) };
        captureException(new Error(mapped.message), { code: mapped.code, label, attempt: i + 1 });
        if (!mapped.retryable) {
          cb.recordFailure();
          return err({ code: mapped.code, message: maskApiKey(mapped.message) });
        }
        cb.recordFailure();
        if (i < maxRetries) {
          const delay = 1000 * Math.pow(2, i);
          logger.warn(`LLM retry ${i + 1}/${maxRetries} for ${label} after ${mapped.code}`, { delay });
          await sleep(delay);
        }
      } catch (e) {
        const mapped = mapError(e);
        lastError = { code: mapped.code, message: maskApiKey(mapped.message) };
        captureException(e instanceof Error ? e : new Error(mapped.message), { code: mapped.code, label, attempt: i + 1 });
        if (!mapped.retryable) {
          cb.recordFailure();
          return err({ code: mapped.code, message: maskApiKey(mapped.message) });
        }
        cb.recordFailure();
        if (i < maxRetries) {
          const delay = 1000 * Math.pow(2, i);
          logger.warn(`LLM retry ${i + 1}/${maxRetries} for ${label} after ${mapped.code}`, { delay });
          await sleep(delay);
        }
      }
    }
    return err({ code: lastError.code, message: maskApiKey(lastError.message) });
  }

  const primaryRes = await attempt(cfg, primaryCb, "primary");
  if (primaryRes.success) return primaryRes;

  const fallbackCfg = opts?.fallback || buildFallbackConfig();
  if (!fallbackCfg || !fallbackCfg.apiKey) {
    return primaryRes;
  }

  logger.warn("Primary LLM failed, attempting fallback", { primaryError: primaryRes.error });
  const fallbackCb = getCircuitBreaker(`${fallbackCfg.provider}:${fallbackCfg.model}`);
  return await attempt(fallbackCfg, fallbackCb, "fallback");
}
