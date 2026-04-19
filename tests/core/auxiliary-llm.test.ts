import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callAuxiliary,
  streamOpenAI,
  streamAnthropic,
  streamGemini,
} from "../../core/auxiliary-llm.ts";
import type { BaseMessage } from "../../types/index.ts";
import type { LLMConfig } from "../../core/llm-router.ts";

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

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

async function collectChunks<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

describe("callAuxiliary", () => {
  beforeEach(() => {
    mockCallLLMWithResilience.mockReset();
  });

  it("uses explicit auxiliary config when available", async () => {
    mockCallLLMWithResilience.mockResolvedValue({
      success: true,
      data: { role: "assistant", content: "ok" },
    });

    await callAuxiliary("review", [{ role: "user", content: "hi" }]);

    expect(mockCallLLMWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "review-key", model: "gpt-4o-mini" }),
      expect.any(Array),
      [],
      expect.any(Object)
    );
  });

  it("falls back to main llm when auxiliary config is missing", async () => {
    mockCallLLMWithResilience.mockResolvedValue({
      success: true,
      data: { role: "assistant", content: "ok" },
    });

    await callAuxiliary("compression", [{ role: "user", content: "hi" }]);

    expect(mockCallLLMWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "main-key", model: "gpt-4o" }),
      expect.any(Array),
      [],
      expect.any(Object)
    );
  });

  it("falls back to fallback llm when main llm is unavailable", async () => {
    mockCallLLMWithResilience.mockResolvedValue({
      success: true,
      data: { role: "assistant", content: "ok" },
    });

    const { appConfig } = await import("../../core/config.ts");
    const originalMainApiKey = appConfig.llm.apiKey;
    appConfig.llm.apiKey = "";

    await callAuxiliary("summarization", [{ role: "user", content: "hi" }]);

    expect(mockCallLLMWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "fallback-key", model: "claude-haiku" }),
      expect.any(Array),
      [],
      expect.any(Object)
    );

    appConfig.llm.apiKey = originalMainApiKey;
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

describe("streamOpenAI", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields text, tool_use, usage, and response_headers chunks", async () => {
    const body = createSSEStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"echo","arguments":"{\\"text\\":\\"hi\\"}"}}]}}]}',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      "data: [DONE]",
      "",
    ]);

    const headers = new Headers();
    headers.set("content-type", "text/event-stream");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body,
      text: async () => "",
      headers,
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "openai", model: "gpt-4o", apiKey: "sk-test" };
    const messages: BaseMessage[] = [{ role: "user", content: "hello" }];
    const chunks = await collectChunks(streamOpenAI(cfg, messages, []));

    expect(chunks[0]).toEqual({ type: "response_headers", headers: { "content-type": "text/event-stream" } });

    const textChunks = chunks.filter((c: any) => c.type === "text");
    expect(textChunks).toContainEqual({ type: "text", text: "Hello" });

    const toolChunks = chunks.filter((c: any) => c.type === "tool_use");
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolChunks[0]).toMatchObject({
      type: "tool_use",
      toolUse: expect.objectContaining({ id: "tc1", name: "echo" }),
    });

    const usageChunks = chunks.filter((c: any) => c.type === "usage");
    expect(usageChunks).toContainEqual({
      type: "usage",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("throws on non-ok response with status code", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
      headers: new Headers(),
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "openai", model: "gpt-4o", apiKey: "sk-test" };
    const gen = streamOpenAI(cfg, [{ role: "user", content: "hi" }], []);

    const first = await gen.next();
    expect(first.value).toEqual({ type: "response_headers", headers: {} });

    try {
      await gen.next();
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("OpenAI error 429");
      expect(e.statusCode).toBe(429);
    }
  });

  it("throws Aborted when signal is aborted after headers", async () => {
    const body = createSSEStream(["data: [DONE]", ""]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body,
      text: async () => "",
      headers: new Headers(),
    } as unknown as Response);

    const controller = new AbortController();
    const cfg: LLMConfig = { provider: "openai", model: "gpt-4o", apiKey: "sk-test" };
    const gen = streamOpenAI(cfg, [{ role: "user", content: "hi" }], [], controller.signal);

    await gen.next(); // response_headers
    controller.abort();

    await expect(gen.next()).rejects.toThrow("Aborted");
  });
});

describe("streamAnthropic", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields text, usage, and response_headers chunks from SSE", async () => {
    const body = createSSEStream([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":3}}',
      "data: [DONE]",
      "",
    ]);

    const headers = new Headers();
    headers.set("content-type", "text/event-stream");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body,
      text: async () => "",
      headers,
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "anthropic", model: "claude-3", apiKey: "ak-test" };
    const messages: BaseMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ];
    const chunks = await collectChunks(streamAnthropic(cfg, messages, []));

    expect(chunks[0]).toEqual({ type: "response_headers", headers: { "content-type": "text/event-stream" } });

    const textChunks = chunks.filter((c: any) => c.type === "text");
    expect(textChunks).toContainEqual({ type: "text", text: "Hi" });

    const usageChunks = chunks.filter((c: any) => c.type === "usage");
    expect(usageChunks).toContainEqual({
      type: "usage",
      usage: { promptTokens: 12, completionTokens: 0, totalTokens: 12 },
    });
    expect(usageChunks).toContainEqual({
      type: "usage",
      usage: { promptTokens: 0, completionTokens: 3, totalTokens: 3 },
    });
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      headers: new Headers(),
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "anthropic", model: "claude-3", apiKey: "ak-test" };
    const gen = streamAnthropic(cfg, [{ role: "user", content: "hi" }], []);

    await gen.next();
    await expect(gen.next()).rejects.toThrow("Anthropic error 401");
  });
});

describe("streamGemini", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields text, usage, and response_headers chunks from SSE", async () => {
    const body = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      'data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4,"totalTokenCount":12}}',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}',
      "data: [DONE]",
      "",
    ]);

    const headers = new Headers();
    headers.set("content-type", "text/event-stream");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body,
      text: async () => "",
      headers,
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "gemini", model: "gemini-2.0-flash", apiKey: "gk-test" };
    const messages: BaseMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ];
    const chunks = await collectChunks(streamGemini(cfg, messages, []));

    expect(chunks[0]).toEqual({ type: "response_headers", headers: { "content-type": "text/event-stream" } });

    const textChunks = chunks.filter((c: any) => c.type === "text");
    expect(textChunks).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
    ]);

    const usageChunks = chunks.filter((c: any) => c.type === "usage");
    expect(usageChunks).toContainEqual({
      type: "usage",
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    });
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
      headers: new Headers(),
    } as unknown as Response);

    const cfg: LLMConfig = { provider: "gemini", model: "gemini-2.0-flash", apiKey: "gk-test" };
    const gen = streamGemini(cfg, [{ role: "user", content: "hi" }], []);

    await gen.next();
    await expect(gen.next()).rejects.toThrow("Gemini error 400");
  });
});
