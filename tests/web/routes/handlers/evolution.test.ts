import { describe, it, expect, vi } from "vitest";
import { handleEvolution } from "../../../../web/routes/handlers/evolution.ts";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";

vi.mock("../../../../skills/evolution-viz/index.ts", () => ({
  getEvolutionHistory: vi.fn().mockReturnValue([{ id: "c1" }]),
  getEvolutionMetrics: vi.fn().mockReturnValue({ total: 5 }),
  getEvolutionTimeSeries: vi.fn().mockReturnValue([{ day: 1, count: 2 }]),
  enrichHistoryWithMetadata: vi.fn().mockReturnValue([{ id: "c1", meta: true }]),
  detectTrends: vi.fn().mockReturnValue({ trend: "up" }),
}));

vi.mock("../../../../skills/evolution-orchestrator/index.ts", () => ({
  resolveAndExecute: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../../../skills/evolution-version-manager/index.ts", () => ({
  evolutionVersionManager: {
    getRollbackTarget: vi.fn().mockReturnValue({ id: "v1", versionTag: "1.0.0" }),
    listVersions: vi.fn().mockReturnValue([{ id: "v1" }]),
  },
}));

vi.mock("../../../../skills/approval/index.ts", () => ({
  approvalGenerator: {
    listApprovals: vi.fn().mockReturnValue([{ id: "a1" }]),
  },
}));

vi.mock("../../../../skills/evolution-observability/index.ts", () => ({
  formatPrometheusMetrics: vi.fn().mockReturnValue("metrics"),
  getEvolutionMetricsSnapshot: vi.fn().mockReturnValue({ live: true }),
}));

vi.mock("../../../../web/routes/shared.ts", () => ({
  json: (_res: ServerResponse, status: number, body: unknown, _ctx: unknown) => {
    (_res as any)._status = status;
    (_res as any)._data = JSON.stringify(body);
  },
  readBody: vi.fn().mockResolvedValue('{"approvalId":"a1","versionId":"v1","changedFiles":["f.ts"],"approved":true}'),
  parseBody: vi.fn().mockImplementation((raw: string, _schema: unknown) => {
    try {
      const parsed = JSON.parse(raw);
      return { success: true, data: parsed };
    } catch {
      return { success: false, error: "Invalid JSON" };
    }
  }),
  ReqContext: {},
}));

describe("handleEvolution", () => {
  function mockRes(): ServerResponse & { _status?: number; _data?: string } {
    const res = new EventEmitter() as any;
    res.setHeader = () => {};
    res.writeHead = (status: number, headers: Record<string, string>) => {
      res._status = status;
      res._headers = headers;
    };
    res.end = (data: string) => { res._data = data; };
    return res;
  }

  function mockCtx() {
    return { requestId: "r1", startTime: Date.now(), userId: null } as any;
  }

  it("GET /api/evolution/history", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/history", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/metrics", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/metrics", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/trends", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/trends", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/timeseries", async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.url = "/api/evolution/timeseries?days=7";
    const res = mockRes();
    const matched = await handleEvolution(req, res, "GET", "/api/evolution/timeseries", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("POST /api/evolution/approve", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "POST", "/api/evolution/approve", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("POST /api/evolution/rollback", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "POST", "/api/evolution/rollback", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/approvals", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/approvals", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/versions", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/versions", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/live-metrics", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/live-metrics", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("GET /api/evolution/prometheus", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/prometheus", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    expect(res._data).toBe("metrics");
  });

  it("returns 400 for invalid approve body", async () => {
    const { readBody, parseBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readBody).mockResolvedValue("not-json");
    vi.mocked(parseBody).mockReturnValue({ success: false, error: "bad" });
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "POST", "/api/evolution/approve", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns 400 for invalid rollback body", async () => {
    const { readBody, parseBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readBody).mockResolvedValue("not-json");
    vi.mocked(parseBody).mockReturnValue({ success: false, error: "bad" });
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "POST", "/api/evolution/rollback", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns false for unmatched paths", async () => {
    const res = mockRes();
    const matched = await handleEvolution({} as IncomingMessage, res, "GET", "/api/evolution/other", mockCtx());
    expect(matched).toBe(false);
  });
});
