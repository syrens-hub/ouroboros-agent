import { describe, it, expect, vi } from "vitest";
import { handleDreaming } from "../../../../web/routes/handlers/dreaming.ts";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";

vi.mock("../../../../skills/dreaming/index.ts", () => ({
  createDreamingMemory: () => ({
    getPromotedMemories: vi.fn().mockResolvedValue([{ id: "m1" }]),
    runConsolidation: vi.fn().mockResolvedValue({ consolidated: 5 }),
  }),
}));

describe("handleDreaming", () => {
  function mockRes(): ServerResponse & { _status?: number; _data?: string } {
    const res = new EventEmitter() as any;
    res.setHeader = () => {};
    res.writeHead = (status: number) => { res._status = status; };
    res.end = (data: string) => { res._data = data; };
    return res;
  }

  function mockCtx() {
    return { requestId: "r1", startTime: Date.now(), userId: null } as any;
  }

  it("returns 200 for GET /api/dreaming/:sessionId", async () => {
    const res = mockRes();
    const matched = await handleDreaming({} as IncomingMessage, res, "GET", "/api/dreaming/s1", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!).data).toEqual([{ id: "m1" }]);
  });

  it("returns 200 for POST /api/dreaming/:sessionId/consolidate", async () => {
    const res = mockRes();
    const matched = await handleDreaming({} as IncomingMessage, res, "POST", "/api/dreaming/s1/consolidate", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!).data).toEqual({ consolidated: 5 });
  });

  it("returns false for unmatched paths", async () => {
    const res = mockRes();
    const matched = await handleDreaming({} as IncomingMessage, res, "GET", "/api/other", mockCtx());
    expect(matched).toBe(false);
  });
});
