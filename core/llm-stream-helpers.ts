/**
 * LLM Stream Helpers
 * Helper utilities for LLM streaming: signal management, schema extraction, key masking.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { safeFailOpen } from "./safe-utils.ts";
import type { BaseMessage } from "../types/index.ts";

export function maskApiKey(str: string): string {
  return str
    .replace(/sk-[a-zA-Z0-9]{16,}/g, "***")
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, "Bearer ***")
    .replace(/(token\s*["\s:]+)\s*[a-zA-Z0-9_-]{16,}/gi, "$1***");
}

export function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => !!s);
  if (valid.length === 0) {
    const ctrl = new AbortController();
    return ctrl.signal;
  }
  if (typeof AbortSignal !== "undefined" && "any" in AbortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any(valid);
  }
  // Polyfill for Node.js < 20.3.0
  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener("abort", () => {
      if (valid.every((sig) => sig.aborted)) controller.abort();
    }, { once: true });
  }
  return controller.signal;
}

export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  // Polyfill for Node.js < 20.11.0
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  // Clean up the timer if the signal is externally aborted (e.g., request completed early)
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return ctrl.signal;
}

export function extractZodSchema(schema: unknown): Record<string, unknown> {
  return safeFailOpen(
    () => zodToJsonSchema(schema as import("zod").ZodTypeAny, { target: "openApi3" }),
    "extractZodSchema",
    {}
  );
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

export function formatGeminiParts(
  content: BaseMessage["content"]
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
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
