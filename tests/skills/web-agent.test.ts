import { describe, it, expect, vi, beforeEach } from "vitest";
import type http from "http";

vi.mock("http", () => ({
  default: {
    request: vi.fn(),
  },
  request: vi.fn(),
}));

vi.mock("https", () => ({
  default: {
    request: vi.fn(),
  },
  request: vi.fn(),
}));

import httpModule from "http";
import httpsModule from "https";

const mockedHttpRequest = httpModule.request as unknown as ReturnType<typeof vi.fn>;
const mockedHttpsRequest = httpsModule.request as unknown as ReturnType<typeof vi.fn>;

async function importTool() {
  vi.resetModules();
  const mod = await import("../../skills/web-agent/index.ts");
  return mod.webAgentTool;
}

function dummyCtx() {
  return {
    taskId: "test-task",
    abortSignal: new AbortController().signal,
    reportProgress: () => {},
    invokeSubagent: async <_I, O>() => ({} as unknown as O),
  };
}

function createMockRequest() {
  const eventMap = new Map<string, Array<(...args: any[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const list = eventMap.get(event) ?? [];
      list.push(handler);
      eventMap.set(event, list);
    }),
    destroy: vi.fn(),
    end: vi.fn(),
    emit(event: string, ...args: any[]) {
      (eventMap.get(event) ?? []).forEach((h) => h(...args));
    },
  };
}

function createMockResponse(overrides: { statusCode?: number; headers?: http.IncomingHttpHeaders } = {}) {
  const eventMap = new Map<string, Array<(...args: any[]) => void>>();
  return {
    statusCode: overrides.statusCode ?? 200,
    headers: overrides.headers ?? {},
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const list = eventMap.get(event) ?? [];
      list.push(handler);
      eventMap.set(event, list);
    }),
    emit(event: string, ...args: any[]) {
      (eventMap.get(event) ?? []).forEach((h) => h(...args));
    },
  };
}

describe("webAgentTool", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockedHttpRequest.mockReset();
    mockedHttpsRequest.mockReset();
  });

  it("returns success with title, description, chineseText, linkCount, imageCount, contentLength", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit(
            "data",
            '<html><head><title>Example Site</title><meta name="description" content="An example description"></head><body><a href="/1">Link 1</a><a href="/2">Link 2</a><img src="a.jpg"><img src="b.jpg"><p>你好世界，欢迎来到示例网站</p></body></html>'
          );
          mockRes.emit("end");
        });
      });
      return createMockRequest();
    });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.title).toBe("Example Site");
    expect(result.data.description).toBe("An example description");
    expect(result.data.chineseText).toBe("你好世界 欢迎来到示例网站");
    expect(result.data.linkCount).toBe(2);
    expect(result.data.imageCount).toBe(2);
    expect(result.data.contentLength).toBeGreaterThan(0);
    expect(result.data.url).toBe("https://example.com");
  });

  it("follows absolute redirect location", async () => {
    const webAgentTool = await importTool();
    const redirectRes = createMockResponse({
      statusCode: 302,
      headers: { location: "https://example.com/final" },
    });
    const finalRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest
      .mockImplementationOnce((options: any, callback?: any) => {
        setImmediate(() => {
          if (callback) callback(redirectRes);
        });
        return createMockRequest();
      })
      .mockImplementationOnce((options: any, callback?: any) => {
        setImmediate(() => {
          if (callback) callback(finalRes);
          setImmediate(() => {
            finalRes.emit("data", "<html><title>Final</title></html>");
            finalRes.emit("end");
          });
        });
        return createMockRequest();
      });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("Final");
    expect(result.data.url).toBe("https://example.com/final");
  });

  it("follows relative redirect location", async () => {
    const webAgentTool = await importTool();
    const redirectRes = createMockResponse({
      statusCode: 301,
      headers: { location: "/relative-path" },
    });
    const finalRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest
      .mockImplementationOnce((options: any, callback?: any) => {
        setImmediate(() => {
          if (callback) callback(redirectRes);
        });
        return createMockRequest();
      })
      .mockImplementationOnce((options: any, callback?: any) => {
        setImmediate(() => {
          if (callback) callback(finalRes);
          setImmediate(() => {
            finalRes.emit("data", "<html><title>Relative</title></html>");
            finalRes.emit("end");
          });
        });
        return createMockRequest();
      });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("Relative");
  });

  it("rejects when redirects exceed MAX_REDIRECTS", async () => {
    const webAgentTool = await importTool();
    const redirectRes = createMockResponse({
      statusCode: 302,
      headers: { location: "https://example.com/loop" },
    });

    for (let i = 0; i < 6; i++) {
      mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
        setImmediate(() => {
          if (callback) callback(redirectRes);
        });
        return createMockRequest();
      });
    }

    await expect(
      webAgentTool.call({ url: "https://example.com" }, dummyCtx())
    ).rejects.toThrow("Too many redirects");
  });

  it("truncates content when body exceeds MAX_CONTENT_LENGTH", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });
    const mockReq = createMockRequest();

    mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit("data", "x".repeat(500_001));
          mockRes.emit("end");
        });
      });
      return mockReq;
    });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.contentLength).toBe(500_000 + "\n\n[Content truncated due to size limit]".length);
    expect(mockReq.destroy).toHaveBeenCalled();
  });

  it("rejects on request timeout", async () => {
    const webAgentTool = await importTool();
    const mockReq = createMockRequest();

    mockedHttpsRequest.mockImplementationOnce((_options: unknown, _callback?: unknown) => {
      setImmediate(() => {
        mockReq.emit("timeout");
      });
      return mockReq;
    });

    await expect(
      webAgentTool.call({ url: "https://example.com" }, dummyCtx())
    ).rejects.toThrow("Request timeout");
    expect(mockReq.destroy).toHaveBeenCalled();
  });

  it("rejects on network error", async () => {
    const webAgentTool = await importTool();
    const mockReq = createMockRequest();

    mockedHttpsRequest.mockImplementationOnce((_options: unknown, _callback?: unknown) => {
      setImmediate(() => {
        mockReq.emit("error", new Error("ECONNREFUSED"));
      });
      return mockReq;
    });

    await expect(
      webAgentTool.call({ url: "https://example.com" }, dummyCtx())
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("handles missing title gracefully", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit("data", "<html><head></head><body></body></html>");
          mockRes.emit("end");
        });
      });
      return createMockRequest();
    });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("");
  });

  it("handles missing description gracefully", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit("data", "<html><title>Page</title></html>");
          mockRes.emit("end");
        });
      });
      return createMockRequest();
    });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe("");
  });

  it("handles missing chinese text gracefully", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpsRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit("data", "<html><title>No Chinese</title><body><p>Hello world</p></body></html>");
          mockRes.emit("end");
        });
      });
      return createMockRequest();
    });

    const result = await webAgentTool.call({ url: "https://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chineseText).toBeUndefined();
  });

  it("uses http module for non-https URLs", async () => {
    const webAgentTool = await importTool();
    const mockRes = createMockResponse({ statusCode: 200, headers: {} });

    mockedHttpRequest.mockImplementationOnce((options: any, callback?: any) => {
      setImmediate(() => {
        if (callback) callback(mockRes);
        setImmediate(() => {
          mockRes.emit("data", "<html><title>HTTP Site</title></html>");
          mockRes.emit("end");
        });
      });
      return createMockRequest();
    });

    const result = await webAgentTool.call({ url: "http://example.com" }, dummyCtx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.title).toBe("HTTP Site");
    expect(mockedHttpRequest).toHaveBeenCalledTimes(1);
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
  });
});
