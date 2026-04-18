process.env.WEB_API_TOKEN = "test-token";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { appConfig } from "../../core/config.ts";
import { resetDbSingleton } from "../../core/db-manager.ts";
import { appendMessage } from "../../core/session-db.ts";

const TEST_DB_DIR = join(process.cwd(), ".ouroboros", "test-server-api-db-" + Date.now());
appConfig.db.dir = TEST_DB_DIR;

import { createApp } from "../../web/server.ts";
import { closeWebSocket } from "../../web/ws-server.ts";

describe("Web Server API", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    appConfig.db.dir = join(process.cwd(), ".ouroboros", "test-server-api-db-" + Date.now());
    appConfig.web.apiToken = "test-token";
    resetDbSingleton();
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await closeWebSocket();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const dir = appConfig.db.dir.startsWith("/")
        ? appConfig.db.dir
        : join(process.cwd(), appConfig.db.dir);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function fetchJson(path: string, opts?: RequestInit) {
    const res = await fetch(`http://localhost:${port}${path}`, {
      ...opts,
      headers: {
        ...(opts?.headers || {}),
        Authorization: "Bearer test-token",
      },
    });
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      return { status: res.status, data: text };
    }
  }

  it("POST /api/sessions creates a session", async () => {
    const { status, data } = await fetchJson("/api/sessions", { method: "POST" });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.sessionId).toBeTruthy();
  });

  it("GET /api/sessions lists created sessions", async () => {
    const create = await fetchJson("/api/sessions", { method: "POST" });
    const list = await fetchJson("/api/sessions");
    expect(list.status).toBe(200);
    expect(list.data.success).toBe(true);
    expect(Array.isArray(list.data.data)).toBe(true);
    expect(list.data.data.some((s: { sessionId: string }) => s.sessionId === create.data.data.sessionId)).toBe(true);
  });

  it("GET /api/sessions/:id/messages returns messages", async () => {
    const create = await fetchJson("/api/sessions", { method: "POST" });
    const id = create.data.data.sessionId;
    const msgs = await fetchJson(`/api/sessions/${id}/messages`);
    expect(msgs.status).toBe(200);
    expect(msgs.data.success).toBe(true);
    expect(Array.isArray(msgs.data.data)).toBe(true);
  });

  it("GET /api/sessions/:id/messages supports pagination with limit, offset, and beforeId", async () => {
    const create = await fetchJson("/api/sessions", { method: "POST" });
    const id = create.data.data.sessionId;

    // Append 5 messages
    for (let i = 1; i <= 5; i++) {
      const result = await appendMessage(id, { role: "user", content: `msg-${i}` });
      expect(result.success).toBe(true);
    }

    // Limit=2 should return the 2 most recent messages in chronological order
    const page1 = await fetchJson(`/api/sessions/${id}/messages?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.data.data.map((m: { content: string }) => m.content)).toEqual(["msg-4", "msg-5"]);

    // Offset=2 & limit=2 should skip the 2 most recent
    const page2 = await fetchJson(`/api/sessions/${id}/messages?offset=2&limit=2`);
    expect(page2.status).toBe(200);
    expect(page2.data.data.map((m: { content: string }) => m.content)).toEqual(["msg-2", "msg-3"]);

    // beforeId should exclude messages with id >= beforeId
    // SQLite auto-increment ids start at 1; the 3rd inserted message has id=3
    const before = await fetchJson(`/api/sessions/${id}/messages?beforeId=3`);
    expect(before.status).toBe(200);
    expect(before.data.data.map((m: { content: string }) => m.content)).toEqual(["msg-1", "msg-2"]);
  });

  it("GET /api/skills returns skill list", async () => {
    const { status, data } = await fetchJson("/api/skills");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("GET /api/status returns system status", async () => {
    const { status, data } = await fetchJson("/api/status");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.data.llmProvider).toBe("string");
    expect(typeof data.data.skillCount).toBe("number");
    expect(data.data.deepDreamingLastRun === null || typeof data.data.deepDreamingLastRun === "number").toBe(true);
  });

  it("GET /api/kb/stats returns kb statistics", async () => {
    const { status, data } = await fetchJson("/api/kb/stats");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.data.totalDocuments).toBe("number");
    expect(typeof data.data.totalChunks).toBe("number");
    expect(typeof data.data.avgPromotionScore).toBe("number");
  });

  it("POST /api/upload accepts an image and serves it", async () => {
    const form = new FormData();
    const blob = new Blob([Buffer.from("fake-image-png-bytes")], { type: "image/png" });
    form.append("file", blob, "test.png");

    const { status, data } = await fetchJson("/api/upload?sessionId=s1", {
      method: "POST",
      body: form,
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.data.url).toBe("string");
    expect(data.data.url).toMatch(/^\/api\/uploads\/s1\//);

    const imageRes = await fetch(`http://localhost:${port}${data.data.url}`, { headers: { Authorization: "Bearer test-token" } });
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get("content-type")).toBe("image/png");
    const body = await imageRes.text();
    expect(body).toBe("fake-image-png-bytes");
  });

  it("POST /api/upload rejects non-image files", async () => {
    const form = new FormData();
    const blob = new Blob(["not an image"], { type: "text/plain" });
    form.append("file", blob, "test.txt");

    const { status, data } = await fetchJson("/api/upload?sessionId=s1", {
      method: "POST",
      body: form,
    });

    expect(status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.message).toMatch(/No valid image file found/);
  });

  it("POST /api/upload/file accepts a generic file and serves it", async () => {
    const form = new FormData();
    const blob = new Blob(["pdf-content"], { type: "application/pdf" });
    form.append("file", blob, "report.pdf");

    const { status, data } = await fetchJson("/api/upload/file?sessionId=s1", {
      method: "POST",
      body: form,
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.data.url).toBe("string");
    expect(data.data.name).toBe("report.pdf");

    const fileRes = await fetch(`http://localhost:${port}${data.data.url}`, { headers: { Authorization: "Bearer test-token" } });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("application/pdf");
    const body = await fileRes.text();
    expect(body).toBe("pdf-content");
  });

  it("POST /api/upload/file rejects disallowed extensions", async () => {
    const form = new FormData();
    const blob = new Blob(["exe-content"], { type: "application/octet-stream" });
    form.append("file", blob, "virus.exe");

    const { status, data } = await fetchJson("/api/upload/file?sessionId=s1", {
      method: "POST",
      body: form,
    });

    expect(status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.message).toMatch(/Unsupported file type/);
  });

  it("GET /api/gallery/screenshots/:filename serves a screenshot", async () => {
    const screenshotsDir = join(homedir(), ".ouroboros", "browser-screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const filename = `test-e2e-screenshot-${Date.now()}.png`;
    const filePath = join(screenshotsDir, filename);
    writeFileSync(filePath, Buffer.from("fake-png-bytes"));

    try {
      const imageRes = await fetch(`http://localhost:${port}/api/gallery/screenshots/${filename}`, { headers: { Authorization: "Bearer test-token" } });
      expect(imageRes.status).toBe(200);
      expect(imageRes.headers.get("content-type")).toBe("image/png");
      const body = await imageRes.text();
      expect(body).toBe("fake-png-bytes");

      const notFound = await fetch(`http://localhost:${port}/api/gallery/screenshots/nonexistent.exe`, { headers: { Authorization: "Bearer test-token" } });
      expect(notFound.status).toBe(404);
    } finally {
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  it("GET /health and /ready are accessible without auth even when token is set", async () => {
    // Temporarily set a token
    const originalToken = appConfig.web.apiToken;
    appConfig.web.apiToken = "secret-test-token";
    try {
      const health = await fetchJson("/health");
      expect(health.status).toBe(200);
      expect(health.data.healthy).toBeDefined();

      const ready = await fetchJson("/ready");
      expect(ready.status).toBe(200);
      expect(ready.data.status).toBe("ready");

      const metrics = await fetchJson("/metrics");
      expect(metrics.status).toBe(200);
      expect(typeof metrics.data).toBe("string");
    } finally {
      appConfig.web.apiToken = originalToken;
    }
  });

  it("GET /api/openapi.json returns OpenAPI spec", async () => {
    const { status, data } = await fetchJson("/api/openapi.json");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.openapi).toBe("3.0.3");
    expect(data.data.info.title).toBe("Ouroboros Agent API");
    expect(Array.isArray(data.data["x-tools"])).toBe(true);
  });

  it("GET /api/system/circuit-breakers returns circuit breaker states", async () => {
    const { status, data } = await fetchJson("/api/system/circuit-breakers");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("GET /api/budget returns budget status", async () => {
    const originalBudget = process.env.TOTAL_BUDGET;
    process.env.TOTAL_BUDGET = "100";
    try {
      const { status, data } = await fetchJson("/api/budget");
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(typeof data.data.totalBudget).toBe("number");
      expect(typeof data.data.remainingPercent).toBe("number");
      expect(["ok", "warning", "critical"]).toContain(data.data.status);
    } finally {
      process.env.TOTAL_BUDGET = originalBudget;
    }
  });
});
