import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recordApiAudit, pruneApiAuditLogs } from "../../../../web/routes/lib/audit.ts";
import { getDb, resetDbSingleton } from "../../../../core/db-manager.ts";
import type { IncomingMessage, ServerResponse } from "http";

describe("API Audit", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_audit_log (
        timestamp INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        user_agent TEXT,
        token_prefix TEXT,
        origin TEXT
      );
    `);
    db.exec("DELETE FROM api_audit_log;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  function makeReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
    return {
      method: "POST",
      headers: {
        authorization: "bearer sk-abcdef1234567890",
        "user-agent": "test-agent",
        origin: "http://localhost:3000",
      },
      socket: { remoteAddress: "127.0.0.1" },
      ...overrides,
    } as IncomingMessage;
  }

  function makeRes(overrides: Partial<ServerResponse> = {}): ServerResponse {
    return {
      statusCode: 200,
      ...overrides,
    } as ServerResponse;
  }

  it("records an API audit entry", () => {
    const req = makeReq();
    const res = makeRes();
    recordApiAudit(req, res, { requestId: "req-1", startTime: Date.now() }, "/api/test", 42);

    const db = getDb();
    const rows = db.prepare("SELECT * FROM api_audit_log WHERE request_id = ?").all("req-1") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].method).toBe("POST");
    expect(rows[0].path).toBe("/api/test");
    expect(rows[0].status_code).toBe(200);
    expect(rows[0].duration_ms).toBe(42);
    expect(rows[0].client_ip).toBe("127.0.0.1");
    expect(rows[0].token_prefix).toBe("sk-abcde");
    expect(rows[0].user_agent).toBe("test-agent");
    expect(rows[0].origin).toBe("http://localhost:3000");
  });

  it("records with x-forwarded-for IP", () => {
    const req = makeReq({
      headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Partial<IncomingMessage>);
    const res = makeRes();
    recordApiAudit(req, res, { requestId: "req-2", startTime: Date.now() }, "/api/test", 10);

    const db = getDb();
    const rows = db.prepare("SELECT * FROM api_audit_log WHERE request_id = ?").all("req-2") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].client_ip).toBe("10.0.0.1");
  });

  it("records without authorization header", () => {
    const req = makeReq({ headers: {} } as Partial<IncomingMessage>);
    const res = makeRes();
    recordApiAudit(req, res, { requestId: "req-3", startTime: Date.now() }, "/api/test", 10);

    const db = getDb();
    const rows = db.prepare("SELECT * FROM api_audit_log WHERE request_id = ?").all("req-3") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].token_prefix).toBeNull();
  });

  it("prunes old audit logs", () => {
    const db = getDb();
    const now = Date.now();
    db.prepare(
      "INSERT INTO api_audit_log (timestamp, request_id, client_ip, method, path, status_code, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(now - 100_000, "old-req", "127.0.0.1", "GET", "/api/old", 200, 10);
    db.prepare(
      "INSERT INTO api_audit_log (timestamp, request_id, client_ip, method, path, status_code, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(now, "new-req", "127.0.0.1", "GET", "/api/new", 200, 10);

    const deleted = pruneApiAuditLogs(50_000);
    expect(deleted).toBe(1);

    const rows = db.prepare("SELECT * FROM api_audit_log").all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].request_id).toBe("new-req");
  });

  it("pruneApiAuditLogs returns 0 when nothing to prune", () => {
    const deleted = pruneApiAuditLogs(50_000);
    expect(deleted).toBe(0);
  });
});
