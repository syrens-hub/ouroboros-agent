/**
 * Ouroboros LLM Router
 * Unified streaming interface for OpenAI, Anthropic, and local endpoints.
 *
 * This file re-exports types and entry points for backward compatibility.
 * Implementation details have been moved to:
 *   - llm-stream-helpers.ts   (signal management, key masking, schema extraction)
 *   - llm-stream-providers.ts (per-provider streaming implementations)
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

// Re-export helpers from llm-stream-helpers for backward compatibility
export { maskApiKey, extractZodSchema } from "./llm-stream-helpers.ts";
import { maskApiKey } from "./llm-stream-helpers.ts";

// Re-export stream providers
import {
  streamOpenAI,
  streamAnthropic,
  streamLocal,
  streamMinimax,
  streamQwen,
  streamGemini,
} from "./llm-stream-providers.ts";

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

export type LLMStreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUse: Partial<ToolUseBlock> }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "response_headers"; headers: Record<string, string> };

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
