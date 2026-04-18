/**
 * LLM Resilience Layer
 * =====================
 * Retry, fallback, circuit breaker, and error mapping for LLM calls.
 */

import { maskApiKey, streamLLM } from "./llm-router.ts";
import type { LLMConfig, LLMStreamChunk } from "./llm-router.ts";

export type { LLMConfig } from "./llm-router.ts";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { captureException } from "./sentry.ts";
import { recordLLMCallMetric } from "./llm-metrics.ts";
import { safeJsonParse } from "./safe-utils.ts";
import type { BaseMessage, AssistantMessage, Tool, Result } from "../types/index.ts";
import { err, ok } from "../types/index.ts";

type ResilienceErrorCode = "TIMEOUT" | "RATE_LIMIT" | "AUTH_ERROR" | "CIRCUIT_OPEN" | "UNKNOWN" | "PAYMENT_REQUIRED";

/**
 * Parse Retry-After from a stream chunk.
 * Priority: (1) `response_headers['retry-after']`, (2) embedded "Retry-After: <N>" in the
 * error message (for the legacy callLLM codepath), (3) none.
 */
function parseRetryAfterFromChunk(chunk: LLMStreamChunk): number | undefined {
  if (chunk.type !== "response_headers") return undefined;
  const raw = chunk.headers?.["retry-after"] ?? chunk.headers?.["Retry-After"];
  if (raw === undefined || raw === null || raw === "") return undefined;
  // Header value may be a plain integer (seconds) or an HTTP-date; handle integer only
  const secs = Number(raw);
  if (!isNaN(secs) && secs > 0) return secs * 1000;
  return undefined;
}

/**
 * Legacy fallback: extract Retry-After embedded in an error message string (e.g. when
 * streamLLM was never called because streamLLM itself threw synchronously before yielding).
 */
function parseRetryAfterFromErrorMsg(msg: string): number | undefined {
  const raf = msg.match(/[Rr]etry-After[:\s]*(\d+)/i);
  if (raf?.[1]) return Number(raf[1]) * 1000;
  return undefined;
}

/** Compute total retry delay: Retry-After header wins (no jitter — server-specified), else exponential backoff with jitter. */
function computeDelay(retryAfterMs: number | undefined, attempt: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  return 1000 * Math.pow(2, attempt) * (0.5 + Math.random());
}

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
  if (msg.includes("402") || msg.includes("credit") || msg.includes("billing") || msg.includes("payment required")) {
    return { code: "PAYMENT_REQUIRED", message: String(error), retryable: true };
  }
  return { code: "UNKNOWN", message: String(error), retryable: true };
}

import { LLM_RESILIENCE_TIMEOUT_MS } from "../web/routes/constants.ts";

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private readonly threshold = 5;
  private readonly timeoutMs = LLM_RESILIENCE_TIMEOUT_MS;

  recordSuccess() {
    this.failures = 0;
    this.state = "CLOSED";
  }

  recordFailure() {
    this.failures += 1;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "OPEN";
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
    }
  }

  canAttempt(): boolean {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return true;
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failures,
      lastFailureTime: this.lastFailureTime,
      nextRetryTime: this.state === "OPEN" ? this.lastFailureTime + this.timeoutMs : undefined,
    };
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(key: string): CircuitBreaker {
  if (!circuitBreakers.has(key)) {
    circuitBreakers.set(key, new CircuitBreaker());
  }
  return circuitBreakers.get(key)!;
}

export function getCircuitBreakerStates(): {
  provider: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailureTime: number;
  nextRetryTime: number | undefined;
}[] {
  return Array.from(circuitBreakers.entries()).map(([key, cb]) => {
    const s = cb.getState();
    return {
      provider: key,
      state: s.state,
      failureCount: s.failureCount,
      lastFailureTime: s.lastFailureTime,
      nextRetryTime: s.nextRetryTime,
    };
  });
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
    if (!cb.canAttempt()) {
      return err({ code: "CIRCUIT_OPEN", message: `Circuit breaker open for ${label}` });
    }
    let lastError: { code: ResilienceErrorCode | "PAYMENT_REQUIRED"; message: string } = { code: "UNKNOWN", message: "No attempts made" };
    for (let i = 0; i <= maxRetries; i++) {
      let retryAfterMs: number | undefined;

      try {
        const start = performance.now();
        const streamRes = await streamLLM(config, messages, tools, opts?.signal);

        if (!streamRes.success) {
          // streamLLM threw before yielding — try to parse Retry-After from the error message
          const raf = parseRetryAfterFromErrorMsg(streamRes.error?.message ?? "");
          const duration = Math.round(performance.now() - start);
          recordLLMCallMetric(duration, 0);
          const mapped = mapError(streamRes.error?.message ?? streamRes.error);
          lastError = { code: mapped.code, message: maskApiKey(mapped.message) };
          captureException(new Error(mapped.message), { code: mapped.code, label, attempt: i + 1 });
          if (!mapped.retryable) {
            cb.recordFailure();
            return err({ code: mapped.code, message: maskApiKey(mapped.message) });
          }
          cb.recordFailure();
          if (i < maxRetries) {
            retryAfterMs = raf;
            const delay = computeDelay(retryAfterMs, i);
            logger.warn(`LLM retry ${i + 1}/${maxRetries} for ${label} after ${mapped.code}`, { delay, retryAfterMs });
            await sleep(delay);
          }
          continue;
        }

        // Consume the stream, assembling the response and extracting Retry-After from headers
        const textParts: string[] = [];
        const toolCalls = new Map<string, { id: string; name: string; input: string }>();
        let promptTokens = 0;
        let completionTokens = 0;
        let streamError: Error | undefined;

        try {
          for await (const chunk of streamRes.data) {
            // Drain response_headers chunk to capture Retry-After before any other processing
            const rafFromChunk = parseRetryAfterFromChunk(chunk);
            if (rafFromChunk !== undefined) retryAfterMs = rafFromChunk;

            if (opts?.signal?.aborted) {
              streamError = new Error("ABORTED");
              break;
            }
            if (chunk.type === "text" && chunk.text) {
              textParts.push(chunk.text);
            } else if (chunk.type === "tool_use" && chunk.toolUse) {
              const tu = chunk.toolUse as Partial<import("../types/index.ts").ToolUseBlock> & { id: string; name?: string; input?: unknown };
              const existing = toolCalls.get(tu.id) || { id: tu.id, name: tu.name || "", input: "" };
              if (tu.name) existing.name = tu.name;
              if (tu.input !== undefined) {
                const inputStr = typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input);
                existing.input += inputStr;
              }
              toolCalls.set(tu.id, existing);
            } else if (chunk.type === "usage" && chunk.usage) {
              promptTokens += chunk.usage.promptTokens;
              completionTokens += chunk.usage.completionTokens;
            }
          }
        } catch (e) {
          streamError = e instanceof Error ? e : new Error(String(e));
        }

        const duration = Math.round(performance.now() - start);
        recordLLMCallMetric(duration, promptTokens + completionTokens);

        if (!streamError && !opts?.signal?.aborted) {
          // Successful stream
          const contentBlocks: (import("../types/index.ts").TextBlock | import("../types/index.ts").ToolUseBlock)[] = [];
          if (textParts.length > 0) {
            contentBlocks.push({ type: "text", text: textParts.join("") });
          }
          for (const tc of toolCalls.values()) {
            if (!tc.name) continue;
            const parsedInput: Record<string, unknown> = safeJsonParse<Record<string, unknown>>(tc.input, "tool input", { raw: tc.input });
            contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: parsedInput });
          }
          const usage = promptTokens + completionTokens > 0
            ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
            : undefined;
          cb.recordSuccess();
          return ok({ role: "assistant" as const, content: contentBlocks.length > 0 ? contentBlocks : textParts.join("") || "(no content)", usage });
        }

        // Stream error or abort
        const errMsg = streamError?.message ?? "Stream ended unexpectedly";
        const mapped = mapError(errMsg);
        lastError = { code: mapped.code, message: maskApiKey(errMsg) };
        captureException(streamError ?? new Error(errMsg), { code: mapped.code, label, attempt: i + 1 });
        if (mapped.code === "PAYMENT_REQUIRED") {
          cb.recordFailure();
          break;
        }
        if (!mapped.retryable) {
          cb.recordFailure();
          return err({ code: mapped.code, message: maskApiKey(errMsg) });
        }
        cb.recordFailure();
        if (i < maxRetries) {
          const delay = computeDelay(retryAfterMs, i);
          logger.warn(`LLM retry ${i + 1}/${maxRetries} for ${label} after ${mapped.code}`, { delay, retryAfterMs });
          await sleep(delay);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const mapped = mapError(errMsg);
        lastError = { code: mapped.code, message: maskApiKey(errMsg) };
        captureException(e instanceof Error ? e : new Error(errMsg), { code: mapped.code, label, attempt: i + 1 });
        if (mapped.code === "PAYMENT_REQUIRED") {
          cb.recordFailure();
          break;
        }
        if (!mapped.retryable) {
          cb.recordFailure();
          return err({ code: mapped.code, message: maskApiKey(errMsg) });
        }
        cb.recordFailure();
        if (i < maxRetries) {
          const raf = parseRetryAfterFromErrorMsg(errMsg);
          const delay = computeDelay(raf, i);
          logger.warn(`LLM retry ${i + 1}/${maxRetries} for ${label} after ${mapped.code}`, { delay, retryAfterMs: raf });
          await sleep(delay);
        }
      }
    }
    return err({ code: lastError.code as ResilienceErrorCode, message: maskApiKey(lastError.message) });
  }

  const primaryRes = await attempt(cfg, primaryCb, "primary");
  if (primaryRes.success) return primaryRes;

  // On 402 / payment required, immediately try fallback without burning retries on primary
  const needsFallback = primaryRes.error?.code === "PAYMENT_REQUIRED";
  const fallbackCfg = opts?.fallback || buildFallbackConfig();
  if (!fallbackCfg || !fallbackCfg.apiKey) {
    return primaryRes;
  }

  logger.warn("Primary LLM failed, attempting fallback", { primaryError: primaryRes.error, reason: needsFallback ? "PAYMENT_REQUIRED" : " retries exhausted" });
  const fallbackCb = getCircuitBreaker(`${fallbackCfg.provider}:${fallbackCfg.model}`);
  return await attempt(fallbackCfg, fallbackCb, "fallback");
}
