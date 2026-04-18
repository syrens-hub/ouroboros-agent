/**
 * LLM Shared Types
 * ================
 * Extracted to break circular dependency between llm-router and llm-stream-providers.
 */

import type { ToolUseBlock } from "../types/index.ts";

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
