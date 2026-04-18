import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callLLMWithResilience } from "../../core/llm-resilience.ts";
import { streamLLM } from "../../core/llm-router.ts";
import type { LLMConfig, LLMStreamChunk } from "../../core/llm-router.ts";
import type { BaseMessage } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

vi.mock("../../core/llm-router.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../core/llm-router.ts")>();
  return {
    ...mod,
    streamLLM: vi.fn(),
  };
});

vi.mock("../../core/sentry.ts", () => ({
  captureException: vi.fn(),
}));

const mockedStreamLLM = vi.mocked(streamLLM);

function successStream(text: string) {
  return ok(
    (async function* (): AsyncGenerator<LLMStreamChunk> {
      yield { type: "response_headers", headers: {} };
      yield { type: "text", text };
      yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    })()
  );
}

function errorStream(message: string) {
  return err({ code: "STREAM_ERROR", message });
}

describe("LLM Resilience", () => {
  const messages: BaseMessage[] = [{ role: "user", content: "hello" }];
  let modelCounter = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedStreamLLM.mockReset();
    modelCounter++;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeCfg(): LLMConfig {
    return { provider: "openai", model: `gpt-test-${modelCounter}`, apiKey: "sk-test" };
  }

  it("returns success on first try", async () => {
    const cfg = makeCfg();
    mockedStreamLLM.mockResolvedValueOnce(successStream("hi"));
    const res = await callLLMWithResilience(cfg, messages, []);
    expect(res.success).toBe(true);
    expect(mockedStreamLLM).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error then succeeds", async () => {
    const cfg = makeCfg();
    mockedStreamLLM
      .mockResolvedValueOnce(errorStream("timeout"))
      .mockResolvedValueOnce(successStream("hi"));

    const promise = callLLMWithResilience(cfg, messages, [], { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res.success).toBe(true);
    expect(mockedStreamLLM).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth errors", async () => {
    const cfg = makeCfg();
    mockedStreamLLM.mockResolvedValueOnce(errorStream("401 Unauthorized"));
    const res = await callLLMWithResilience(cfg, messages, [], { maxRetries: 2 });
    expect(res.success).toBe(false);
    expect(mockedStreamLLM).toHaveBeenCalledTimes(1);
  });

  it("uses fallback when primary fails", async () => {
    const cfg = makeCfg();
    mockedStreamLLM.mockResolvedValue(errorStream("timeout"));
    const fallback: LLMConfig = { provider: "openai", model: "gpt-fallback", apiKey: "sk-fallback" };

    const promise = callLLMWithResilience(cfg, messages, [], { maxRetries: 0, fallback });
    await vi.advanceTimersByTimeAsync(100);
    const res = await promise;
    expect(res.success).toBe(false);
    expect(mockedStreamLLM).toHaveBeenCalledTimes(2);
    expect(mockedStreamLLM).toHaveBeenNthCalledWith(1, cfg, messages, [], undefined);
    expect(mockedStreamLLM).toHaveBeenNthCalledWith(2, fallback, messages, [], undefined);
  });

  it("opens circuit breaker after 5 failures", async () => {
    const cfg = makeCfg();
    mockedStreamLLM.mockResolvedValue(errorStream("timeout"));
    // 5 failures on primary (with 0 retries to speed up)
    for (let i = 0; i < 5; i++) {
      const p = callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(100);
      await p;
    }

    // 6th call should immediately return CIRCUIT_OPEN
    const res = await callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
    expect(res.success).toBe(false);
    expect((res as { success: false; error: { code: string } }).error.code).toBe("CIRCUIT_OPEN");
    // streamLLM should not be called for the 6th because circuit is open
    expect(mockedStreamLLM).toHaveBeenCalledTimes(5);
  });

  it("closes circuit breaker after timeout", async () => {
    const cfg = makeCfg();
    mockedStreamLLM.mockResolvedValue(errorStream("timeout"));
    for (let i = 0; i < 5; i++) {
      const p = callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(100);
      await p;
    }

    // Advance past circuit timeout (10s)
    await vi.advanceTimersByTimeAsync(11_000);
    mockedStreamLLM.mockResolvedValueOnce(successStream("ok"));

    const res = await callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
    expect(res.success).toBe(true);
    expect(mockedStreamLLM).toHaveBeenCalledTimes(6);
  });
});
