/**
 * OpenTelemetry Integration
 * =========================
 * Optional OTel SDK wrapper. Falls back to no-op when SDK is unavailable
 * or disabled.
 */

import { trace, context, type Tracer, type Span as ApiSpan, type Context as ApiContext } from "@opentelemetry/api";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { logger } from "../../core/logger.ts";
import { appConfig } from "../../core/config.ts";
import { OTLPHTTPExporter } from "./otel-exporter.ts";
import { getSessionState } from "../../core/session-state.ts";

let provider: BasicTracerProvider | null = null;
let exporter: OTLPHTTPExporter | null = null;
let globalTracer: Tracer | null = null;
let isInitialized = false;

export interface OtelStatus {
  enabled: boolean;
  initialized: boolean;
  exporter?: {
    endpoint: string;
    exportedCount: number;
    pending: number;
    lastError?: string;
  };
}

export function initOtel(): void {
  if (isInitialized) return;
  isInitialized = true;

  if (!appConfig.otel.enabled) {
    logger.info("OpenTelemetry disabled");
    return;
  }

  try {
    const resource = resourceFromAttributes({
      "service.name": appConfig.otel.serviceName,
      "service.version": appConfig.otel.serviceVersion,
    });

    exporter = new OTLPHTTPExporter({
      endpoint: appConfig.otel.endpoint,
      headers: appConfig.otel.headers,
      timeoutMs: appConfig.otel.timeoutMs,
    });

    provider = new BasicTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);

    globalTracer = trace.getTracer("ouroboros-agent", "0.1.0");
    logger.info("OpenTelemetry initialized", { endpoint: appConfig.otel.endpoint });
  } catch (e) {
    logger.warn("OpenTelemetry initialization failed", { error: String(e) });
    provider = null;
    exporter = null;
    globalTracer = null;
  }
}

export function getTracer(sessionId?: string): Tracer | null {
  if (!globalTracer) return null;
  if (sessionId) {
    // Optionally return a session-scoped tracer name for easier filtering
    return trace.getTracer(`ouroboros-agent:${sessionId}`, "0.1.0");
  }
  return globalTracer;
}

export function startOtelSpan(
  sessionId: string,
  name: string,
  options?: { attributes?: Record<string, unknown>; parent?: ApiSpan }
): ApiSpan | null {
  const tracer = getTracer(sessionId);
  if (!tracer) return null;
  let ctx: ApiContext | undefined;
  // If a parent span is provided, make it the active context
  if (options?.parent) {
    ctx = trace.setSpan(context.active(), options.parent);
  }
  const span = tracer.startSpan(name, { attributes: options?.attributes as Record<string, string | number | boolean | undefined> }, ctx);
  // Store in session state so endOtelSpan can retrieve it
  const state = getSessionState(sessionId);
  if (!state.otel.spanMap) state.otel.spanMap = new Map<string, ApiSpan>();
  state.otel.spanMap.set(name, span);
  return span;
}

export function endOtelSpan(sessionId: string, name: string, extraAttributes?: Record<string, unknown>): void {
  const state = getSessionState(sessionId);
  const span = state.otel.spanMap?.get(name) as ApiSpan | undefined;
  if (span) {
    if (extraAttributes) {
      Object.entries(extraAttributes).forEach(([k, v]) => (span as ApiSpan).setAttribute(k, v as string | number | boolean));
    }
    (span as ApiSpan).end();
    state.otel.spanMap?.delete(name);
  }
}

export function getOtelStatus(): OtelStatus {
  if (!appConfig.otel.enabled) {
    return { enabled: false, initialized: false };
  }
  return {
    enabled: true,
    initialized: !!provider && !!globalTracer,
    exporter: exporter
      ? {
          endpoint: exporter.getStatus().endpoint,
          exportedCount: exporter.getStatus().exportedCount,
          pending: exporter.getStatus().pending,
          lastError: exporter.getStatus().lastError,
        }
      : undefined,
  };
}

export async function shutdownOtel(): Promise<void> {
  if (provider) {
    try {
      await provider.shutdown();
      logger.info("OpenTelemetry provider shut down");
    } catch (e) {
      logger.warn("OpenTelemetry shutdown error", { error: String(e) });
    }
    provider = null;
  }
  exporter = null;
  globalTracer = null;
  isInitialized = false;
}
