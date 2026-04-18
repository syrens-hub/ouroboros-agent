/**
 * OTLP HTTP Span Exporter (lightweight)
 * =====================================
 * Custom SpanExporter that sends OTLP/JSON over HTTP without requiring
 * the heavy @opentelemetry/exporter-trace-otlp-http package.
 */

import { request } from "http";
import { request as httpsRequest } from "https";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { logger } from "../../core/logger.ts";

export interface OTLPExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface OTLPAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean };
}

function toAttributeValue(value: unknown): OTLPAttribute["value"] {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { intValue: value };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function toAttributes(attrs: Record<string, unknown>): OTLPAttribute[] {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: toAttributeValue(value) }));
}

function timeToNanos(time: [number, number] | Date | number): string {
  if (Array.isArray(time)) {
    const [seconds, nanos] = time;
    return String(seconds * 1_000_000_000 + nanos);
  }
  if (time instanceof Date) {
    return String(time.getTime() * 1_000_000);
  }
  return String(time * 1_000_000_000);
}

export class OTLPHTTPExporter implements SpanExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private _shutdown = false;
  private _exportedCount = 0;
  private _lastError?: string;
  private _pending = 0;

  constructor(config: OTLPExporterConfig) {
    this.endpoint = config.endpoint.endsWith("/v1/traces")
      ? config.endpoint
      : config.endpoint.replace(/\/$/, "") + "/v1/traces";
    this.headers = config.headers || {};
    this.timeoutMs = config.timeoutMs || 10_000;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this._shutdown || spans.length === 0) {
      resultCallback({ code: 0 } as ExportResult);
      return;
    }

    const payload = this._buildPayload(spans);
    const body = JSON.stringify(payload);
    const url = new URL(this.endpoint);
    const reqFn = url.protocol === "https:" ? httpsRequest : request;

    this._pending += 1;
    const req = reqFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...this.headers,
      },
      timeout: this.timeoutMs,
    }, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        this._pending -= 1;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          this._exportedCount += spans.length;
          this._lastError = undefined;
          resultCallback({ code: 0 } as ExportResult);
        } else {
          const msg = `OTLP export failed: HTTP ${res.statusCode} ${responseBody.slice(0, 200)}`;
          this._lastError = msg;
          logger.warn(msg);
          resultCallback({ code: 1, error: new Error(msg) } as ExportResult);
        }
      });
    });

    req.on("error", (err) => {
      this._pending -= 1;
      const msg = `OTLP export error: ${err.message}`;
      this._lastError = msg;
      logger.warn(msg);
      resultCallback({ code: 1, error: err } as ExportResult);
    });

    req.on("timeout", () => {
      req.destroy();
      this._pending -= 1;
      const msg = "OTLP export timeout";
      this._lastError = msg;
      logger.warn(msg);
      resultCallback({ code: 1, error: new Error(msg) } as ExportResult);
    });

    req.write(body);
    req.end();
  }

  shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }

  getStatus() {
    return {
      exportedCount: this._exportedCount,
      pending: this._pending,
      lastError: this._lastError,
      endpoint: this.endpoint,
    };
  }

  private _buildPayload(spans: ReadableSpan[]) {
    // Group spans by resource/scope for minimal correctness
    const resourceAttributes = spans[0]?.resource?.attributes || {};
    const scope = spans[0]?.instrumentationScope || { name: "ouroboros-agent", version: "0.1.0" };

    return {
      resourceSpans: [
        {
          resource: {
            attributes: toAttributes(resourceAttributes as Record<string, unknown>),
          },
          scopeSpans: [
            {
              scope: {
                name: scope.name,
                version: scope.version,
              },
              spans: spans.map((span) => ({
                traceId: span.spanContext().traceId,
                spanId: span.spanContext().spanId,
                parentSpanId: span.parentSpanContext?.spanId || undefined,
                name: span.name,
                kind: span.kind ?? 1,
                startTimeUnixNano: timeToNanos(span.startTime),
                endTimeUnixNano: span.endTime ? timeToNanos(span.endTime) : undefined,
                attributes: toAttributes(span.attributes as Record<string, unknown>),
                status: {
                  code: span.status.code ?? 0,
                  message: span.status.message || undefined,
                },
                events: (span.events || []).map((e) => ({
                  timeUnixNano: timeToNanos(e.time as [number, number] | Date | number),
                  name: e.name,
                  attributes: e.attributes ? toAttributes(e.attributes as Record<string, unknown>) : undefined,
                })),
                links: (span.links || []).map((l) => ({
                  traceId: l.context.traceId,
                  spanId: l.context.spanId,
                  attributes: l.attributes ? toAttributes(l.attributes as Record<string, unknown>) : undefined,
                })),
              })),
            },
          ],
        },
      ],
    };
  }
}
