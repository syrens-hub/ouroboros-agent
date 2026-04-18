/**
 * LLM Stream Helpers
 * Helper utilities for LLM streaming: signal management, schema extraction, key masking.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { safeFailOpen } from "./safe-utils.ts";

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
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export function extractZodSchema(schema: unknown): Record<string, unknown> {
  return safeFailOpen(
    () => zodToJsonSchema(schema as import("zod").ZodTypeAny, { target: "openApi3" }),
    "extractZodSchema",
    {}
  );
}
