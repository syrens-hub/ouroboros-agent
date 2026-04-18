import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleDaemon } from "../../../web/routes/handlers/daemon.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockGetDaemonStatus = vi.fn();
const mockStartDaemon = vi.fn();
const mockStopDaemon = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  ReqContext: {},
}));

vi.mock("../../../web/runner-pool.ts", () => ({
  getDaemonStatus: (...args: unknown[]) => mockGetDaemonStatus(...args),
  startDaemon: (...args: unknown[]) => mockStartDaemon(...args),
  stopDaemon: (...args: unknown[]) => mockStopDaemon(...args),
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

describe("handleDaemon", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleDaemon(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/daemon/status returns daemon status", async () => {
    mockGetDaemonStatus.mockReturnValue({ running: true, pid: 123 });
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "GET", "/api/daemon/status", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { running: true, pid: 123 } },
      expect.any(Object)
    );
  });

  it("GET /api/daemon/history returns placeholder", async () => {
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "GET", "/api/daemon/history", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { message: "History moved to evolution-memory" } },
      expect.any(Object)
    );
  });

  it("POST /api/daemon/start returns success:true when startDaemon returns true", async () => {
    mockStartDaemon.mockReturnValue(true);
    mockGetDaemonStatus.mockReturnValue({ running: true });
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "POST", "/api/daemon/start", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { running: true } },
      expect.any(Object)
    );
  });

  it("POST /api/daemon/start returns success:false when startDaemon returns false", async () => {
    mockStartDaemon.mockReturnValue(false);
    mockGetDaemonStatus.mockReturnValue({ running: false });
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "POST", "/api/daemon/start", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, data: { running: false } },
      expect.any(Object)
    );
  });

  it("POST /api/daemon/stop returns success:true when stopDaemon returns true", async () => {
    mockStopDaemon.mockReturnValue(true);
    mockGetDaemonStatus.mockReturnValue({ running: false });
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "POST", "/api/daemon/stop", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { running: false } },
      expect.any(Object)
    );
  });

  it("POST /api/daemon/stop returns success:false when stopDaemon returns false", async () => {
    mockStopDaemon.mockReturnValue(false);
    mockGetDaemonStatus.mockReturnValue({ running: true });
    const res = createMockRes();
    const result = await handleDaemon(createMockReq(), res, "POST", "/api/daemon/stop", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, data: { running: true } },
      expect.any(Object)
    );
  });
});
