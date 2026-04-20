import { describe, it, expect, vi } from "vitest";
import { handleBrowser } from "../../../../web/routes/handlers/browser.ts";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";

vi.mock("../../../../web/routes/shared.ts", () => ({
  json: (_res: ServerResponse, status: number, body: unknown, _ctx: unknown) => {
    (_res as any)._status = status;
    (_res as any)._data = JSON.stringify(body);
  },
  readJsonBody: vi.fn().mockImplementation(async (_req: IncomingMessage, _schema: unknown) => {
    const req2 = _req as IncomingMessage & { _failParse?: boolean };
    if (req2._failParse) {
      return { success: false, error: "Invalid body", status: 400 };
    }
    return { success: true, data: { pageId: "p1" } };
  }),
  ReqContext: {},
  apiBrowserController: {
    evaluate: vi.fn().mockResolvedValue("extracted text"),
    screenshot: vi.fn().mockResolvedValue("/path/to/screenshot.png"),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("handleBrowser extract", () => {
  function mockReq(failParse = false): IncomingMessage {
    const req = new EventEmitter() as IncomingMessage & { _failParse?: boolean };
    req._failParse = failParse;
    return req;
  }

  function mockRes(): ServerResponse & { _status?: number; _data?: string } {
    const res = new EventEmitter() as any;
    res._headers = {};
    res.setHeader = () => {};
    res.writeHead = (status: number) => { res._status = status; };
    res.end = (data: string) => { res._data = data; };
    return res;
  }

  function mockCtx() {
    return { requestId: "r1", startTime: Date.now(), userId: null } as any;
  }

  it("returns 400 for invalid body", async () => {
    const res = mockRes();
    const matched = await handleBrowser(mockReq(true), res, "POST", "/api/browser/extract", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns 200 for successful extract", async () => {
    const { apiBrowserController } = await import("../../../../web/routes/shared.ts");
    vi.mocked(apiBrowserController.evaluate).mockResolvedValue("text");
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/extract", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
  });

  it("returns 500 when evaluate throws", async () => {
    const { apiBrowserController } = await import("../../../../web/routes/shared.ts");
    vi.mocked(apiBrowserController.evaluate).mockRejectedValue(new Error("page closed"));
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/extract", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(500);
  });

  it("returns 400 for invalid screenshot body", async () => {
    const { readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: false, error: "bad", status: 400 });
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/screenshot", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns 500 when screenshot throws", async () => {
    const { apiBrowserController, readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: true, data: { pageId: "p1" } });
    vi.mocked(apiBrowserController.screenshot).mockRejectedValue(new Error("crashed"));
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/screenshot", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(500);
  });

  it("returns 400 for invalid fill body", async () => {
    const { readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: false, error: "bad", status: 400 });
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/fill", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns 500 when fill throws", async () => {
    const { apiBrowserController, readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: true, data: { pageId: "p1", selector: "#x", text: "hi" } });
    vi.mocked(apiBrowserController.fill).mockRejectedValue(new Error("crashed"));
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/fill", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(500);
  });

  it("returns 500 when navigate throws", async () => {
    const { apiBrowserController, readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: true, data: { pageId: "p1", url: "https://example.com" } });
    vi.mocked(apiBrowserController.navigate).mockRejectedValue(new Error("crashed"));
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/navigate", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(500);
  });

  it("returns 400 for invalid click body", async () => {
    const { readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: false, error: "bad", status: 400 });
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/click", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
  });

  it("returns 500 when click throws", async () => {
    const { apiBrowserController, readJsonBody } = await import("../../../../web/routes/shared.ts");
    vi.mocked(readJsonBody).mockResolvedValue({ success: true, data: { pageId: "p1", selector: "#x" } });
    vi.mocked(apiBrowserController.click).mockRejectedValue(new Error("crashed"));
    const res = mockRes();
    const matched = await handleBrowser(mockReq(), res, "POST", "/api/browser/click", mockCtx());
    expect(matched).toBe(true);
    expect(res._status).toBe(500);
  });
});
