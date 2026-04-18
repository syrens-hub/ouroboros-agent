import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleSecurity } from "../../../web/routes/handlers/security.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockGetRecentAudits = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  ReqContext: {},
  securityFramework: {
    securityAuditor: {
      getRecentAudits: (...args: unknown[]) => mockGetRecentAudits(...args),
    },
  },
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

describe("handleSecurity", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleSecurity(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/security/audits calls getRecentAudits with sessionId and limit, returns 200 success:true with audits", async () => {
    mockGetRecentAudits.mockReturnValue([{ id: "audit-1" }]);
    const res = createMockRes();
    const result = await handleSecurity(
      createMockReq("/api/security/audits?sessionId=s1&limit=5"),
      res,
      "GET",
      "/api/security/audits",
      ctx(),
    );
    expect(result).toBe(true);
    expect(mockGetRecentAudits).toHaveBeenCalledWith("s1", 5);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ id: "audit-1" }] },
      expect.any(Object),
    );
  });

  it("GET /api/security/audits handles default limit (50) when no limit param provided", async () => {
    mockGetRecentAudits.mockReturnValue([]);
    const res = createMockRes();
    const result = await handleSecurity(
      createMockReq("/api/security/audits?sessionId=s2"),
      res,
      "GET",
      "/api/security/audits",
      ctx(),
    );
    expect(result).toBe(true);
    expect(mockGetRecentAudits).toHaveBeenCalledWith("s2", 50);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [] },
      expect.any(Object),
    );
  });

  it("GET /api/security/audits returns 500 when getRecentAudits throws", async () => {
    mockGetRecentAudits.mockImplementation(() => {
      throw new Error("audit error");
    });
    const res = createMockRes();
    const result = await handleSecurity(
      createMockReq("/api/security/audits"),
      res,
      "GET",
      "/api/security/audits",
      ctx(),
    );
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "Error: audit error" } },
      expect.any(Object),
    );
  });
});
