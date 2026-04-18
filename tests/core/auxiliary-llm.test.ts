import { describe, it, expect, vi, beforeEach } from "vitest";
import { callAuxiliary } from "../../core/auxiliary-llm.ts";

const mockCallLLMWithResilience = vi.fn();

vi.mock("../../core/llm-resilience.ts", () => ({
  callLLMWithResilience: (...args: any[]) => mockCallLLMWithResilience(...args),
}));

vi.mock("../../core/config.ts", () => ({
  appConfig: {
    llm: {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "main-key",
      baseUrl: "",
      temperature: 0.2,
      maxTokens: 4096,
    },
    fallbackLlm: {
      provider: "anthropic",
      model: "claude-haiku",
      apiKey: "fallback-key",
      baseUrl: "",
      temperature: 0.2,
      maxTokens: 4096,
    },
    auxiliary: {
      review: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "review-key",
        baseUrl: "",
      },
    },
    log: { level: "info", format: "pretty" },
    db: { dir: ".ouroboros", usePostgres: false, postgresUrl: "", slowQueryThresholdMs: 0 },
    web: { port: 8080, apiToken: "", allowedOrigins: [] },
  },
}));

describe("callAuxiliary", () => {
  beforeEach(() => {
    mockCallLLMWithResilience.mockReset();
  });

  it("uses explicit auxiliary config when available", async () => {
    mockCallLLMWithResilience.mockResolvedValue({ success: true, data: { role: "assistant", content: "ok" } });
    await callAuxiliary("review", [{ role: "user", content: "hi" }]);
    expect(mockCallLLMWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "review-key", model: "gpt-4o-mini" }),
      expect.any(Array),
      [],
      expect.any(Object)
    );
  });

  it("falls back to main llm when auxiliary config is missing", async () => {
    mockCallLLMWithResilience.mockResolvedValue({ success: true, data: { role: "assistant", content: "ok" } });
    await callAuxiliary("compression", [{ role: "user", content: "hi" }]);
    expect(mockCallLLMWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "main-key", model: "gpt-4o" }),
      expect.any(Array),
      [],
      expect.any(Object)
    );
  });

  it("returns error when no provider is available", async () => {
    const { appConfig } = await import("../../core/config.ts");
    const originalMain = { ...appConfig.llm };
    appConfig.llm.apiKey = "";
    const originalFallback = { ...appConfig.fallbackLlm };
    appConfig.fallbackLlm.apiKey = "";

    const res = await callAuxiliary("vision", [{ role: "user", content: "hi" }]);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("NO_AUXILIARY_PROVIDER");
    }

    appConfig.llm.apiKey = originalMain.apiKey;
    appConfig.fallbackLlm.apiKey = originalFallback.apiKey;
  });
});
