/**
 * Telemetry Spans
 * ===============
 * Lightweight span helpers that fallback to trace_events when OpenTelemetry
 * SDK is unavailable.
 */

import { performance } from "perf_hooks";
import { logger } from "../../core/logger.ts";
import { startOtelSpan, endOtelSpan } from "./otel.ts";

export interface Span {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
}

const activeSpans = new Map<string, Span[]>();

function spanKey(sessionId: string, name: string): string {
  return `${sessionId}::${name}`;
}

export function startSpan(sessionId: string, name: string, attributes: Record<string, unknown> = {}): Span {
  const span: Span = { name, startTime: performance.now(), attributes };
  const key = spanKey(sessionId, name);
  const list = activeSpans.get(key) || [];
  list.push(span);
  activeSpans.set(key, list);
  startOtelSpan(sessionId, name, { attributes });
  return span;
}

export function endSpan(sessionId: string, name: string, extraAttributes: Record<string, unknown> = {}): void {
  const key = spanKey(sessionId, name);
  const list = activeSpans.get(key);
  const span = list?.pop();
  if (span) {
    span.endTime = performance.now();
    Object.assign(span.attributes, extraAttributes);
    logger.debug("Span ended", { sessionId, name, durationMs: Math.round(span.endTime - span.startTime) });
  }
  endOtelSpan(sessionId, name, extraAttributes);
}

export function startTurnSpan(sessionId: string, turn: number): Span {
  return startSpan(sessionId, "agent:turn", { turn });
}

export function endTurnSpan(sessionId: string, success: boolean): void {
  endSpan(sessionId, "agent:turn", { success });
}

export function startToolSpan(sessionId: string, turn: number, toolName: string): Span {
  return startSpan(sessionId, `tool:${toolName}`, { turn, toolName });
}

export function endToolSpan(sessionId: string, toolName: string, success: boolean, errorClass?: string): void {
  endSpan(sessionId, `tool:${toolName}`, { success, errorClass });
}

export function resetSpansForTests(): void {
  activeSpans.clear();
}
