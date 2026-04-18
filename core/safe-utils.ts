/**
 * Safe execution utilities for unified error-handling strategy.
 *
 * Security principle:
 *   - Security-sensitive code (permissions, rule engine, validation) MUST fail-closed.
 *   - Infrastructure probes (table existence, process liveness) MAY fail-open,
 *     but must be logged.
 *   - Cleanup/close operations SHOULD be ignored silently (with debug logs).
 */

import { logger } from "./logger.ts";

export function safeFailClosed<T>(fn: () => T, context: string, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    logger.warn(`[fail-closed] ${context}`, { error: String(e) });
    return fallback;
  }
}

export async function safeFailClosedAsync<T>(
  fn: () => Promise<T>,
  context: string,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logger.warn(`[fail-closed] ${context}`, { error: String(e) });
    return fallback;
  }
}

export function safeFailOpen<T>(fn: () => T, context: string, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    logger.info(`[fail-open] ${context}`, { error: String(e) });
    return fallback;
  }
}

export async function safeFailOpenAsync<T>(
  fn: () => Promise<T>,
  context: string,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logger.info(`[fail-open] ${context}`, { error: String(e) });
    return fallback;
  }
}

export function safeIgnore(fn: () => void, context: string): void {
  try {
    fn();
  } catch (e) {
    logger.debug(`[safe-ignore] ${context}`, { error: String(e) });
  }
}

/**
 * Strip credentials from a string for safe logging.
 * Replaces API keys, tokens, passwords, and Bearer tokens with ***.
 */
export function credentialStrip(str: string): string {
  let result = str;
  const replacements: [RegExp, string][] = [
    // key=value 或 key: value 格式
    [/([a-zA-Z0-9_-]*(api[_-]?key|token|secret|password|auth|credential)[\s]*[:=][\s]*["']?)[^"']+["']?/gi, "$1***"],
    // Bearer token
    [/bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer ***"],
    // Authorization: Bearer xxx
    [/authorization:\s*bearer\s+[a-zA-Z0-9_.-]+/gi, "Authorization: Bearer ***"],
    // X-Api-Key: xxx
    [/x-api-key:\s*[a-zA-Z0-9_.-]+/gi, "X-Api-Key: ***"],
    // 连接字符串中的密码 (user:pass@host)
    [/[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+@/g, "***:***@"],
  ];
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// =============================================================================
// Safe JSON Parsing
// =============================================================================

/**
 * Safely parse JSON text with logging and fallback.
 *
 * Usage patterns:
 *   safeJsonParse(text)                    → returns parsed value or undefined
 *   safeJsonParse(text, "context")         → same, logs on failure
 *   safeJsonParse(text, "context", fallback) → returns fallback on failure
 */
export function safeJsonParse<T = unknown>(text: string): T | undefined;
export function safeJsonParse<T = unknown>(text: string, context: string): T | undefined;
export function safeJsonParse<T = unknown>(text: string, context: string, fallback: T): T;
export function safeJsonParse<T = unknown>(
  text: string,
  context?: string,
  fallback?: T
): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    if (context) {
      logger.warn(`[safeJsonParse] ${context} failed`, {
        error: String(e),
        preview: text.length > 200 ? text.slice(0, 200) + "..." : text,
      });
    }
    return fallback;
  }
}
