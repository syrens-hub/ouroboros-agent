import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OTLPHTTPExporter } from "../../../skills/telemetry/otel-exporter.ts";
import { EventEmitter } from "events";
import { request as httpRequest } from "http";


vi.mock("http", () => ({ request: vi.fn() }));
vi.mock("https", () => ({ request: vi.fn() }));

describe("OTLPHTTPExporter", () => {
  const endpoint = "http://localhost:4318";
  let exporter: OTLPHTTPExporter;

  beforeEach(() => {
    vi.clearAllMocks();
    exporter = new OTLPHTTPExporter({ endpoint });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes endpoint to /v1/traces", () => {
    const e1 = new OTLPHTTPExporter({ endpoint: "http://host:4318" });
    expect((e1 as unknown as Record<string, string>).endpoint).toBe("http://host:4318/v1/traces");

    const e2 = new OTLPHTTPExporter({ endpoint: "http://host:4318/" });
    expect((e2 as unknown as Record<string, string>).endpoint).toBe("http://host:4318/v1/traces");

    const e3 = new OTLPHTTPExporter({ endpoint: "http://host:4318/v1/traces" });
    expect((e3 as unknown as Record<string, string>).endpoint).toBe("http://host:4318/v1/traces");
  });

  it("uses https when endpoint protocol is https", () => {
    const e = new OTLPHTTPExporter({ endpoint: "https://host:4317" });
    expect((e as unknown as Record<string, string>).endpoint).toBe("https://host:4317/v1/traces");
  });

  it("returns immediately on shutdown", () => {
    exporter.shutdown();
    const cb = vi.fn();
    exporter.export([], cb);
    expect(cb).toHaveBeenCalledWith({ code: 0 });
  });

  it("returns immediately when no spans", () => {
    const cb = vi.fn();
    exporter.export([], cb);
    expect(cb).toHaveBeenCalledWith({ code: 0 });
  });

  it("exports successfully over http", () => {
    const mockRes = new EventEmitter();
    (mockRes as any).statusCode = 200;
    const mockReq = new EventEmitter();
    (mockReq as any).write = vi.fn();
    (mockReq as any).end = vi.fn();
    (mockReq as any).destroy = vi.fn();

    vi.mocked(httpRequest).mockImplementation((_url: any, _opts: any, cb: any) => {
      setTimeout(() => cb(mockRes), 0);
      return mockReq as any;
    });

    const cb = vi.fn();
    const span = {
      spanContext: () => ({ traceId: "abc", spanId: "def" }),
      parentSpanContext: { spanId: "parent" },
      name: "test-span",
      kind: 1,
      startTime: [1, 0] as [number, number],
      endTime: [2, 0] as [number, number],
      attributes: { key: "value" },
      status: { code: 0, message: "" },
      events: [],
      links: [],
      resource: { attributes: { service: "test" } },
      instrumentationScope: { name: "test-scope", version: "1.0" },
    } as any;

    exporter.export([span], cb);

    setTimeout(() => mockRes.emit("data", "ok"), 1);
    setTimeout(() => mockRes.emit("end"), 2);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalledWith({ code: 0 });
        expect((exporter as any).getStatus().exportedCount).toBe(1);
        resolve();
      }, 20);
    });
  });

  it("handles http error response", () => {
    const mockRes = new EventEmitter();
    (mockRes as any).statusCode = 500;
    const mockReq = new EventEmitter();
    (mockReq as any).write = vi.fn();
    (mockReq as any).end = vi.fn();
    (mockReq as any).destroy = vi.fn();

    vi.mocked(httpRequest).mockImplementation((_url: any, _opts: any, cb: any) => {
      setTimeout(() => cb(mockRes), 0);
      return mockReq as any;
    });

    const cb = vi.fn();
    const span = {
      spanContext: () => ({ traceId: "abc", spanId: "def" }),
      name: "test-span",
      kind: 1,
      startTime: [1, 0] as [number, number],
      endTime: [2, 0] as [number, number],
      attributes: {},
      status: { code: 0 },
      events: [],
      links: [],
      resource: { attributes: {} },
      instrumentationScope: { name: "test-scope", version: "1.0" },
    } as any;

    exporter.export([span], cb);

    setTimeout(() => mockRes.emit("data", "Internal Server Error"), 1);
    setTimeout(() => mockRes.emit("end"), 2);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
        expect((exporter as any).getStatus().lastError).toContain("OTLP export failed");
        resolve();
      }, 20);
    });
  });

  it("handles request error", () => {
    const mockReq = new EventEmitter();
    (mockReq as any).write = vi.fn();
    (mockReq as any).end = vi.fn();
    (mockReq as any).destroy = vi.fn();

    vi.mocked(httpRequest).mockImplementation((_url: any, _opts: any, _cb: any) => {
      setTimeout(() => mockReq.emit("error", new Error("ECONNREFUSED")), 0);
      return mockReq as any;
    });

    const cb = vi.fn();
    const span = {
      spanContext: () => ({ traceId: "abc", spanId: "def" }),
      name: "test-span",
      kind: 1,
      startTime: [1, 0] as [number, number],
      endTime: [2, 0] as [number, number],
      attributes: {},
      status: { code: 0 },
      events: [],
      links: [],
      resource: { attributes: {} },
      instrumentationScope: { name: "test-scope", version: "1.0" },
    } as any;

    exporter.export([span], cb);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
        expect((exporter as any).getStatus().lastError).toContain("ECONNREFUSED");
        resolve();
      }, 20);
    });
  });

  it("handles request timeout", () => {
    const mockReq = new EventEmitter();
    (mockReq as any).write = vi.fn();
    (mockReq as any).end = vi.fn();
    (mockReq as any).destroy = vi.fn();

    vi.mocked(httpRequest).mockImplementation((_url: any, _opts: any, _cb: any) => {
      setTimeout(() => mockReq.emit("timeout"), 0);
      return mockReq as any;
    });

    const cb = vi.fn();
    const span = {
      spanContext: () => ({ traceId: "abc", spanId: "def" }),
      name: "test-span",
      kind: 1,
      startTime: [1, 0] as [number, number],
      endTime: [2, 0] as [number, number],
      attributes: {},
      status: { code: 0 },
      events: [],
      links: [],
      resource: { attributes: {} },
      instrumentationScope: { name: "test-scope", version: "1.0" },
    } as any;

    exporter.export([span], cb);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
        expect((exporter as any).getStatus().lastError).toContain("timeout");
        expect((mockReq as any).destroy).toHaveBeenCalled();
        resolve();
      }, 20);
    });
  });

  it("builds payload with Date and hrtime and events/links", () => {
    const mockRes = new EventEmitter();
    (mockRes as any).statusCode = 200;
    const mockReq = new EventEmitter();
    (mockReq as any).write = vi.fn();
    (mockReq as any).end = vi.fn();
    (mockReq as any).destroy = vi.fn();

    vi.mocked(httpRequest).mockImplementation((_url: any, _opts: any, cb: any) => {
      setTimeout(() => cb(mockRes), 0);
      return mockReq as any;
    });

    const cb = vi.fn();
    const span = {
      spanContext: () => ({ traceId: "abc", spanId: "def" }),
      parentSpanContext: { spanId: "parent" },
      name: "test-span",
      kind: 2,
      startTime: new Date("2024-01-01T00:00:00.000Z"),
      endTime: 1704067200,
      attributes: { count: 42, ratio: 3.14, active: true, obj: { nested: 1 } },
      status: { code: 1, message: "ok" },
      events: [{ time: [1, 500000000], name: "event1", attributes: { a: 1 } }],
      links: [{ context: { traceId: "link-trace", spanId: "link-span" }, attributes: { b: 2 } }],
      resource: { attributes: { service: "test" } },
      instrumentationScope: { name: "test-scope", version: "1.0" },
    } as any;

    exporter.export([span], cb);

    setTimeout(() => mockRes.emit("data", ""), 1);
    setTimeout(() => mockRes.emit("end"), 2);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalledWith({ code: 0 });
        const body = (mockReq as any).write.mock.calls[0][0];
        const payload = JSON.parse(body);
        expect(payload.resourceSpans[0].resource.attributes).toContainEqual({ key: "service", value: { stringValue: "test" } });
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes).toContainEqual({ key: "count", value: { intValue: 42 } });
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes).toContainEqual({ key: "ratio", value: { doubleValue: 3.14 } });
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes).toContainEqual({ key: "active", value: { boolValue: true } });
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].events).toHaveLength(1);
        expect(payload.resourceSpans[0].scopeSpans[0].spans[0].links).toHaveLength(1);
        resolve();
      }, 20);
    });
  });
});
