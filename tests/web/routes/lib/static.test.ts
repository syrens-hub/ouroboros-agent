import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type ServerResponse } from "http";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from "fs";
import { join } from "path";
import { serveStatic, serveIndex, WEB_DIST } from "../../../../web/routes/lib/static.ts";
import { appConfig } from "../../../../core/config.ts";

describe("static serving", () => {
  const testDist = join(process.cwd(), ".ouroboros", "test-web-dist-" + Date.now());

  beforeEach(() => {
    if (!existsSync(testDist)) mkdirSync(testDist, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDist)) rmSync(testDist, { recursive: true, force: true });
  });

  function mockRes(): ServerResponse & { _status?: number; _data?: string | Buffer; _headers?: Record<string, string> } {
    const res = new EventEmitter() as any;
    res._headers = {};
    res.writeHead = (status: number, headers: Record<string, string>) => {
      res._status = status;
      Object.assign(res._headers, headers);
    };
    res.end = (data: string | Buffer) => {
      res._data = data;
    };
    return res;
  }

  function mockCtx(requestId = "req-1") {
    return { requestId, startTime: Date.now(), userId: null } as any;
  }

  it("serves file with correct mime type", () => {
    const filePath = join(testDist, "app.js");
    writeFileSync(filePath, "console.log(1)", "utf-8");
    const res = mockRes();
    serveStatic(res, filePath, mockCtx());
    expect(res._status).toBe(200);
    expect(res._headers!["Content-Type"]).toBe("application/javascript");
    expect(res._data!.toString()).toBe("console.log(1)");
  });

  it("returns 404 for missing file", () => {
    const res = mockRes();
    serveStatic(res, join(testDist, "nope.txt"), mockCtx());
    expect(res._status).toBe(404);
  });

  it("returns 404 for directory", () => {
    const dir = join(testDist, "folder");
    mkdirSync(dir, { recursive: true });
    const res = mockRes();
    serveStatic(res, dir, mockCtx());
    expect(res._status).toBe(404);
  });

  it("serves unknown extension as octet-stream", () => {
    const filePath = join(testDist, "data.bin");
    writeFileSync(filePath, "binary", "utf-8");
    const res = mockRes();
    serveStatic(res, filePath, mockCtx());
    expect(res._headers!["Content-Type"]).toBe("application/octet-stream");
  });

  it("serveIndex returns 503 when index.html missing", () => {
    const indexPath = join(WEB_DIST, "index.html");
    const backup = indexPath + ".bak";
    const hadIndex = existsSync(indexPath);
    if (hadIndex) renameSync(indexPath, backup);
    try {
      const res = mockRes();
      serveIndex(res, mockCtx());
      expect(res._status).toBe(503);
      expect(res._data!.toString()).toContain("not built");
    } finally {
      if (hadIndex) renameSync(backup, indexPath);
    }
  });

  it("serveIndex injects api token and sentry", () => {
    const originalToken = appConfig.web.apiToken;
    const originalDsn = appConfig.sentry.dsn;
    appConfig.web.apiToken = "test-token-123";
    appConfig.sentry.dsn = "https://example.com/1";

    const indexPath = join(WEB_DIST, "index.html");
    const hadIndex = existsSync(indexPath);
    if (!hadIndex) {
      const parent = join(indexPath, "..");
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      writeFileSync(indexPath, "<!DOCTYPE html><html><head></head><body></body></html>", "utf-8");
    }
    try {
      const res = mockRes();
      serveIndex(res, mockCtx());
      expect(res._status).toBe(200);
      expect(res._data!.toString()).toContain("__OUROBOROS_API_TOKEN__");
      expect(res._data!.toString()).toContain("__SENTRY_DSN__");
    } finally {
      appConfig.web.apiToken = originalToken;
      appConfig.sentry.dsn = originalDsn;
      if (!hadIndex) rmSync(indexPath, { force: true });
    }
  });
});
