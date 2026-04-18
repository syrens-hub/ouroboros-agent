/**
 * Auxiliary LLM Streaming Implementations
 * =========================================
 * Provider-specific streaming generators for OpenAI, Anthropic, Gemini, and compatible endpoints.
 */

import type {
  BaseMessage,
  Tool,
  AssistantMessage,
  Result,
} from "../types/index.ts";
import { err } from "../types/index.ts";
import type { LLMConfig, LLMStreamChunk } from "./llm-router.ts";
import { LLM_TIMEOUT_MS } from "../web/routes/constants.ts";
import { extractZodSchema } from "./llm-router.ts";
import {
  formatOpenAIMessageContent,
  formatAnthropicContent,
  formatGeminiParts,
} from "./llm-router.ts";
import {
  combineAbortSignals,
  timeoutSignal,
} from "./llm-stream-helpers.ts";
import { safeJsonParse } from "./safe-utils.ts";

// Re-export types for consumers of this module
export type { LLMStreamChunk } from "./llm-router.ts";

import { callLLMWithResilience } from "./llm-resilience.ts";
import { appConfig } from "./config.ts";

/**
 * Call an auxiliary LLM for a specific task type (review, compression, vision, etc.).
 * Falls back to main LLM and then fallback LLM if auxiliary config is missing.
 */
export async function callAuxiliary(
  type: "review" | "compression" | "vision" | "summarization" | string,
  messages: BaseMessage[],
  tools?: unknown[]
): Promise<Result<AssistantMessage>> {
  const aux = (appConfig.auxiliary as Record<string, { provider?: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; maxTokens?: number } | undefined>)[type];

  if (aux?.provider && aux?.apiKey) {
    return callLLMWithResilience(
      {
        provider: aux.provider as import("./llm-router.ts").LLMProvider,
        model: aux.model || "gpt-4o-mini",
        apiKey: aux.apiKey,
        baseUrl: aux.baseUrl,
        temperature: aux.temperature ?? 0.2,
        maxTokens: aux.maxTokens ?? 4096,
      },
      messages,
      (tools || []) as import("../types/index.ts").Tool<unknown, unknown, unknown>[],
      {}
    );
  }

  // Fallback to main LLM
  if (appConfig.llm.provider && appConfig.llm.apiKey) {
    return callLLMWithResilience(
      {
        provider: appConfig.llm.provider,
        model: appConfig.llm.model,
        apiKey: appConfig.llm.apiKey,
        baseUrl: appConfig.llm.baseUrl,
        temperature: appConfig.llm.temperature,
        maxTokens: appConfig.llm.maxTokens,
      },
      messages,
      (tools || []) as import("../types/index.ts").Tool<unknown, unknown, unknown>[],
      {}
    );
  }

  // Fallback to fallback LLM
  if (appConfig.fallbackLlm.provider && appConfig.fallbackLlm.apiKey) {
    return callLLMWithResilience(
      {
        provider: appConfig.fallbackLlm.provider,
        model: appConfig.fallbackLlm.model || "gpt-4o-mini",
        apiKey: appConfig.fallbackLlm.apiKey,
        baseUrl: appConfig.fallbackLlm.baseUrl,
        temperature: appConfig.fallbackLlm.temperature ?? 0.2,
        maxTokens: appConfig.fallbackLlm.maxTokens ?? 4096,
      },
      messages,
      (tools || []) as import("../types/index.ts").Tool<unknown, unknown, unknown>[],
      {}
    );
  }

  return err({ code: "NO_AUXILIARY_PROVIDER", message: `No LLM provider available for auxiliary task: ${type}` });
}

// =============================================================================
// OpenAI-compatible streaming
// =============================================================================

export async function* streamOpenAI(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  const url = cfg.baseUrl || "https://api.openai.com/v1/chat/completions";
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map((m) => {
      const base: Record<string, unknown> = {
        role: m.role === "tool_result" ? "tool" : m.role,
        content: formatOpenAIMessageContent(m.content),
        name: m.name,
        tool_call_id: m.role === "tool_result" ? m.name : undefined,
      };
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const toolCalls = m.content
          .filter((b: unknown) => typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use")
          .map((b: unknown) => ({
            id: (b as { id?: string }).id || "",
            type: "function",
            function: {
              name: (b as { name?: string }).name || "",
              arguments: JSON.stringify((b as { input?: unknown }).input || {}),
            },
          }));
        if (toolCalls.length > 0) {
          base.tool_calls = toolCalls;
        }
      }
      return base;
    }),
    stream: true,
    max_tokens: cfg.maxTokens ?? 4096,
    temperature: cfg.temperature ?? 0.2,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: extractZodSchema(t.inputSchema),
      },
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey || ""}`,
    },
    body: JSON.stringify(body),
    signal: signal ? combineAbortSignals(signal, timeoutSignal(LLM_TIMEOUT_MS)) : timeoutSignal(LLM_TIMEOUT_MS),
  });

  // Surface response headers before body consumption so the resilience layer can read Retry-After
  yield { type: "response_headers", headers: Object.fromEntries(res.headers as unknown as Iterable<[string, string]>) };

  if (!res.ok) {
    const txt = await res.text();
    const err429 = new Error(`OpenAI error ${res.status}: ${txt}`);
    (err429 as unknown as { statusCode: number }).statusCode = res.status;
    throw err429;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingToolCalls = new Map<string, { type: "tool_use"; id: string; name: string; input: string }>();

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const json = safeJsonParse<Record<string, any>>(data, "OpenAI SSE");
          if (!json) continue;
          if (json.usage) {
            const u = json.usage;
            yield {
              type: "usage",
              usage: {
                promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
                completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
                totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : 0,
              },
            };
          }
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: "text", text: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const id = tc.id || tc.index;
              const existing = pendingToolCalls.get(id) || {
                type: "tool_use",
                id,
                name: "",
                input: "",
              };
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) {
                existing.input = (existing.input as string) + tc.function.arguments;
              }
              pendingToolCalls.set(id, existing);
              let parsedInput: Record<string, unknown> = {};
              if (existing.input) parsedInput = safeJsonParse<Record<string, unknown>>(existing.input, "tool call input") ?? {};
              yield {
                type: "tool_use",
                toolUse: { ...existing, input: parsedInput },
              };
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// =============================================================================
// Anthropic streaming
// =============================================================================

export async function* streamAnthropic(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  const url = cfg.baseUrl || "https://api.anthropic.com/v1/messages";

  // Separate system message
  const system = messages.find((m) => m.role === "system")?.content as string | undefined;
  const nonSystem = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: nonSystem.map((m) => ({
      role: m.role === "tool_result" ? "user" : m.role,
      content: formatAnthropicContent(m.content),
    })),
    stream: true,
    max_tokens: cfg.maxTokens ?? 4096,
    temperature: cfg.temperature ?? 0.2,
  };
  if (system) body.system = system;

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: extractZodSchema(t.inputSchema),
    }));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: signal ? combineAbortSignals(signal, timeoutSignal(LLM_TIMEOUT_MS)) : timeoutSignal(LLM_TIMEOUT_MS),
  });

  // Surface response headers before body consumption so the resilience layer can read Retry-After
  yield { type: "response_headers", headers: Object.fromEntries(res.headers as unknown as Iterable<[string, string]>) };

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${txt}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        try {
          const json = safeJsonParse<Record<string, any>>(data, "Anthropic SSE");
          if (!json) continue;
          if (json.type === "message_start" && json.message?.usage) {
            const u = json.message.usage;
            yield {
              type: "usage",
              usage: {
                promptTokens: typeof u.input_tokens === "number" ? u.input_tokens : 0,
                completionTokens: typeof u.output_tokens === "number" ? u.output_tokens : 0,
                totalTokens: (typeof u.input_tokens === "number" ? u.input_tokens : 0) + (typeof u.output_tokens === "number" ? u.output_tokens : 0),
              },
            };
          }
          if (json.type === "message_delta" && json.usage) {
            const u = json.usage;
            yield {
              type: "usage",
              usage: {
                promptTokens: 0,
                completionTokens: typeof u.output_tokens === "number" ? u.output_tokens : 0,
                totalTokens: typeof u.output_tokens === "number" ? u.output_tokens : 0,
              },
            };
          }
          if (json.type === "content_block_delta") {
            const delta = json.delta;
            if (delta.type === "text_delta") {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "input_json_delta") {
              yield {
                type: "tool_use",
                toolUse: {
                  type: "tool_use",
                  id: json.content_block?.id || "",
                  name: json.content_block?.name || "",
                  input: delta.partial_json,
                },
              };
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// =============================================================================
// Local / generic OpenAI-compatible
// =============================================================================

export async function* streamLocal(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  // Local endpoints usually speak OpenAI format
  yield* streamOpenAI({ ...cfg, baseUrl: cfg.baseUrl || "http://localhost:11434/v1/chat/completions" }, messages, tools, signal);
}

export async function* streamMinimax(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  yield* streamOpenAI(
    { ...cfg, baseUrl: cfg.baseUrl || "https://api.minimax.chat/v1/chat/completions" },
    messages,
    tools,
    signal
  );
}

export async function* streamQwen(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  yield* streamOpenAI(
    { ...cfg, baseUrl: cfg.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
    messages,
    tools,
    signal
  );
}

// =============================================================================
// Gemini streaming
// =============================================================================

export async function* streamGemini(
  cfg: LLMConfig,
  messages: BaseMessage[],
  _tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  const model = cfg.model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${encodeURIComponent(cfg.apiKey || "")}&alt=sse`;

  const system = messages.find((m) => m.role === "system")?.content as string | undefined;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: formatGeminiParts(m.content),
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: cfg.maxTokens ?? 4096,
      temperature: cfg.temperature ?? 0.2,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? combineAbortSignals(signal, timeoutSignal(LLM_TIMEOUT_MS)) : timeoutSignal(LLM_TIMEOUT_MS),
  });

  // Surface response headers before body consumption so the resilience layer can read Retry-After
  yield { type: "response_headers", headers: Object.fromEntries(res.headers as unknown as Iterable<[string, string]>) };

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini error ${res.status}: ${txt}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) throw new Error("Aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const json = safeJsonParse<Record<string, any>>(data, "Gemini SSE");
          if (!json) continue;
          if (json.usageMetadata) {
            const u = json.usageMetadata;
            yield {
              type: "usage",
              usage: {
                promptTokens: typeof u.promptTokenCount === "number" ? u.promptTokenCount : 0,
                completionTokens: typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : 0,
                totalTokens: typeof u.totalTokenCount === "number" ? u.totalTokenCount : 0,
              },
            };
          }
          const candidate = json.candidates?.[0];
          if (!candidate) continue;
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              yield { type: "text", text: part.text };
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
