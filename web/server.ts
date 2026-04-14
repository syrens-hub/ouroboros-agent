#!/usr/bin/env tsx
/**
 * Ouroboros Web UI Server
 * ========================
 * Native Node.js HTTP server serving the built SPA and API endpoints.
 */

import "dotenv/config";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, createReadStream, readdirSync, rmdirSync, unlinkSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { createSession, listSessions, getMessages, getDb, pruneDeletedSessions, getMemoryRecalls24h } from "../core/session-db.ts";
import { queryMemoryLayers, searchMemoryLayers } from "../core/repositories/memory-layers.ts";
import { callLLM } from "../core/llm-router.ts";
import { createTrajectoryCompressor } from "../skills/learning/index.ts";
import type { TrajectoryEntry, ToolCallContext, ContentBlock } from "../types/index.ts";
import { appConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { notificationBus, type NotificationEvent } from "../core/notification-bus.ts";
import { createBackup, listBackups, restoreBackup, maybeAutoBackup } from "../core/backup.ts";
import { consolidateMemoryLayers } from "../core/memory-consolidation.ts";
import { getLLMMetrics } from "../core/llm-metrics.ts";
import { checkRateLimit } from "../core/rate-limiter.ts";
import { initSentry, captureException } from "../core/sentry.ts";
import {
  resolveConfirm,
  removeRunner,
  startRunnerIdleCleanup,
  stopRunnerIdleCleanup,
  llmCfg,
  discoverSkills,
  installSkillTool,
  getDaemonStatus,
  getDaemonHistory,
  startDaemon,
  stopDaemon,
  reconcileSkillRegistry,
  getRunnerPoolStats,
  getOrCreateRunner,
  globalPool,
} from "./runner-pool.ts";
import { startWorkerIdleCleanup, getWorkerRunnerStats, resumeQueuedWorkerTasks } from "../skills/orchestrator/index.ts";
import { getGlobalTokenUsage, pruneTokenUsage, getTokenUsageTimeSeries } from "../core/repositories/token-usage.ts";
import { feishuPlugin, FEISHU_API_BASE, getTenantAccessToken } from "../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../extensions/im/telegram/index.ts";
import { discordPlugin } from "../extensions/im/discord/index.ts";
import { slackPlugin } from "../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../extensions/im/wechatwork/index.ts";
import { ChannelRegistry } from "../core/channel-registry.ts";
import { closeRedis } from "../core/redis.ts";
import { createSelfHealer } from "../core/self-healing.ts";
import { createTaskScheduler } from "../core/task-scheduler.ts";
import { createPersonalityEvolution } from "../skills/personality/index.ts";
import { createDreamingMemory } from "../skills/dreaming/index.ts";
import { MultimediaGenerator } from "../skills/multimedia/index.ts";
import { getI18n, createI18n, type Locale } from "../core/i18n.ts";
import { createContextManager } from "../skills/context-management/index.ts";
import { KnowledgeBase } from "../skills/knowledge-base/index.ts";
import { BrowserController } from "../skills/browser/index.ts";
import { CanvasWorkspace } from "../skills/canvas/index.ts";
import { defaultSOPTemplates, run_sop_workflow, type SOPDefinition } from "../skills/sop/index.ts";
import { runCrewTaskTool, type CrewAgentRole } from "../skills/crewai/index.ts";
import { createSecurityFramework } from "../core/security-framework.ts";
import { WebhookManager, type WebhookRegistration } from "../core/webhook-manager.ts";
import { LearningEngine } from "../skills/learning/engine.ts";
import { attachWebSocket, closeWebSocket, broadcastNotification, getWsClientCount, getWsConnectionsTotal } from "./ws-server.ts";

initSentry();

const PORT = appConfig.web.port;
const WEB_DIST = join(process.cwd(), "web", "dist");
const DB_PATH = join(appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir), "session.db");
const OUT_DIR = join(process.cwd(), ".ouroboros");
const OUT_PATH = join(OUT_DIR, "trajectories.jsonl");

const API_TOKEN = appConfig.web.apiToken || "";
const ALLOWED_ORIGINS = appConfig.web.allowedOrigins;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

const SERVER_TIMEOUT_MS = 120_000;
const SERVER_KEEP_ALIVE_TIMEOUT_MS = 30_000;
const SERVER_HEADERS_TIMEOUT_MS = 60_000;

notificationBus.on("notification", (evt: NotificationEvent) => {
  broadcastNotification(evt);
});

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Shared feature singletons for API routes
const selfHealer = createSelfHealer();
const taskScheduler = createTaskScheduler();
const mediaGenerator = new MultimediaGenerator();
const i18n = getI18n() || createI18n({ defaultLocale: "en" });
const contextManager = createContextManager();
const apiBrowserController = new BrowserController({ headless: true });
const securityFramework = createSecurityFramework();
const webhookManager = new WebhookManager();
const channelRegistry = new ChannelRegistry();
const learningEngine = new LearningEngine();

// Register IM channels
channelRegistry.register(feishuPlugin);
channelRegistry.register(mockChatPlugin);
channelRegistry.register(telegramPlugin);
channelRegistry.register(discordPlugin);
channelRegistry.register(slackPlugin);
channelRegistry.register(dingtalkPlugin);
channelRegistry.register(wechatworkPlugin);

// =============================================================================
// Structured Request Context
// =============================================================================

type ReqContext = {
  requestId: string;
  startTime: number;
};

function createReqContext(): ReqContext {
  return { requestId: randomUUID(), startTime: Date.now() };
}

// =============================================================================
// CORS
// =============================================================================

function getOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || req.headers.referer || "";
  return origin;
}

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function setCorsHeaders(res: ServerResponse, origin: string) {
  const allowOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0] || "";
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-ID");
}

// =============================================================================
// Body Parsing with Size Limit
// =============================================================================

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function readBodyBuffer(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartFile(buffer: Buffer, contentType: string, requireImage = false): { filename: string; mimeType: string; data: Buffer } | null {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1].trim();
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let idx = buffer.indexOf(boundaryBuffer);
  while (idx !== -1) {
    const partStart = idx + boundaryBuffer.length;
    const nextIdx = buffer.indexOf(boundaryBuffer, partStart);
    const part = buffer.slice(partStart, nextIdx !== -1 ? nextIdx : undefined);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      idx = nextIdx;
      continue;
    }
    const headers = part.slice(0, headerEnd).toString("utf-8");
    const cdMatch = headers.match(/Content-Disposition:[^\r\n]+filename="([^"]+)"/i);
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (cdMatch) {
      const mimeType = ctMatch ? ctMatch[1].trim() : "application/octet-stream";
      if (!requireImage || mimeType.startsWith("image/")) {
        const dataStart = headerEnd + 4;
        let dataEnd = part.length;
        if (part.slice(dataEnd - 2).toString() === "\r\n") dataEnd -= 2;
        return { filename: cdMatch[1], mimeType, data: part.slice(dataStart, dataEnd) };
      }
    }
    idx = nextIdx;
  }
  return null;
}

function parseMultipartImage(buffer: Buffer, contentType: string): { filename: string; mimeType: string; data: Buffer } | null {
  return parseMultipartFile(buffer, contentType, true);
}

const ConfirmBodySchema = z.object({ allowed: z.boolean() });
const InstallSkillBodySchema = z.object({ source: z.string().min(1) });
const RestoreBackupBodySchema = z.object({ filename: z.string().min(1) });

function parseBody<T>(body: string, schema: z.ZodSchema<T>): { success: true; data: T } | { success: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { success: false, error: "Invalid JSON body" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  }
  return { success: true, data: result.data };
}

// =============================================================================
// Simple In-Memory Cache
// =============================================================================

type CacheEntry = { data: unknown; expiresAt: number };
const apiCache = new Map<string, CacheEntry>();
const MAX_API_CACHE_SIZE = 100;

function getCached<T>(key: string, ttlMs: number, fn: () => T): T {
  const now = Date.now();
  const entry = apiCache.get(key);
  if (entry && entry.expiresAt > now) return entry.data as T;
  const data = fn();
  if (apiCache.size >= MAX_API_CACHE_SIZE) {
    const firstKey = apiCache.keys().next().value;
    if (firstKey !== undefined) {
      apiCache.delete(firstKey);
    }
  }
  apiCache.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

// =============================================================================
// Client IP
// =============================================================================

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// =============================================================================
// Auth
// =============================================================================

function isAuthValid(req: IncomingMessage, _urlPath: string): boolean {
  if (!API_TOKEN) return true;
  const auth = req.headers.authorization || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  return bearer === API_TOKEN;
}

// =============================================================================
// Security Headers
// =============================================================================

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self';"
  );
}

// =============================================================================
// Prometheus Metrics
// =============================================================================

const requestCounter = new Map<string, number>();
const requestDurationHistogram = new Map<string, number>();
const requestDurationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MAX_METRIC_COUNTER_KEYS = 2_000;
const MAX_METRIC_HISTOGRAM_KEYS = 10_000;

function normalizeMetricPath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[a-f0-9]{16,}/gi, "/:hash")
    .replace(/\/\d+/g, "/:id");
}

function pruneMetricsIfNeeded() {
  if (requestCounter.size > MAX_METRIC_COUNTER_KEYS) {
    requestCounter.clear();
  }
  if (requestDurationHistogram.size > MAX_METRIC_HISTOGRAM_KEYS) {
    requestDurationHistogram.clear();
  }
}

function incCounter(name: string, labels: Record<string, string>, value = 1) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  const key = `${name}{${labelStr}}`;
  requestCounter.set(key, (requestCounter.get(key) || 0) + value);
}

function observeHistogram(name: string, labels: Record<string, string>, value: number) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  for (const bucket of requestDurationBuckets) {
    const key = `${name}_bucket{le="${bucket}",${labelStr}}`;
    if (value <= bucket) {
      requestDurationHistogram.set(key, (requestDurationHistogram.get(key) || 0) + 1);
    }
  }
  const infKey = `${name}_bucket{le="+Inf",${labelStr}}`;
  requestDurationHistogram.set(infKey, (requestDurationHistogram.get(infKey) || 0) + 1);
}

function recordRequestMetrics(method: string, path: string, statusCode: number, durationSec: number) {
  pruneMetricsIfNeeded();
  const labels = { method: method || "GET", path: normalizeMetricPath(path || "/"), status: String(statusCode) };
  incCounter("http_requests_total", labels);
  observeHistogram("http_request_duration_seconds", labels, durationSec);
}

function getPrometheusMetrics(): string {
  const lines: string[] = [];
  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, value] of requestCounter) {
    lines.push(`${key} ${value}`);
  }
  lines.push("# HELP http_request_duration_seconds HTTP request duration");
  lines.push("# TYPE http_request_duration_seconds histogram");
  for (const [key, value] of requestDurationHistogram) {
    lines.push(`${key} ${value}`);
  }
  lines.push("# HELP active_runners Active agent runners");
  lines.push("# TYPE active_runners gauge");
  lines.push(`active_runners ${getRunnerPoolStats().size}`);
  lines.push("# HELP runner_pool_size Runner pool size");
  lines.push("# TYPE runner_pool_size gauge");
  lines.push(`runner_pool_size ${getRunnerPoolStats().size}`);
  lines.push("# HELP ws_clients Active WebSocket clients");
  lines.push("# TYPE ws_clients gauge");
  lines.push(`ws_clients ${getWsClientCount()}`);
  lines.push("# HELP ws_connections_total Total WebSocket connections accepted");
  lines.push("# TYPE ws_connections_total counter");
  lines.push(`ws_connections_total ${getWsConnectionsTotal()}`);
  const llmMetrics = getLLMMetrics();
  lines.push("# HELP llm_latency_ms Average LLM latency in milliseconds");
  lines.push("# TYPE llm_latency_ms gauge");
  lines.push(`llm_latency_ms ${llmMetrics.averageLatencyMs}`);
  lines.push("# HELP llm_p95_latency_ms P95 LLM latency in milliseconds");
  lines.push("# TYPE llm_p95_latency_ms gauge");
  lines.push(`llm_p95_latency_ms ${llmMetrics.p95LatencyMs}`);
  lines.push("# HELP llm_calls_total Total LLM calls recorded");
  lines.push("# TYPE llm_calls_total gauge");
  lines.push(`llm_calls_total ${llmMetrics.callCount}`);
  lines.push("# HELP llm_total_tokens Total LLM tokens consumed");
  lines.push("# TYPE llm_total_tokens gauge");
  lines.push(`llm_total_tokens ${llmMetrics.totalTokens}`);
  const workerStats = getWorkerRunnerStats();
  lines.push("# HELP active_workers Active worker agents");
  lines.push("# TYPE active_workers gauge");
  lines.push(`active_workers ${workerStats.activeWorkers}`);
  lines.push("# HELP queued_workers Worker agents waiting for concurrency slot");
  lines.push("# TYPE queued_workers gauge");
  lines.push(`queued_workers ${workerStats.queuedWorkers}`);
  return lines.join("\n") + "\n";
}

function logRequest(req: IncomingMessage, res: ServerResponse, ctx: ReqContext, path: string, durationMs: number) {
  logger.info("HTTP request", {
    requestId: ctx.requestId,
    method: req.method,
    path,
    status: res.statusCode || 200,
    durationMs,
    clientIp: getClientIp(req),
  });
}

// =============================================================================
// Response Helpers
// =============================================================================

function json(res: ServerResponse, status: number, data: unknown, ctx: ReqContext) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Request-ID": ctx.requestId,
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse, ctx: ReqContext) {
  json(res, 404, { success: false, error: { message: "Not found" } }, ctx);
}

function serveStatic(res: ServerResponse, filePath: string, ctx: ReqContext) {
  if (!existsSync(filePath)) {
    notFound(res, ctx);
    return;
  }
  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    notFound(res, ctx);
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "X-Request-ID": ctx.requestId,
  });
  res.end(readFileSync(filePath));
}

function serveIndex(res: ServerResponse, ctx: ReqContext) {
  const indexPath = join(WEB_DIST, "index.html");
  if (!existsSync(indexPath)) {
    res.writeHead(503, { "Content-Type": "text/plain", "X-Request-ID": ctx.requestId });
    res.end("Web UI not built. Run 'npm run web:build' first.");
    return;
  }
  let html = readFileSync(indexPath, "utf-8");
  const injects: string[] = [];
  if (API_TOKEN) {
    injects.push(`<script>window.__OUROBOROS_API_TOKEN__=${JSON.stringify(API_TOKEN)}</script>`);
  }
  if (appConfig.sentry.dsn) {
    injects.push(`<script>window.__SENTRY_DSN__=${JSON.stringify(appConfig.sentry.dsn)};window.__SENTRY_ENV__=${JSON.stringify(appConfig.sentry.environment)}</script>`);
  }
  if (injects.length > 0) {
    html = html.replace("<head>", `<head>\n${injects.join("\n")}`);
  }
  res.writeHead(200, { "Content-Type": "text/html", "X-Request-ID": ctx.requestId });
  res.end(html);
}

// =============================================================================
// Backup Export Logic
// =============================================================================

interface ShareGPTConversation {
  id: string;
  conversations: { from: "system" | "human" | "gpt"; value: string; tool_calls?: unknown[] }[];
  metadata: {
    session_id: string;
    outcome: string;
    compressed: boolean;
    turn_count: number;
  };
}

function formatAsShareGPT(sessionId: string, entries: TrajectoryEntry[], compressed: boolean): ShareGPTConversation {
  const conversations: ShareGPTConversation["conversations"] = [];
  for (const entry of entries) {
    for (const msg of entry.messages) {
      const role = msg.role;
      const from = role === "system" ? "system" : role === "user" ? "human" : role === "assistant" ? "gpt" : "human";
      const value = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      conversations.push({ from, value });
    }
  }
  return {
    id: `traj_${sessionId}_${Date.now()}`,
    conversations,
    metadata: {
      session_id: sessionId,
      outcome: entries[entries.length - 1]?.outcome || "unknown",
      compressed,
      turn_count: entries.length,
    },
  };
}

async function exportTrajectories(): Promise<{ count: number; path: string }> {
  if (!existsSync(DB_PATH)) {
    throw new Error("Database not found");
  }
  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT session_id, entries, outcome, compressed FROM trajectories").all() as {
    session_id: string;
    entries: string;
    outcome: string;
    compressed: number;
  }[];

  const compressor = createTrajectoryCompressor();
  const exported: ShareGPTConversation[] = [];

  for (const row of rows) {
    let entries: TrajectoryEntry[] = JSON.parse(row.entries);
    const tokenEstimate = JSON.stringify(entries).length / 4;
    if (tokenEstimate > 4000) {
      const compressed = await compressor.compress(entries, 4000);
      if (compressed.success) {
        entries = compressed.data;
      }
    }
    exported.push(formatAsShareGPT(row.session_id, entries, row.compressed === 1));
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const lines = exported.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(OUT_PATH, lines + "\n", "utf-8");
  return { count: exported.length, path: OUT_PATH };
}

// =============================================================================
// Health Status
// =============================================================================

const getHealthStatus = async () => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let healthy = true;

  // DB check
  try {
    await getDb().prepare("SELECT 1").get();
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: String(e) };
    healthy = false;
  }

  // LLM check
  checks.llm = { ok: !!llmCfg, detail: llmCfg ? `${llmCfg.provider}:${llmCfg.model}` : "not configured" };

  // Skills check
  let skillCount = 0;
  try {
    skillCount = discoverSkills().length;
    checks.skills = { ok: true, detail: `${skillCount} skills loaded` };
  } catch (e) {
    checks.skills = { ok: false, detail: String(e) };
    healthy = false;
  }

  const daemon = getDaemonStatus();
  return {
    healthy,
    status: healthy ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    checks,
    wsClients: getWsClientCount(),
    sessions: (await listSessions()).length,
    daemonRunning: daemon.running,
    memory: process.memoryUsage(),
  };
}

// =============================================================================
// Route Handlers
// =============================================================================

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: ReqContext) {
  const method = req.method || "GET";
  const origin = getOrigin(req);
  setCorsHeaders(res, origin);

  // Preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "X-Request-ID": ctx.requestId });
    res.end();
    return;
  }

  // CORS block for actual requests
  if (ALLOWED_ORIGINS.length > 0 && !isAllowedOrigin(origin)) {
    json(res, 403, { success: false, error: { message: "CORS origin not allowed" } }, ctx);
    return;
  }

  // Rate limit (skip for localhost in dev/test)
  const clientIp = getClientIp(req);
  const isLocalhost = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    const rate = await checkRateLimit(`api:${clientIp}`, 60, 60_000);
    res.setHeader("X-RateLimit-Limit", String(60));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      json(res, 429, { success: false, error: { message: "Too many requests", retryAfter: rate.retryAfter } }, ctx);
      return;
    }
  }

  // Auth for API endpoints
  if (!isAuthValid(req, path)) {
    json(res, 401, { success: false, error: { message: "Unauthorized" } }, ctx);
    return;
  }

  // Health / Ready / Metrics (also under /api for consistency, but commonly at root)
  if (path === "/api/health" && method === "GET") {
    const health = await getHealthStatus();
    json(res, health.healthy ? 200 : 503, health, ctx);
    return;
  }
  if (path === "/api/ready" && method === "GET") {
    json(res, 200, { status: "ready", db: existsSync(DB_PATH), llmConfigured: !!llmCfg }, ctx);
    return;
  }
  if (path === "/api/metrics" && method === "GET") {
    const body = getPrometheusMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "X-Request-ID": ctx.requestId });
    res.end(body);
    return;
  }

  // Sessions list
  if (path === "/api/sessions" && method === "GET") {
    json(res, 200, { success: true, data: await listSessions() }, ctx);
    return;
  }

  // Create session
  if (path === "/api/sessions" && method === "POST") {
    const sessionId = `web_${Date.now()}`;
    await createSession(sessionId, { title: `Web Session ${new Date().toLocaleString("zh-CN")}` });
    json(res, 200, { success: true, data: { sessionId } }, ctx);
    return;
  }

  // Delete session
  const deleteMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const sessionId = deleteMatch[1];
    removeRunner(sessionId);
    json(res, 200, { success: true }, ctx);
    return;
  }

  // Messages
  const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messagesMatch && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : undefined;
    const offset = q.searchParams.has("offset") ? parseInt(q.searchParams.get("offset")!, 10) : undefined;
    const beforeId = q.searchParams.has("beforeId") ? parseInt(q.searchParams.get("beforeId")!, 10) : undefined;
    const result = await getMessages(messagesMatch[1], {
      limit: Number.isFinite(limit) && limit! > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset! >= 0 ? offset : undefined,
      beforeId: Number.isFinite(beforeId) && beforeId! > 0 ? beforeId : undefined,
    });
    json(res, result.success ? 200 : 500, result, ctx);
    return;
  }

  // Confirm permission (legacy HTTP fallback; WebSocket also handles confirm)
  const confirmMatch = path.match(/^\/api\/sessions\/([^/]+)\/confirm$/);
  if (confirmMatch && method === "POST") {
    const sessionId = confirmMatch[1];
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, ConfirmBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const ok = resolveConfirm(sessionId, parsed.data.allowed);
    json(res, 200, { success: ok }, ctx);
    return;
  }

  // Skills list
  if (path === "/api/skills" && method === "GET") {
    const skills = getCached("skills:list", 10_000, () =>
      discoverSkills().map((s) => ({
        name: s.name,
        description: s.frontmatter.description,
        version: s.frontmatter.version,
        tags: s.frontmatter.tags || [],
        hasCode: (s.sourceCodeFiles?.size ?? 0) > 0,
      }))
    );
    json(res, 200, { success: true, data: skills }, ctx);
    return;
  }

  // Generate skill code
  if (path === "/api/skills/generate" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ skill_name: z.string(), description: z.string(), problem_statement: z.string().optional(), example_usage: z.string().optional(), force: z.boolean().default(false) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    if (!llmCfg) {
      json(res, 200, { success: false, error: { message: "LLM not configured" } }, ctx);
      return;
    }
    try {
      const { generateSkillPackage } = await import("../skills/skill-factory/index.ts");
      const result = await generateSkillPackage(
        {
          skill_name: parsed.data.skill_name,
          description: parsed.data.description,
          problem_statement: parsed.data.problem_statement || `Auto-generate executable code for skill ${parsed.data.skill_name}`,
          example_usage: parsed.data.example_usage,
        },
        {
          llmCfg,
          existingTools: globalPool.all(),
          force: parsed.data.force,
          onToolsLoaded: (tools) => {
            for (const tool of tools) {
              if (globalPool.reload(tool.name, tool)) {
                // reloaded
              } else {
                globalPool.register(tool);
              }
            }
          },
        }
      );
      if (!result.success) {
        json(res, 200, { success: false, error: { message: result.error.message } }, ctx);
        return;
      }
      json(res, 200, { success: true, data: result.data }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // Install skill
  if (path === "/api/skills/install" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, InstallSkillBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const result = await installSkillTool.call(
        { source: parsed.data.source },
        { taskId: "web", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({ success: true })) as unknown as ToolCallContext<unknown>["invokeSubagent"] }
      );
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // LLM Test
  if (path === "/api/llm/test" && method === "POST") {
    if (!llmCfg || !llmCfg.apiKey) {
      json(res, 200, { success: false, error: { message: "LLM not configured. Set LLM_API_KEY and LLM_PROVIDER in .env" } }, ctx);
      return;
    }
    try {
      const result = await callLLM(llmCfg, [{ role: "user", content: "Say 'PONG' and nothing else." }], []);
      if (!result.success) {
        json(res, 200, { success: false, error: result.error }, ctx);
      return;
      }
      const text = typeof result.data.content === "string" ? result.data.content : JSON.stringify(result.data.content);
      json(res, 200, { success: true, data: { response: text } }, ctx);
    } catch (e) {
      json(res, 200, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // Memory layers query
  if (path === "/api/memory/layers" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const layers = q.searchParams.get("layers")?.split(",").map((s) => s.trim()).filter(Boolean) || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = queryMemoryLayers({ layers, limit: Number.isFinite(limit) && limit > 0 ? limit : 20 });
    json(res, result.success ? 200 : 500, result, ctx);
    return;
  }

  // Memory layers search
  if (path === "/api/memory/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 10;
    const result = searchMemoryLayers({ query, sessionId, limit: Number.isFinite(limit) && limit > 0 ? limit : 10 });
    json(res, result.success ? 200 : 500, result, ctx);
    return;
  }

  // Backup export (trajectories JSONL)
  if (path === "/api/backup/export" && method === "POST") {
    try {
      const result = await exportTrajectories();
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  if (path === "/api/backup/download" && method === "GET") {
    if (!existsSync(OUT_PATH)) {
      json(res, 404, { success: false, error: { message: "No backup file found" } }, ctx);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="trajectories.jsonl"`,
      "X-Request-ID": ctx.requestId,
    });
    res.end(readFileSync(OUT_PATH));
    return;
  }

  // Database backup management
  if (path === "/api/backup/db/list" && method === "GET") {
    const backups = listBackups();
    json(res, 200, { success: true, data: backups }, ctx);
    return;
  }
  if (path === "/api/backup/db/create" && method === "POST") {
    const result = await createBackup();
    json(res, result.success ? 200 : 500, { success: result.success, data: result.success ? { filename: result.filename, path: result.path } : undefined, error: result.error ? { message: result.error } : undefined }, ctx);
    return;
  }
  if (path === "/api/backup/db/restore" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, RestoreBackupBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const result = restoreBackup(parsed.data.filename);
    json(res, result.success ? 200 : 500, { success: result.success, error: result.error ? { message: result.error } : undefined }, ctx);
    if (result.success) {
      // Close server and exit so the orchestrator restarts with the restored database
      setTimeout(() => gracefulShutdown("RESTORE", 0), 500);
    }
    return;
  }

  // Token usage time series
  if (path === "/api/token-usage" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const granularity = (q.searchParams.get("granularity") as "hour" | "day") || "hour";
    const days = q.searchParams.has("days") ? parseInt(q.searchParams.get("days")!, 10) : 7;
    const sinceMs = Date.now() - (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000;
    const result = getTokenUsageTimeSeries(sessionId, granularity, sinceMs);
    json(res, result.success ? 200 : 500, result, ctx);
    return;
  }

  // App metrics endpoint (JSON for frontend dashboard)
  if (path === "/api/app-metrics" && method === "GET") {
    const poolStats = getRunnerPoolStats();
    const mem = process.memoryUsage();
    const llmMetrics = getLLMMetrics();
    const tokenUsage24h = getGlobalTokenUsage(Date.now() - 24 * 60 * 60 * 1000);
    json(res, 200, {
      success: true,
      data: {
        runnerPool: { size: poolStats.size, max: poolStats.maxRunners },
        wsClients: getWsClientCount(),
        wsConnectionsTotal: getWsConnectionsTotal(),
        tasksPending: taskScheduler.getPendingTasks().length,
        tasksRunning: taskScheduler.getRunningTasks().length,
        memoryUsageMB: Math.round(mem.heapUsed / 1024 / 1024),
        uptimeSeconds: Math.round(process.uptime()),
        llmLatencyMs: llmMetrics.averageLatencyMs,
        llmP95LatencyMs: llmMetrics.p95LatencyMs,
        llmCalls: llmMetrics.callCount,
        llmTotalTokens: llmMetrics.totalTokens,
        tokenUsage24h,
        tokenAlertThreshold: 100_000,
      },
    }, ctx);
    return;
  }

  // IM Status
  if (path === "/api/im/status" && method === "GET") {
    json(res, 200, {
      success: true,
      data: {
        feishu: {
          available: true,
          running: feishuPlugin.isRunning(),
          webhookUrl: `http://localhost:${process.env.FEISHU_WEBHOOK_PORT || 3000}${process.env.FEISHU_WEBHOOK_PATH || "/feishu/webhook"}`,
        },
        slack: {
          available: !!process.env.SLACK_BOT_TOKEN,
          running: false,
        },
        dingtalk: {
          available: !!process.env.DINGTALK_APP_KEY,
          running: false,
          webhookUrl: `http://localhost:${process.env.DINGTALK_WEBHOOK_PORT || 3100}${process.env.DINGTALK_WEBHOOK_PATH || "/dingtalk/webhook"}`,
        },
        wechatwork: {
          available: !!process.env.WECHATWORK_WEBHOOK_URL,
          running: false,
          webhookUrl: `http://localhost:${process.env.WECHATWORK_WEBHOOK_PORT || 3200}${process.env.WECHATWORK_WEBHOOK_PATH || "/wechatwork/webhook"}`,
        },
        mockChat: {
          available: true,
        },
      },
    }, ctx);
    return;
  }

  // Feishu control
  if (path === "/api/im/feishu/start" && method === "POST") {
    try {
      feishuPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  if (path === "/api/im/feishu/stop" && method === "POST") {
    try {
      feishuPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // DingTalk control
  if (path === "/api/im/dingtalk/start" && method === "POST") {
    try {
      dingtalkPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/im/dingtalk/stop" && method === "POST") {
    try {
      dingtalkPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // WeChat Work control
  if (path === "/api/im/wechatwork/start" && method === "POST") {
    try {
      wechatworkPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/im/wechatwork/stop" && method === "POST") {
    try {
      wechatworkPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // Slack control
  if (path === "/api/im/slack/start" && method === "POST") {
    try {
      slackPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/im/slack/stop" && method === "POST") {
    try {
      slackPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // Daemon control
  if (path === "/api/daemon/status" && method === "GET") {
    json(res, 200, { success: true, data: getDaemonStatus() }, ctx);
    return;
  }
  if (path === "/api/daemon/history" && method === "GET") {
    json(res, 200, { success: true, data: getDaemonHistory() }, ctx);
    return;
  }
  if (path === "/api/daemon/start" && method === "POST") {
    const ok = startDaemon();
    json(res, 200, { success: ok, data: { running: getDaemonStatus().running } }, ctx);
    return;
  }
  if (path === "/api/daemon/stop" && method === "POST") {
    const ok = stopDaemon();
    json(res, 200, { success: ok, data: { running: getDaemonStatus().running } }, ctx);
    return;
  }

  // Status
  if (path === "/api/status" && method === "GET") {
    const sessions = await listSessions();
    const skills = discoverSkills();
    const imPlugins: string[] = [];
    try {
      if (feishuPlugin) imPlugins.push("feishu");
    } catch {
      // ignore
    }
    try {
      if (mockChatPlugin) imPlugins.push("mock-chat");
    } catch {
      // ignore
    }
    const memoryRecallsRes = await getMemoryRecalls24h();
    let deepDreamingLastRun: number | null = null;
    try {
      const { statSync } = await import("fs");
      const synthesisPath = join(process.cwd(), ".ouroboros", "memory-synthesis", "memory-synthesis.md");
      deepDreamingLastRun = statSync(synthesisPath).mtimeMs;
    } catch {
      // file does not exist yet
    }
    const data = {
      llmProvider: llmCfg?.provider || "local",
      llmModel: llmCfg?.model || "mock",
      sessionCount: sessions.length,
      skillCount: skills.length,
      daemonRunning: getDaemonStatus().running,
      imPlugins,
      memoryRecalls24h: memoryRecallsRes.success ? memoryRecallsRes.data : 0,
      deepDreamingLastRun,
    };
    json(res, 200, { success: true, data }, ctx);
    return;
  }

  // ================================================================
  // Self-healing API
  // ================================================================
  if (path === "/api/self-healing/status" && method === "GET") {
    json(res, 200, { success: true, data: { active: true, snapshots: selfHealer.getSnapshots().length } }, ctx);
    return;
  }
  if (path === "/api/self-healing/snapshots" && method === "GET") {
    json(res, 200, { success: true, data: selfHealer.getSnapshots() }, ctx);
    return;
  }
  if (path === "/api/self-healing/rollback" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ rollbackPointId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const result = await selfHealer.performRollback(parsed.data.rollbackPointId);
    json(res, result.success ? 200 : 500, { success: result.success, data: result.snapshot, error: result.error ? { message: result.error } : undefined }, ctx);
    return;
  }

  // ================================================================
  // Task Scheduler API
  // ================================================================
  if (path === "/api/tasks" && method === "GET") {
    json(res, 200, { success: true, data: taskScheduler.getAllTasks() }, ctx);
    return;
  }
  const taskTriggerMatch = path.match(/^\/api\/tasks\/([^/]+)\/trigger$/);
  if (taskTriggerMatch && method === "POST") {
    const taskId = taskTriggerMatch[1];
    try {
      const result = await taskScheduler.triggerTask(taskId);
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  const taskToggleMatch = path.match(/^\/api\/tasks\/([^/]+)\/toggle$/);
  if (taskToggleMatch && method === "POST") {
    const taskId = taskToggleMatch[1];
    const task = taskScheduler.getAllTasks().find((t) => t.id === taskId);
    if (!task) {
      json(res, 404, { success: false, error: { message: "Task not found" } }, ctx);
      return;
    }
    const wasEnabled = task.options.enabled !== false;
    if (wasEnabled) {
      taskScheduler.disableTask(taskId);
    } else {
      taskScheduler.enableTask(taskId);
    }
    json(res, 200, { success: true, data: { enabled: !wasEnabled } }, ctx);
    return;
  }
  const taskDeleteMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskDeleteMatch && method === "DELETE") {
    const taskId = taskDeleteMatch[1];
    taskScheduler.deleteTask(taskId);
    json(res, 200, { success: true }, ctx);
    return;
  }

  // ================================================================
  // Personality API
  // ================================================================
  const personalityMatch = path.match(/^\/api\/personality\/([^/]+)$/);
  if (personalityMatch && method === "GET") {
    const sessionId = personalityMatch[1];
    const pe = createPersonalityEvolution(sessionId);
    json(res, 200, { success: true, data: { description: pe.generatePersonalityDescription(), traits: (pe as unknown as { traits: Record<string, number> }).traits, values: (pe as unknown as { values: string[] }).values } }, ctx);
    return;
  }
  const personalityAnchorsMatch = path.match(/^\/api\/personality\/([^/]+)\/anchors$/);
  if (personalityAnchorsMatch && method === "GET") {
    const sessionId = personalityAnchorsMatch[1];
    const pe = createPersonalityEvolution(sessionId);
    const query = new URL(req.url || "", "http://localhost").searchParams.get("q") || "";
    json(res, 200, { success: true, data: pe.getRelevantAnchors(query, 20) }, ctx);
    return;
  }
  if (personalityAnchorsMatch && method === "POST") {
    const sessionId = personalityAnchorsMatch[1];
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ content: z.string(), category: z.enum(["value", "preference", "behavior"]), importance: z.number().min(0).max(1) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const pe = createPersonalityEvolution(sessionId);
    pe.addAnchorMemory(parsed.data);
    json(res, 200, { success: true }, ctx);
    return;
  }

  // ================================================================
  // Dreaming API
  // ================================================================
  const dreamingMatch = path.match(/^\/api\/dreaming\/([^/]+)$/);
  if (dreamingMatch && method === "GET") {
    const sessionId = dreamingMatch[1];
    const dm = createDreamingMemory(sessionId);
    const memories = await dm.getPromotedMemories(50);
    json(res, 200, { success: true, data: memories }, ctx);
    return;
  }
  const dreamingConsolidateMatch = path.match(/^\/api\/dreaming\/([^/]+)\/consolidate$/);
  if (dreamingConsolidateMatch && method === "POST") {
    const sessionId = dreamingConsolidateMatch[1];
    const dm = createDreamingMemory(sessionId);
    const stats = await dm.runConsolidation();
    json(res, 200, { success: true, data: stats }, ctx);
    return;
  }

  // ================================================================
  // Context Management API
  // ================================================================
  if (path === "/api/context/stats" && method === "GET") {
    json(res, 200, { success: true, data: { injector: contextManager.getInjector().getAllInjections() } }, ctx);
    return;
  }
  if (path === "/api/context/injections" && method === "GET") {
    json(res, 200, { success: true, data: contextManager.getInjector().getAllInjections() }, ctx);
    return;
  }
  if (path === "/api/context/injections" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({
      id: z.string(),
      content: z.string(),
      tokenCount: z.number(),
      priority: z.number(),
      enabled: z.boolean(),
      point: z.enum(["system", "pre_user", "pre_assistant", "dynamic"]),
      maxFrequency: z.number().optional(),
    }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    contextManager.getInjector().addInjection(parsed.data);
    json(res, 200, { success: true }, ctx);
    return;
  }

  // ================================================================
  // Knowledge Base API
  // ================================================================
  if (path === "/api/kb/ingest" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ sessionId: z.string(), source: z.string(), isFile: z.boolean().default(true), filename: z.string().optional(), format: z.string().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const result = await kb.ingestDocument(parsed.data.sessionId, parsed.data.source, {
        isFile: parsed.data.isFile,
        filename: parsed.data.filename,
        format: parsed.data.format,
      });
      json(res, result.success ? 200 : 500, { success: result.success, data: result.success ? { documentId: result.documentId, chunkCount: result.chunkCount } : undefined, error: result.error ? { message: result.error } : undefined }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/kb/query" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ sessionId: z.string(), query: z.string(), topK: z.number().default(5) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const result = await kb.queryKnowledge(parsed.data.sessionId, parsed.data.query, parsed.data.topK);
      json(res, 200, { success: true, data: result.results }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  const kbDocsMatch = path.match(/^\/api\/kb\/documents\/([^/]+)$/);
  if (kbDocsMatch && method === "GET") {
    const sessionId = kbDocsMatch[1];
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listDocuments(sessionId) }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (kbDocsMatch && method === "DELETE") {
    const sessionId = kbDocsMatch[1];
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ documentId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const ok = kb.deleteDocument(sessionId, parsed.data.documentId);
      json(res, ok ? 200 : 404, { success: ok, error: ok ? undefined : { message: "Document not found" } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // File Upload API
  // ================================================================
  if (path === "/api/upload" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return;
      }
      const buffer = await readBodyBuffer(req, 5 * 1024 * 1024);
      const parsed = parseMultipartImage(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid image file found" } }, ctx);
        return;
      }
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      if (!allowed.includes(parsed.mimeType)) {
        json(res, 400, { success: false, error: { message: `Unsupported image type: ${parsed.mimeType}` } }, ctx);
        return;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const ext = parsed.filename.split(".").pop() || "png";
      const safeName = `${randomUUID()}.${ext}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      mkdirSync(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      writeFileSync(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large (max 5MB)" } }, ctx);
        return;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  if (path === "/api/upload/file" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return;
      }
      const buffer = await readBodyBuffer(req, 20 * 1024 * 1024);
      const parsed = parseMultipartFile(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid file found" } }, ctx);
        return;
      }
      const allowedExts = [".pdf", ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".csv", ".docx", ".xlsx", ".pptx"];
      const ext = extname(parsed.filename).toLowerCase();
      if (!allowedExts.includes(ext)) {
        json(res, 400, { success: false, error: { message: `Unsupported file type: ${ext}` } }, ctx);
        return;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const safeName = `${randomUUID()}-${parsed.filename}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      mkdirSync(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      writeFileSync(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large (max 20MB)" } }, ctx);
        return;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  const uploadMatch = path.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/);
  if (uploadMatch && method === "GET") {
    const [, sessionId, filename] = uploadMatch;
    const filePath = join(process.cwd(), ".ouroboros", "uploads", sessionId, filename);
    if (!existsSync(filePath)) {
      json(res, 404, { success: false, error: { message: "File not found" } }, ctx);
      return;
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
      txt: "text/plain",
      md: "text/markdown",
      json: "application/json",
      js: "application/javascript",
      ts: "application/typescript",
      jsx: "application/javascript",
      tsx: "application/typescript",
      py: "text/x-python",
      csv: "text/csv",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const mime = mimeMap[ext || ""] || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(filePath).pipe(res);
    return;
  }

  // ================================================================
  // Multimedia API
  // ================================================================
  if (path === "/api/media/generate" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ type: z.enum(["image", "video", "music"]), prompt: z.string(), options: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      let result;
      if (parsed.data.type === "image") {
        result = await mediaGenerator.generateImage(parsed.data.prompt, parsed.data.options);
      } else if (parsed.data.type === "video") {
        result = await mediaGenerator.generateVideo(parsed.data.prompt, parsed.data.options);
      } else {
        result = await mediaGenerator.generateMusic(parsed.data.prompt, parsed.data.options);
      }
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  const mediaStatusMatch = path.match(/^\/api\/media\/tasks\/([^/]+)$/);
  if (mediaStatusMatch && method === "GET") {
    const taskId = mediaStatusMatch[1];
    const status = mediaGenerator.getTask(taskId);
    if (!status) {
      json(res, 404, { success: false, error: { message: "Task not found" } }, ctx);
      return;
    }
    json(res, 200, { success: true, data: status }, ctx);
    return;
  }

  // ================================================================
  // Channels API
  // ================================================================
  if (path === "/api/channels" && method === "GET") {
    const channels = [
      { id: "feishu", ...feishuPlugin.meta, running: feishuPlugin.isRunning() },
      { id: "slack", ...slackPlugin.meta, running: false },
      { id: "dingtalk", ...dingtalkPlugin.meta, running: false },
      { id: "wechatwork", ...wechatworkPlugin.meta, running: false },
      { id: "telegram", ...telegramPlugin.meta, running: false },
      { id: "discord", ...discordPlugin.meta, running: false },
      { id: "mock-chat", ...mockChatPlugin.meta, running: true },
    ];
    json(res, 200, { success: true, data: channels }, ctx);
    return;
  }

  // ================================================================
  // Channel Registry API
  // ================================================================
  if (path === "/api/channels/bind" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ sessionId: z.string(), channelId: z.string(), config: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      channelRegistry.bindSession(parsed.data.sessionId, parsed.data.channelId, parsed.data.config);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  const channelSessionMatch = path.match(/^\/api\/channels\/session\/([^/]+)$/);
  if (channelSessionMatch && method === "GET") {
    const sessionId = channelSessionMatch[1];
    const plugin = channelRegistry.getChannelForSession(sessionId);
    if (!plugin) {
      json(res, 404, { success: false, error: { message: "No channel bound" } }, ctx);
      return;
    }
    json(res, 200, { success: true, data: { channelId: plugin.id, meta: plugin.meta } }, ctx);
    return;
  }

  // ================================================================
  // Providers API
  // ================================================================
  if (path === "/api/providers" && method === "GET") {
    const providers = [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
      { id: "gemini", name: "Google Gemini" },
      { id: "minimax", name: "MiniMax" },
      { id: "qwen", name: "Alibaba Qwen" },
    ];
    json(res, 200, { success: true, data: providers }, ctx);
    return;
  }

  // ================================================================
  // Locale / i18n API
  // ================================================================
  if (path === "/api/locale" && method === "GET") {
    json(res, 200, { success: true, data: { locale: i18n.getLocale(), supported: i18n.getSupportedLocales() } }, ctx);
    return;
  }
  if (path === "/api/locale" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ locale: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    i18n.setLocale(parsed.data.locale as Locale);
    json(res, 200, { success: true, data: { locale: i18n.getLocale() } }, ctx);
    return;
  }

  // ================================================================
  // Browser API
  // ================================================================
  if (path === "/api/browser/launch" && method === "POST") {
    try {
      await apiBrowserController.launch();
      json(res, 200, { success: true, connected: apiBrowserController.isConnected() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/close" && method === "POST") {
    try {
      await apiBrowserController.close();
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/page" && method === "POST") {
    try {
      const pageId = await apiBrowserController.newPage();
      json(res, 200, { success: true, data: { pageId } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/navigate" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ pageId: z.string(), url: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const result = await apiBrowserController.navigate(parsed.data.pageId, parsed.data.url);
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/click" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ pageId: z.string(), selector: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      await apiBrowserController.click(parsed.data.pageId, parsed.data.selector);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/fill" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ pageId: z.string(), selector: z.string(), text: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      await apiBrowserController.fill(parsed.data.pageId, parsed.data.selector, parsed.data.text);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/screenshot" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ pageId: z.string(), fullPage: z.boolean().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const filePath = await apiBrowserController.screenshot(parsed.data.pageId, { fullPage: parsed.data.fullPage });
      json(res, 200, { success: true, data: { path: filePath } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/browser/extract" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ pageId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const text = await apiBrowserController.evaluate<string>(parsed.data.pageId, "document.body.innerText");
      json(res, 200, { success: true, data: { text } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // Canvas API
  // ================================================================
  if (path === "/api/canvas/draw" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({
      width: z.number().optional(),
      height: z.number().optional(),
      commands: z.array(z.object({
        type: z.enum(["rect", "circle", "text", "image"]),
        x: z.number(),
        y: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        text: z.string().optional(),
        fill: z.string().optional(),
        src: z.string().optional(),
      })),
    }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const workspace = new CanvasWorkspace({ width: parsed.data.width, height: parsed.data.height });
    try {
      const dataUrl = await workspace.draw(parsed.data.commands);
      json(res, 200, { success: true, data: { dataUrl } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/canvas/export" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ width: z.number().optional(), height: z.number().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    const workspace = new CanvasWorkspace({ width: parsed.data.width, height: parsed.data.height });
    try {
      const dataUrl = await workspace.export("png");
      json(res, 200, { success: true, data: { dataUrl } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // Gallery API
  // ================================================================
  if (path === "/api/gallery/screenshots" && method === "GET") {
    try {
      const { readdirSync, statSync } = await import("fs");
      const screenshotsDir = join(homedir(), ".ouroboros", "browser-screenshots");
      if (!existsSync(screenshotsDir)) {
        json(res, 200, { success: true, data: [] }, ctx);
        return;
      }
      const entries = readdirSync(screenshotsDir)
        .filter((f) => f.endsWith(".png"))
        .map((f) => {
          const stat = statSync(join(screenshotsDir, f));
          return { filename: f, url: `/api/gallery/screenshots/${f}`, createdAt: stat.mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      json(res, 200, { success: true, data: entries }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  if (path.startsWith("/api/gallery/screenshots/") && method === "GET") {
    const filename = path.replace("/api/gallery/screenshots/", "").replace(/[\\/]/g, "");
    if (!filename || !filename.endsWith(".png")) {
      notFound(res, ctx);
      return;
    }
    const filePath = join(homedir(), ".ouroboros", "browser-screenshots", filename);
    serveStatic(res, filePath, ctx);
    return;
  }

  // ================================================================
  // CrewAI API
  // ================================================================
  if (path === "/api/crew/run" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ task: z.string(), roles: z.array(z.record(z.unknown())), process: z.enum(["sequential", "hierarchical", "parallel"]).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const result = await runCrewTaskTool.call({ task: parsed.data.task, roles: parsed.data.roles as unknown as CrewAgentRole[], process: parsed.data.process }, {
        taskId: "web",
        abortSignal: new AbortController().signal,
        reportProgress: () => {},
        invokeSubagent: async <_I, O>() => ({ success: true } as O),
      });
      json(res, 200, result as unknown, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // Learning Engine API
  // ================================================================
  if (path === "/api/learning/patterns" && method === "GET") {
    const patterns = Array.from((learningEngine.patternRecognizer as unknown as { patterns?: Map<string, unknown> }).patterns?.values?.() || []).slice(0, 20);
    json(res, 200, { success: true, data: { patterns } }, ctx);
    return;
  }
  const learningConfigMatch = path.match(/^\/api\/learning\/config\/([^/]+)$/);
  if (learningConfigMatch && method === "GET") {
    const sessionId = learningConfigMatch[1];
    const config = learningEngine.adaptiveOptimizer.suggestConfig(sessionId);
    json(res, 200, { success: true, data: { config } }, ctx);
    return;
  }

  // ================================================================
  // Knowledge Base Documents API (global list)
  // ================================================================
  if (path === "/api/kb/documents" && method === "GET") {
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listAllDocuments() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // Knowledge Base Stats API
  // ================================================================
  if (path === "/api/kb/stats" && method === "GET") {
    try {
      const db = getDb();
      const docRow = db.prepare("SELECT COUNT(*) as count FROM kb_documents").get() as { count: number } | undefined;
      const chunkRow = db.prepare("SELECT COUNT(*) as count FROM kb_chunks").get() as { count: number } | undefined;
      const scoreRow = db.prepare("SELECT AVG(promotion_score) as avg FROM kb_chunks").get() as { avg: number | null } | undefined;
      json(res, 200, {
        success: true,
        data: {
          totalDocuments: Number(docRow?.count ?? 0),
          totalChunks: Number(chunkRow?.count ?? 0),
          avgPromotionScore: scoreRow?.avg ?? 0,
        },
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // SOP API
  // ================================================================
  if (path === "/api/sop/run" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ definition: z.record(z.unknown()), initialState: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const result = await run_sop_workflow.call({ definition: parsed.data.definition as unknown as SOPDefinition, initialState: parsed.data.initialState }, {
        taskId: "web",
        abortSignal: new AbortController().signal,
        reportProgress: () => {},
        invokeSubagent: async <_I, O>() => ({ success: true } as O),
      });
      json(res, 200, result as unknown, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  if (path === "/api/sop/templates" && method === "GET") {
    json(res, 200, { success: true, data: defaultSOPTemplates }, ctx);
    return;
  }

  // ================================================================
  // Security Audit API
  // ================================================================
  if (path === "/api/security/audits" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const audits = securityFramework.securityAuditor.getRecentAudits(sessionId, Number.isFinite(limit) && limit > 0 ? limit : 50);
      json(res, 200, { success: true, data: audits }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }

  // ================================================================
  // Webhook Manager API
  // ================================================================
  if (path === "/api/webhooks" && method === "GET") {
    json(res, 200, { success: true, data: webhookManager.list() }, ctx);
    return;
  }
  if (path === "/api/webhooks" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ path: z.string(), secret: z.string(), eventType: z.string(), targetSessionId: z.string().optional(), enabled: z.boolean().default(true) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return;
    }
    try {
      const webhook: WebhookRegistration = { id: randomUUID(), ...parsed.data, enabled: parsed.data.enabled ?? true };
      const id = webhookManager.register(webhook);
      json(res, 200, { success: true, data: { id } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return;
  }
  const webhookDeleteMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
  if (webhookDeleteMatch && method === "DELETE") {
    const id = webhookDeleteMatch[1];
    webhookManager.unregister(id);
    json(res, 200, { success: true }, ctx);
    return;
  }

  notFound(res, ctx);
}

// =============================================================================
// Main Server
// =============================================================================

let activeServer: Server | null = null;

export function createApp(): Server {
  const server = createServer(async (req, res) => {
    const ctx = createReqContext();
    const url = req.url || "/";
    const path = url.split("?")[0];
    const origin = getOrigin(req);
    setCorsHeaders(res, origin);
    setSecurityHeaders(res);

    const start = Date.now();
    try {
      // Also handle root-level health endpoints for load balancers / k8s probes
      if (path === "/health" || path === "/ready" || path === "/metrics") {
        await handleApi(req, res, `/api${path}`, ctx);
        return;
      }

      if (path.startsWith("/api/")) {
        await handleApi(req, res, path, ctx);
        return;
      }

      // Incoming webhooks
      if (path.startsWith("/webhooks/")) {
        const webhook = webhookManager.getHandler(path);
        if (webhook && webhook.enabled) {
          try {
            const body = await readBody(req);
            const signature = req.headers["x-signature"] as string | undefined;
            if (signature && !webhookManager.verifySignature(body, webhook.secret, signature)) {
              json(res, 403, { success: false, error: { message: "Invalid signature" } }, ctx);
              return;
            }
            notificationBus.emitEvent({
              type: "webhook",
              title: `Webhook: ${webhook.eventType}`,
              message: `Received event on ${webhook.path}`,
              timestamp: Date.now(),
              meta: { webhookId: webhook.id, eventType: webhook.eventType, targetSessionId: webhook.targetSessionId },
            });
            json(res, 200, { success: true, received: true }, ctx);
          } catch (e) {
            json(res, 500, { success: false, error: { message: String(e) } }, ctx);
          }
          return;
        }
      }

      // Static files
      if (path.startsWith("/assets/")) {
        serveStatic(res, join(WEB_DIST, path), ctx);
        return;
      }

      // SPA fallback
      serveIndex(res, ctx);
    } catch (e) {
      logger.error("Unhandled request error", { error: String(e), path, requestId: ctx.requestId });
      captureException(e, { path, requestId: ctx.requestId });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    } finally {
      const durationMs = Date.now() - start;
      recordRequestMetrics(req.method || "GET", path, res.statusCode || 200, durationMs / 1000);
      logRequest(req, res, ctx, path, durationMs);
    }
  });
  activeServer = server;
  server.timeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
  attachWebSocket(server);
  return server;
}

export function gracefulShutdown(signal = "MANUAL", exitCode = 0): void {
  logger.info(`Shutting down gracefully...`, { signal });
  stopRunnerIdleCleanup();
  closeWebSocket().then(() => closeRedis()).then(() => {
    if (activeServer) {
      activeServer.close(() => {
        logger.info("Server closed");
        process.exit(exitCode);
      });
    } else {
      process.exit(exitCode);
    }
  });
  // Force exit after 10s
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

export function cleanupOldUploads(maxAgeDays = 30): { deleted: number; dirsRemoved: number } {
  const uploadsDir = join(process.cwd(), ".ouroboros", "uploads");
  if (!existsSync(uploadsDir)) return { deleted: 0, dirsRemoved: 0 };
  const now = Date.now();
  let deleted = 0;
  let dirsRemoved = 0;

  for (const sessionId of readdirSync(uploadsDir)) {
    const sessionDir = join(uploadsDir, sessionId);
    const stat = statSync(sessionDir);
    if (!stat.isDirectory()) continue;
    for (const filename of readdirSync(sessionDir)) {
      const filePath = join(sessionDir, filename);
      const fileStat = statSync(filePath);
      if (fileStat.isFile()) {
        const ageDays = (now - fileStat.mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > maxAgeDays) {
          unlinkSync(filePath);
          deleted++;
        }
      }
    }
    // Remove empty directory
    if (readdirSync(sessionDir).length === 0) {
      rmdirSync(sessionDir);
      dirsRemoved++;
    }
  }

  return { deleted, dirsRemoved };
}

// Auto-start only when this file is the entrypoint
const isEntrypoint = process.argv[1]?.includes("server.ts") || import.meta.url.endsWith(process.argv[1] || "");

if (isEntrypoint) {
  (async () => {
    await reconcileSkillRegistry();
    startRunnerIdleCleanup();
    startWorkerIdleCleanup();
    await maybeAutoBackup();

    // Register cron tasks with TaskScheduler for observability and control
    taskScheduler.registerCronTask(
      async () => {
        await maybeAutoBackup();
      },
      { id: "auto-backup", name: "Daily Auto-Backup", cron: "0 3 * * *", enabled: true }
    );

    taskScheduler.registerCronTask(
      async () => {
        const res = await pruneDeletedSessions(7 * 24 * 60 * 60 * 1000);
        if (res.success) {
          logger.info("Pruned soft-deleted sessions", { count: res.data });
        } else {
          logger.error("Prune soft-deleted sessions failed", { error: res.error.message });
          throw new Error(res.error.message);
        }
      },
      { id: "prune-sessions", name: "Prune Soft-Deleted Sessions", cron: "0 4 * * *", enabled: true }
    );

    taskScheduler.registerCronTask(
      async () => {
        const { deleted, dirsRemoved } = cleanupOldUploads(30);
        if (deleted > 0 || dirsRemoved > 0) {
          logger.info("Pruned old uploads", { deleted, dirsRemoved });
        }
      },
      { id: "cleanup-uploads", name: "Cleanup Old Uploads", cron: "0 5 * * *", enabled: true }
    );

    taskScheduler.registerCronTask(
      async () => {
        const result = consolidateMemoryLayers();
        logger.info("Memory consolidation completed", { result });
      },
      { id: "memory-consolidation", name: "Memory Consolidation", cron: "0 2 * * *", enabled: true }
    );

    taskScheduler.registerCronTask(
      async () => {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const result = pruneTokenUsage(cutoff);
        if (result.success && result.deleted > 0) {
          logger.info("Pruned old token usage records", { deleted: result.deleted });
        }
      },
      { id: "prune-token-usage", name: "Prune Old Token Usage", cron: "0 6 * * *", enabled: true }
    );

    // Resume any worker tasks that were queued or running before restart
    try {
      await resumeQueuedWorkerTasks({ getGlobalTools: () => globalPool.all(), getLLMConfig: () => llmCfg });
    } catch (e) {
      logger.error("Failed to resume queued worker tasks", { error: String(e) });
    }

    // Auto-start Feishu webhook if configured
    if (appConfig.feishu.appId && appConfig.feishu.appSecret && appConfig.feishu.autoStart) {
      try {
        feishuPlugin.start();
        logger.info("Feishu webhook auto-started", { port: appConfig.feishu.webhookPort, path: appConfig.feishu.webhookPath });
      } catch (e) {
        logger.error("Feishu webhook auto-start failed", { error: String(e) });
      }
    }

    // Helper to download Feishu image and return base64 data URL
    async function resolveFeishuImage(imageKeyOrUrl: string): Promise<string> {
      if (imageKeyOrUrl.startsWith("http://") || imageKeyOrUrl.startsWith("https://")) {
        return imageKeyOrUrl;
      }
      const cfg = appConfig.feishu;
      if (!cfg.appId || !cfg.appSecret) {
        return `[Feishu image: ${imageKeyOrUrl}]`;
      }
      try {
        const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);
        const res = await fetch(`${FEISHU_API_BASE}/im/v1/images/${encodeURIComponent(imageKeyOrUrl)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return `[Feishu image: ${imageKeyOrUrl} (download failed)]`;
        }
        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
          return `[Feishu image: ${imageKeyOrUrl} (too large)]`;
        }
        const contentType = res.headers.get("content-type") || "image/png";
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:${contentType};base64,${base64}`;
      } catch (e) {
        return `[Feishu image: ${imageKeyOrUrl} (error)]`;
      }
    }

    // Bind Feishu inbound messages to the Agent Loop
    feishuPlugin.inbound.onMessage(async (msg) => {
      // Only respond when explicitly mentioned in groups, or always in p2p chats
      if (msg.isGroup && !msg.mentionsBot) return;

      const sessionId = `feishu:${msg.channelId}`;
      channelRegistry.bindSession(sessionId, "feishu");
      const runner = getOrCreateRunner(sessionId);

      // Build content blocks from text + richText (images)
      let content: string | ContentBlock[] = msg.text || "";
      if (msg.richText && msg.richText.length > 0) {
        const blocks: ContentBlock[] = [];
        if (msg.text) {
          blocks.push({ type: "text", text: msg.text });
        }
        for (const block of msg.richText) {
          if (block.type === "image" && block.value) {
            const url = await resolveFeishuImage(block.value);
            if (url.startsWith("data:") || url.startsWith("http")) {
              blocks.push({ type: "image_url", image_url: { url, detail: "auto" } });
            } else {
              blocks.push({ type: "text", text: url });
            }
          } else if (block.type === "file" && block.value) {
            blocks.push({ type: "text", text: `[附件: ${block.value}]` });
          } else if (block.type === "text" && block.value && block.value !== msg.text) {
            blocks.push({ type: "text", text: block.value });
          }
        }
        content = blocks;
      }

      let replyText = "";
      const computerUseImages: string[] = [];
      try {
        for await (const event of runner.run(content)) {
          if ("role" in event && event.role === "assistant") {
            if (typeof event.content === "string") {
              replyText += event.content;
            } else if (Array.isArray(event.content)) {
              replyText += event.content
                .filter((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
                .map((b) => (typeof b === "object" && b !== null ? (b as { text?: string }).text : ""))
                .filter((t): t is string => typeof t === "string")
                .join("\n");
            }
          } else if ("type" in event && event.type === "tool_result" && event.toolUseId) {
            // Detect computer_use result and queue screenshot for sending
            try {
              const parsed = JSON.parse(event.content);
              if (parsed && parsed.success && parsed.finalScreenshotPath && existsSync(parsed.finalScreenshotPath)) {
                computerUseImages.push(parsed.finalScreenshotPath);
              }
            } catch {
              // ignore non-JSON tool results
            }
          }
        }
      } catch (e) {
        logger.error("Feishu agent loop error", { sessionId, error: String(e) });
        replyText = "处理消息时出现错误，请稍后重试。";
      }

      const trimmed = replyText.trim();
      if (!trimmed && computerUseImages.length === 0) return;

      // Heuristic: use interactive card for long or structured replies
      const looksStructured = /(```|\|.*\||^#{1,6} |\*\*|\n\n)/m.test(trimmed);
      const useCard = trimmed.length > 800 || looksStructured;

      let sendResult;
      if (trimmed) {
        if (useCard) {
          sendResult = await feishuPlugin.outbound.sendRichText(
            msg.channelId,
            [{ type: "text", value: trimmed }],
            { threadId: msg.threadId }
          );
        } else {
          sendResult = await feishuPlugin.outbound.sendText(msg.channelId, trimmed, { threadId: msg.threadId });
        }
      }

      for (const imagePath of computerUseImages) {
        if (feishuPlugin.outbound.sendMedia) {
          await feishuPlugin.outbound.sendMedia(msg.channelId, imagePath, { threadId: msg.threadId });
        }
      }
      if (sendResult && !sendResult.success) {
        logger.error("Feishu send reply failed", { sessionId, channelId: msg.channelId });
      }
    });

    const server = createApp();
    server.listen(PORT, () => {
      logger.info(`Ouroboros Web server running at http://localhost:${PORT}`, { dist: WEB_DIST });
    });

    process.on("SIGTERM", () => {
      taskScheduler.destroy();
      gracefulShutdown("SIGTERM", 0);
    });
    process.on("SIGINT", () => {
      taskScheduler.destroy();
      gracefulShutdown("SIGINT", 0);
    });
  })();
}
