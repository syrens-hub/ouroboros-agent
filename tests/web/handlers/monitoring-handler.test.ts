import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import { handleMonitoring } from "../../../web/routes/handlers/monitoring.ts";
import { initEventBusTables } from "../../../core/event-bus.ts";
import { initApprovalTables } from "../../../skills/approval/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";
import { initTestRunTables } from "../../../skills/incremental-test/index.ts";

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

describe("Monitoring API Handler", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEventBusTables(db);
    initApprovalTables(db);
    initEvolutionVersionTables(db);
    initTestRunTables(db);
    db.exec("DELETE FROM dead_letters;");
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM evolution_versions;");
    db.exec("DELETE FROM test_runs;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns monitoring snapshot", async () => {
    const req = { method: "GET", url: "/api/monitoring/status" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleMonitoring(req, res as any, "GET", "/api/monitoring/status", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
    const body = res.getBody() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.timestamp).toBeDefined();
    expect(body.data.eventBus).toBeDefined();
    expect(body.data.safety).toBeDefined();
  });

  it("returns event bus status", async () => {
    const req = { method: "GET", url: "/api/monitoring/event-bus" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleMonitoring(req, res as any, "GET", "/api/monitoring/event-bus", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
  });

  it("returns safety status", async () => {
    const req = { method: "GET", url: "/api/monitoring/safety" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleMonitoring(req, res as any, "GET", "/api/monitoring/safety", mockCtx() as any);
    expect(handled).toBe(true);
    expect(res.getStatusCode()).toBe(200);
  });

  it("returns 404 for unknown paths", async () => {
    const req = { method: "GET", url: "/api/monitoring/unknown" } as unknown as import("http").IncomingMessage;
    const res = mockRes();
    const handled = await handleMonitoring(req, res as any, "GET", "/api/monitoring/unknown", mockCtx() as any);
    expect(handled).toBe(false);
  });
});
