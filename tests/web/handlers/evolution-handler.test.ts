import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { handleEvolution } from "../../../web/routes/handlers/evolution.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";

function mockRes() {
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, string> = {};
  return {
    writeHead(code: number, h?: Record<string, string>) {
      statusCode = code;
      Object.assign(headers, h);
    },
    end(data?: string) {
      try {
        body = data ? JSON.parse(data) : undefined;
      } catch {
        body = data;
      }
    },
    setHeader(_k: string, _v: string) {},
    getStatusCode: () => statusCode,
    getBody: () => body,
  };
}

function mockCtx() {
  return { requestId: "test-req", startTime: Date.now() };
}

async function mockPostReq(path: string, payload: unknown): Promise<import("http").IncomingMessage> {
  return {
    method: "POST",
    url: path,
    headers: {},
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === "data") cb(Buffer.from(JSON.stringify(payload)));
      if (event === "end") cb();
    },
  } as unknown as import("http").IncomingMessage;
}

describe("Evolution API Handler", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initApprovalTables(db);
    initEvolutionVersionTables(db);
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM evolution_versions;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns evolution history", async () => {
    const req = { method: "GET", url: "/api/evolution/history" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleEvolution(req, res as any, "GET", "/api/evolution/history", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
  });

  it("returns pending approvals", async () => {
    const req = { method: "GET", url: "/api/evolution/approvals" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleEvolution(req, res as any, "GET", "/api/evolution/approvals", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
    const body = res.getBody() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns versions", async () => {
    const req = { method: "GET", url: "/api/evolution/versions" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleEvolution(req, res as any, "GET", "/api/evolution/versions", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
  });

  it("handles rollback request", async () => {
    const req = await mockPostReq("/api/evolution/rollback", { versionId: "evo-test" });
    const res = mockRes();
    const handled = await handleEvolution(req, res as any, "POST", "/api/evolution/rollback", mockCtx() as any);
    expect(handled).toBe(true);
    // No parent version, so should return 400
    expect(res.getStatusCode()).toBe(400);
  });

  it("returns 404 for unknown paths", async () => {
    const req = { method: "GET", url: "/api/evolution/unknown" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleEvolution(req, res as any, "GET", "/api/evolution/unknown", mockCtx() as any);
    expect(handled).toBe(false);
  });
});
