import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleMemory } from "../../../web/routes/handlers/memory.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockQueryMemoryLayers = vi.fn();
const mockSearchMemoryLayers = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  ReqContext: {},
}));

vi.mock("../../../core/repositories/memory-layers.ts", () => ({
  queryMemoryLayers: (...args: unknown[]) => mockQueryMemoryLayers(...args),
  searchMemoryLayers: (...args: unknown[]) => mockSearchMemoryLayers(...args),
}));

function createMockReq(url = "/") {
  return { url } as IncomingMessage;
}

function ctx() {
  return { requestId: "req-1", startTime: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleMemory", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleMemory(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/memory/layers calls queryMemoryLayers with parsed query params and returns 200 on success", async () => {
    mockQueryMemoryLayers.mockReturnValue({ success: true, data: [{ id: "layer1" }] });
    const res = createMockRes();
    const result = await handleMemory(createMockReq("/api/memory/layers?layers=a,b&limit=5"), res, "GET", "/api/memory/layers", ctx());
    expect(result).toBe(true);
    expect(mockQueryMemoryLayers).toHaveBeenCalledWith({ layers: ["a", "b"], limit: 5 });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ id: "layer1" }] },
      expect.any(Object)
    );
  });

  it("GET /api/memory/layers returns 500 when queryMemoryLayers returns failure", async () => {
    mockQueryMemoryLayers.mockReturnValue({ success: false, error: { message: "db error" } });
    const res = createMockRes();
    const result = await handleMemory(createMockReq("/api/memory/layers"), res, "GET", "/api/memory/layers", ctx());
    expect(result).toBe(true);
    expect(mockQueryMemoryLayers).toHaveBeenCalledWith({ layers: undefined, limit: 20 });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "db error" } },
      expect.any(Object)
    );
  });

  it("GET /api/memory/search calls searchMemoryLayers with parsed query params and returns 200 on success", async () => {
    mockSearchMemoryLayers.mockReturnValue({ success: true, data: [{ id: "result1" }] });
    const res = createMockRes();
    const result = await handleMemory(createMockReq("/api/memory/search?q=test&sessionId=s1&limit=15"), res, "GET", "/api/memory/search", ctx());
    expect(result).toBe(true);
    expect(mockSearchMemoryLayers).toHaveBeenCalledWith({ query: "test", sessionId: "s1", limit: 15 });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ id: "result1" }] },
      expect.any(Object)
    );
  });

  it("GET /api/memory/search returns 500 when searchMemoryLayers returns failure", async () => {
    mockSearchMemoryLayers.mockReturnValue({ success: false, error: { message: "search error" } });
    const res = createMockRes();
    const result = await handleMemory(createMockReq("/api/memory/search?q=hello"), res, "GET", "/api/memory/search", ctx());
    expect(result).toBe(true);
    expect(mockSearchMemoryLayers).toHaveBeenCalledWith({ query: "hello", sessionId: undefined, limit: 10 });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "search error" } },
      expect.any(Object)
    );
  });
});
