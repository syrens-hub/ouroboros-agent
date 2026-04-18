import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleLLM } from "../../../web/routes/handlers/llm.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockCallLLM = vi.fn();

let mockLlmCfg: Record<string, unknown> | undefined = undefined;

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
}));

vi.mock("../../../core/llm-router.ts", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

vi.mock("../../../web/runner-pool.ts", () => ({
  get llmCfg() { return mockLlmCfg; },
}));

function createMockReq(url = "/") {
  return { url } as IncomingMessage;
}

function ctx() {
  return { requestId: "req-1", startTime: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLlmCfg = undefined;
});

describe("handleLLM", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleLLM(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("POST /api/llm/test returns 200 success:false when LLM not configured", async () => {
    const res = createMockRes();
    const result = await handleLLM(createMockReq(), res, "POST", "/api/llm/test", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, error: { message: "LLM not configured. Set LLM_API_KEY and LLM_PROVIDER in .env" } },
      expect.any(Object)
    );
  });

  it("POST /api/llm/test returns 200 success:true with response text when callLLM succeeds", async () => {
    mockLlmCfg = { apiKey: "test-key" };
    mockCallLLM.mockResolvedValue({ success: true, data: { content: "PONG" } });
    const res = createMockRes();
    const result = await handleLLM(createMockReq(), res, "POST", "/api/llm/test", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { response: "PONG" } },
      expect.any(Object)
    );
    expect(mockCallLLM).toHaveBeenCalledWith(
      mockLlmCfg,
      [{ role: "user", content: "Say 'PONG' and nothing else." }],
      []
    );
  });

  it("POST /api/llm/test returns 200 success:false with error when callLLM returns success: false", async () => {
    mockLlmCfg = { apiKey: "test-key" };
    mockCallLLM.mockResolvedValue({ success: false, error: { message: "LLM error" } });
    const res = createMockRes();
    const result = await handleLLM(createMockReq(), res, "POST", "/api/llm/test", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, error: { message: "LLM error" } },
      expect.any(Object)
    );
  });

  it("POST /api/llm/test returns 200 success:false when callLLM throws", async () => {
    mockLlmCfg = { apiKey: "test-key" };
    mockCallLLM.mockRejectedValue(new Error("network failure"));
    const res = createMockRes();
    const result = await handleLLM(createMockReq(), res, "POST", "/api/llm/test", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, error: { message: "Error: network failure" } },
      expect.any(Object)
    );
  });
});
