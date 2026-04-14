/**
 * Ouroboros LLM Router
 * ====================
 * Unified streaming interface for OpenAI, Anthropic, and local endpoints.
 */

import type {
  BaseMessage,
  AssistantMessage,
  Tool,
  ToolUseBlock,
  TextBlock,
  Result,
} from "../types/index.ts";
import { ok, err } from "../types/index.ts";
import { sanitizeMessageForLLM } from "./prompt-defense.ts";
export { sanitizeMessageForLLM } from "./prompt-defense.ts";
import { zodToJsonSchema } from "zod-to-json-schema";

export function maskApiKey(str: string): string {
  return str
    .replace(/sk-[a-zA-Z0-9]{16,}/g, "***")
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, "Bearer ***")
    .replace(/(token\s*["\s:]+)\s*[a-zA-Z0-9_-]{16,}/gi, "$1***");
}

function extractZodSchema(schema: unknown): Record<string, unknown> {
  try {
    return zodToJsonSchema(schema as import("zod").ZodTypeAny, { target: "openApi3" });
  } catch {
    return {};
  }
}

// =============================================================================
// Provider Types
// =============================================================================

export type LLMProvider = "openai" | "anthropic" | "local" | "minimax" | "qwen" | "gemini";

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMStreamChunk {
  type: "text" | "tool_use" | "usage";
  text?: string;
  toolUse?: Partial<ToolUseBlock>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// =============================================================================
// Content formatting helpers for multimodal support
// =============================================================================

export function formatOpenAIMessageContent(content: BaseMessage["content"]): string | unknown[] {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string };
        if (b.type === "image_url" || b.type === "text") return b;
      }
      return { type: "text", text: JSON.stringify(block) };
    });
  }
  return JSON.stringify(content);
}

export function formatAnthropicContent(content: BaseMessage["content"]): string | unknown[] {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string; image_url?: { url?: string } };
        if (b.type === "text") return b;
        if (b.type === "image_url" && b.image_url?.url) {
          const url = b.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: "image",
                source: { type: "base64", media_type: match[1], data: match[2] },
              };
            }
          }
          return { type: "text", text: `[Image: ${url}]` };
        }
      }
      return { type: "text", text: JSON.stringify(block) };
    });
  }
  return JSON.stringify(content);
}

export function formatGeminiParts(content: BaseMessage["content"]): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string; image_url?: { url?: string } };
        if (b.type === "text") return { text: b.text || "" };
        if (b.type === "image_url" && b.image_url?.url) {
          const url = b.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return { inlineData: { mimeType: match[1], data: match[2] } };
            }
          }
          return { text: `[Image: ${url}]` };
        }
      }
      return { text: JSON.stringify(block) };
    });
  }
  return [{ text: JSON.stringify(content) }];
}

// =============================================================================
// OpenAI-compatible streaming
// =============================================================================

async function* streamOpenAI(
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
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
          const json = JSON.parse(data);
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
              try {
                if (existing.input) parsedInput = JSON.parse(existing.input);
              } catch {
                // leave as empty object until fully parsed
              }
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

async function* streamAnthropic(
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });

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
          const json = JSON.parse(data);
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

async function* streamLocal(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): AsyncGenerator<LLMStreamChunk> {
  // Local endpoints usually speak OpenAI format
  yield* streamOpenAI({ ...cfg, baseUrl: cfg.baseUrl || "http://localhost:11434/v1/chat/completions" }, messages, tools, signal);
}

async function* streamMinimax(
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

async function* streamQwen(
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

async function* streamGemini(
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });

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
          const json = JSON.parse(data);
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

// =============================================================================
// Unified streaming caller
// =============================================================================

export async function streamLLM(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): Promise<Result<AsyncGenerator<LLMStreamChunk>>> {
  try {
    const sanitized = messages.map(sanitizeMessageForLLM);
    let gen: AsyncGenerator<LLMStreamChunk>;
    switch (cfg.provider) {
      case "openai":
        gen = streamOpenAI(cfg, sanitized, tools, signal);
        break;
      case "anthropic":
        gen = streamAnthropic(cfg, sanitized, tools, signal);
        break;
      case "local":
        gen = streamLocal(cfg, sanitized, tools, signal);
        break;
      case "minimax":
        gen = streamMinimax(cfg, sanitized, tools, signal);
        break;
      case "qwen":
        gen = streamQwen(cfg, sanitized, tools, signal);
        break;
      case "gemini":
        gen = streamGemini(cfg, sanitized, tools, signal);
        break;
      default:
        return err({ code: "UNKNOWN_PROVIDER", message: `Unknown provider ${cfg.provider}` });
    }
    return ok(gen);
  } catch (e) {
    return err({ code: "LLM_STREAM_ERROR", message: maskApiKey(String(e)) });
  }
}

export async function callLLM(
  cfg: LLMConfig,
  messages: BaseMessage[],
  tools: Tool<unknown, unknown, unknown>[],
  signal?: AbortSignal
): Promise<Result<AssistantMessage>> {
  const streamRes = await streamLLM(cfg, messages, tools, signal);
  if (!streamRes.success) return streamRes;

  const textParts: string[] = [];
  const toolCalls = new Map<string, { id: string; name: string; input: string }>();
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for await (const chunk of streamRes.data) {
      if (signal?.aborted) {
        return err({ code: "ABORTED", message: "Request was aborted" });
      }
      if (chunk.type === "text" && chunk.text) {
        textParts.push(chunk.text);
      } else if (chunk.type === "tool_use" && chunk.toolUse) {
        const tu = chunk.toolUse as ToolUseBlock;
        const existing = toolCalls.get(tu.id) || { id: tu.id, name: tu.name || "", input: "" };
        if (tu.name) existing.name = tu.name;
        if (tu.input) {
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
    return err({ code: "LLM_STREAM_ERROR", message: maskApiKey(String(e)) });
  }

  const contentBlocks: (TextBlock | ToolUseBlock)[] = [];
  if (textParts.length > 0) {
    contentBlocks.push({ type: "text", text: textParts.join("") });
  }
  for (const tc of toolCalls.values()) {
    // Skip malformed tool calls with no name
    if (!tc.name) continue;
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(tc.input);
    } catch {
      parsedInput = { raw: tc.input };
    }
    contentBlocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: parsedInput,
    });
  }

  const usage = promptTokens > 0 || completionTokens > 0
    ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
    : undefined;

  return ok({
    role: "assistant",
    content: contentBlocks.length > 0 ? contentBlocks : textParts.join("") || "(no content)",
    usage,
  });
}
