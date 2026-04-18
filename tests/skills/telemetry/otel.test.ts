import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initOtel,
  shutdownOtel,
  getOtelStatus,
  startOtelSpan,
  endOtelSpan,
  getTracer,
} from "../../../skills/telemetry/otel.ts";
import { resetSessionStateForTests } from "../../../core/session-state.ts";
import { appConfig } from "../../../core/config.ts";

describe("otel", () => {
  const originalEnabled = appConfig.otel.enabled;
  const originalEndpoint = appConfig.otel.endpoint;

  beforeEach(() => {
    appConfig.otel.enabled = false;
    appConfig.otel.endpoint = "http://localhost:4318";
    resetSessionStateForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await shutdownOtel();
    appConfig.otel.enabled = originalEnabled;
    appConfig.otel.endpoint = originalEndpoint;
    resetSessionStateForTests();
  });

  it("getOtelStatus returns disabled when not enabled", () => {
    initOtel();
    const status = getOtelStatus();
    expect(status.enabled).toBe(false);
    expect(status.initialized).toBe(false);
  });

  it("getOtelStatus returns initialized when enabled", () => {
    appConfig.otel.enabled = true;
    initOtel();
    const status = getOtelStatus();
    expect(status.enabled).toBe(true);
    expect(status.initialized).toBe(true);
    expect(status.exporter).toBeDefined();
    expect(status.exporter!.endpoint).toBe("http://localhost:4318/v1/traces");
  });

  it("startOtelSpan returns null when OTel is disabled", () => {
    initOtel();
    const span = startOtelSpan("sess-1", "test-span");
    expect(span).toBeNull();
  });

  it("startOtelSpan creates a span when enabled", () => {
    appConfig.otel.enabled = true;
    initOtel();
    const span = startOtelSpan("sess-1", "test-span", { attributes: { foo: "bar" } });
    expect(span).not.toBeNull();
    expect(span).toBeDefined();
  });

  it("endOtelSpan does not throw when span missing", () => {
    appConfig.otel.enabled = true;
    initOtel();
    expect(() => endOtelSpan("sess-1", "missing-span")).not.toThrow();
  });

  it("endOtelSpan ends an existing span", () => {
    appConfig.otel.enabled = true;
    initOtel();
    const span = startOtelSpan("sess-1", "test-span");
    expect(span).not.toBeNull();
    endOtelSpan("sess-1", "test-span", { success: true });
    // After ending, the span should be removed from session state
    expect(() => endOtelSpan("sess-1", "test-span")).not.toThrow();
  });

  it("getTracer returns null when OTel disabled", () => {
    initOtel();
    expect(getTracer()).toBeNull();
    expect(getTracer("sess-1")).toBeNull();
  });

  it("getTracer returns a tracer when enabled", () => {
    appConfig.otel.enabled = true;
    initOtel();
    const tracer = getTracer();
    expect(tracer).not.toBeNull();
    expect(typeof tracer!.startSpan).toBe("function");
  });

  it("shutdown resets state", async () => {
    appConfig.otel.enabled = true;
    initOtel();
    expect(getOtelStatus().initialized).toBe(true);
    await shutdownOtel();
    expect(getOtelStatus().initialized).toBe(false);
  });
});
