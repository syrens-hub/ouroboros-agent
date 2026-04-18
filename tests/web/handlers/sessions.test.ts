import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleSessions } from "../../../web/routes/handlers/sessions.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockReadBody = vi.fn();
const mockParseBody = vi.fn();
const mockCreateSession = vi.fn();
const mockListSessions = vi.fn();
const mockGetMessages = vi.fn();
const mockRemoveRunner = vi.fn();
const mockResolveConfirm = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  readBody: (...args: unknown[]) => mockReadBody(...args),
  parseBody: (...args: unknown[]) => mockParseBody(...args),
  ConfirmBodySchema: {},
  ReqContext: {},
}));

vi.mock("../../../core/session-db.ts", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
}));

vi.mock("../../../web/runner-pool.ts", () => ({
  removeRunner: (...args: unknown[]) => mockRemoveRunner(...args),
  resolveConfirm: (...args: unknown[]) => mockResolveConfirm(...args),
}));

const mockGetTraceEvents = vi.fn();
vi.mock("../../../core/repositories/trajectory.ts", () => ({
  getTraceEvents: (...args: unknown[]) => mockGetTraceEvents(...args),
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

describe("handleSessions", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleSessions(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/sessions", async () => {
    mockListSessions.mockReturnValue([{ sessionId: "s1", title: "Session 1" }]);
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "GET", "/api/sessions", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ sessionId: "s1", title: "Session 1" }] },
      expect.any(Object)
    );
  });

  it("POST /api/sessions creates sessionId starting with 'web_'", async () => {
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "POST", "/api/sessions", ctx());
    expect(result).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.stringMatching(/^web_\d+$/),
      { title: expect.stringContaining("Web Session") }
    );
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { sessionId: expect.stringMatching(/^web_\d+$/) } },
      expect.any(Object)
    );
  });

  it("DELETE /api/sessions/s1 calls removeRunner and returns 200", async () => {
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "DELETE", "/api/sessions/s1", ctx());
    expect(result).toBe(true);
    expect(mockRemoveRunner).toHaveBeenCalledWith("s1");
    expect(mockJson).toHaveBeenCalledWith(res, 200, { success: true }, expect.any(Object));
  });

  it("GET /api/sessions/s1/traces no query params", async () => {
    mockGetTraceEvents.mockResolvedValue({ success: true, data: [] });
    const res = createMockRes();
    const result = await handleSessions(
      createMockReq("/api/sessions/s1/traces"),
      res,
      "GET",
      "/api/sessions/s1/traces",
      ctx()
    );
    expect(result).toBe(true);
    expect(mockGetTraceEvents).toHaveBeenCalledWith("s1", undefined);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [] },
      expect.any(Object)
    );
  });

  it("GET /api/sessions/s1/traces with turn=3", async () => {
    mockGetTraceEvents.mockResolvedValue({ success: true, data: [{ traceId: "t1" }] });
    const res = createMockRes();
    const result = await handleSessions(
      createMockReq("/api/sessions/s1/traces?turn=3"),
      res,
      "GET",
      "/api/sessions/s1/traces",
      ctx()
    );
    expect(result).toBe(true);
    expect(mockGetTraceEvents).toHaveBeenCalledWith("s1", 3);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ traceId: "t1" }] },
      expect.any(Object)
    );
  });

  it("GET /api/sessions/s1/messages no query params", async () => {
    mockGetMessages.mockResolvedValue({ success: true, data: [] });
    const res = createMockRes();
    const result = await handleSessions(
      createMockReq("/api/sessions/s1/messages"),
      res,
      "GET",
      "/api/sessions/s1/messages",
      ctx()
    );
    expect(result).toBe(true);
    expect(mockGetMessages).toHaveBeenCalledWith("s1", {
      limit: undefined,
      offset: undefined,
      beforeId: undefined,
    });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [] },
      expect.any(Object)
    );
  });

  it("GET /api/sessions/s1/messages with limit=2&offset=1&beforeId=10", async () => {
    mockGetMessages.mockResolvedValue({ success: true, data: [] });
    const res = createMockRes();
    const result = await handleSessions(
      createMockReq("/api/sessions/s1/messages?limit=2&offset=1&beforeId=10"),
      res,
      "GET",
      "/api/sessions/s1/messages",
      ctx()
    );
    expect(result).toBe(true);
    expect(mockGetMessages).toHaveBeenCalledWith("s1", {
      limit: 2,
      offset: 1,
      beforeId: 10,
    });
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [] },
      expect.any(Object)
    );
  });

  it("GET /api/sessions/s1/messages when getMessages returns success:false -> 500", async () => {
    mockGetMessages.mockResolvedValue({ success: false, error: "db error" });
    const res = createMockRes();
    const result = await handleSessions(
      createMockReq("/api/sessions/s1/messages"),
      res,
      "GET",
      "/api/sessions/s1/messages",
      ctx()
    );
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: "db error" },
      expect.any(Object)
    );
  });

  it("POST /api/sessions/s1/confirm payload too large -> 413", async () => {
    mockReadBody.mockRejectedValue(new Error("PAYLOAD_TOO_LARGE"));
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "POST", "/api/sessions/s1/confirm", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      413,
      { success: false, error: { message: "Payload too large" } },
      expect.any(Object)
    );
  });

  it("POST /api/sessions/s1/confirm schema fail -> 400", async () => {
    mockReadBody.mockResolvedValue('{"allowed":"yes"}');
    mockParseBody.mockReturnValue({ success: false, error: "allowed: must be boolean" });
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "POST", "/api/sessions/s1/confirm", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      400,
      { success: false, error: { message: "allowed: must be boolean" } },
      expect.any(Object)
    );
  });

  it("POST /api/sessions/s1/confirm resolveConfirm returns true -> 200 success:true", async () => {
    mockReadBody.mockResolvedValue('{"allowed":true}');
    mockParseBody.mockReturnValue({ success: true, data: { allowed: true } });
    mockResolveConfirm.mockReturnValue(true);
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "POST", "/api/sessions/s1/confirm", ctx());
    expect(result).toBe(true);
    expect(mockResolveConfirm).toHaveBeenCalledWith("s1", true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true },
      expect.any(Object)
    );
  });

  it("POST /api/sessions/s1/confirm resolveConfirm returns false -> 200 success:false", async () => {
    mockReadBody.mockResolvedValue('{"allowed":false}');
    mockParseBody.mockReturnValue({ success: true, data: { allowed: false } });
    mockResolveConfirm.mockReturnValue(false);
    const res = createMockRes();
    const result = await handleSessions(createMockReq(), res, "POST", "/api/sessions/s1/confirm", ctx());
    expect(result).toBe(true);
    expect(mockResolveConfirm).toHaveBeenCalledWith("s1", false);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false },
      expect.any(Object)
    );
  });
});
