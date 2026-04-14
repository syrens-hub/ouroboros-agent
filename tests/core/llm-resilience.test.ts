import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callLLMWithResilience } from "../../core/llm-resilience.ts";
import { callLLM } from "../../core/llm-router.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import type { BaseMessage } from "../../types/index.ts";

vi.mock("../../core/llm-router.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../core/llm-router.ts")>();
  return {
    ...mod,
    callLLM: vi.fn(),
  };
});

vi.mock("../../core/sentry.ts", () => ({
  captureException: vi.fn(),
}));

const mockedCallLLM = vi.mocked(callLLM);

describe("LLM Resilience", () => {
  const messages: BaseMessage[] = [{ role: "user", content: "hello" }];
  let modelCounter = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedCallLLM.mockReset();
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
    mockedCallLLM.mockResolvedValueOnce({ success: true, data: { role: "assistant", content: "hi" } });
    const res = await callLLMWithResilience(cfg, messages, []);
    expect(res.success).toBe(true);
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error then succeeds", async () => {
    const cfg = makeCfg();
    mockedCallLLM
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ success: true, data: { role: "assistant", content: "hi" } });

    const promise = callLLMWithResilience(cfg, messages, [], { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res.success).toBe(true);
    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth errors", async () => {
    const cfg = makeCfg();
    mockedCallLLM.mockRejectedValueOnce(new Error("401 Unauthorized"));
    const res = await callLLMWithResilience(cfg, messages, [], { maxRetries: 2 });
    expect(res.success).toBe(false);
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });

  it("uses fallback when primary fails", async () => {
    const cfg = makeCfg();
    mockedCallLLM.mockRejectedValue(new Error("timeout"));
    const fallback: LLMConfig = { provider: "openai", model: "gpt-fallback", apiKey: "sk-fallback" };

    const promise = callLLMWithResilience(cfg, messages, [], { maxRetries: 0, fallback });
    await vi.advanceTimersByTimeAsync(100);
    const res = await promise;
    expect(res.success).toBe(false);
    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    expect(mockedCallLLM).toHaveBeenNthCalledWith(1, cfg, messages, [], undefined);
    expect(mockedCallLLM).toHaveBeenNthCalledWith(2, fallback, messages, [], undefined);
  });

  it("opens circuit breaker after 5 failures", async () => {
    const cfg = makeCfg();
    mockedCallLLM.mockRejectedValue(new Error("timeout"));
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
    // callLLM should not be called for the 6th because circuit is open
    expect(mockedCallLLM).toHaveBeenCalledTimes(5);
  });

  it("closes circuit breaker after timeout", async () => {
    const cfg = makeCfg();
    mockedCallLLM.mockRejectedValue(new Error("timeout"));
    for (let i = 0; i < 5; i++) {
      const p = callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(100);
      await p;
    }

    // Advance past circuit timeout (10s)
    await vi.advanceTimersByTimeAsync(11_000);
    mockedCallLLM.mockResolvedValueOnce({ success: true, data: { role: "assistant", content: "ok" } });

    const res = await callLLMWithResilience(cfg, messages, [], { maxRetries: 0 });
    expect(res.success).toBe(true);
    expect(mockedCallLLM).toHaveBeenCalledTimes(6);
  });
});
