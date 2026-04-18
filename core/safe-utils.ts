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
