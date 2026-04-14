import "dotenv/config";
import { z } from "zod";
import { type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { listSessions, getDb } from "../../core/session-db.ts";
import { createTrajectoryCompressor } from "../../skills/learning/index.ts";
import type { TrajectoryEntry } from "../../types/index.ts";
import { appConfig } from "../../core/config.ts";
import { logger } from "../../core/logger.ts";
import { notificationBus, type NotificationEvent } from "../../core/notification-bus.ts";

import { getLLMMetrics } from "../../core/llm-metrics.ts";
import { initSentry } from "../../core/sentry.ts";
import {
  llmCfg,
  discoverSkills,
  getDaemonStatus,
  getRunnerPoolStats,
} from "../runner-pool.ts";
import { getWorkerRunnerStats } from "../../skills/orchestrator/index.ts";

import { feishuPlugin } from "../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../../extensions/im/telegram/index.ts";
import { discordPlugin } from "../../extensions/im/discord/index.ts";
import { slackPlugin } from "../../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../../extensions/im/wechatwork/index.ts";
import { ChannelRegistry } from "../../core/channel-registry.ts";

import { createSelfHealer } from "../../core/self-healing.ts";
import { createTaskScheduler } from "../../core/task-scheduler.ts";
import { MultimediaGenerator } from "../../skills/multimedia/index.ts";
import { getI18n, createI18n } from "../../core/i18n.ts";
import { createContextManager } from "../../skills/context-management/index.ts";
import { BrowserController } from "../../skills/browser/index.ts";
import { createSecurityFramework } from "../../core/security-framework.ts";
import { WebhookManager } from "../../core/webhook-manager.ts";
import { LearningEngine } from "../../skills/learning/engine.ts";
import { broadcastNotification, getWsClientCount, getWsConnectionsTotal } from "../ws-server.ts";

initSentry();

const WEB_DIST = join(process.cwd(), "web", "dist");
const DB_PATH = join(appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir), "session.db");
const OUT_DIR = join(process.cwd(), ".ouroboros");
const OUT_PATH = join(OUT_DIR, "trajectories.jsonl");

const API_TOKEN = appConfig.web.apiToken || "";
const ALLOWED_ORIGINS = appConfig.web.allowedOrigins;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

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
export const taskScheduler = createTaskScheduler();
const mediaGenerator = new MultimediaGenerator();
const i18n = getI18n() || createI18n({ defaultLocale: "en" });
const contextManager = createContextManager();
const apiBrowserController = new BrowserController({ headless: true });
const securityFramework = createSecurityFramework();
export const webhookManager = new WebhookManager();
export const channelRegistry = new ChannelRegistry();
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

export function createReqContext(): ReqContext {
  return { requestId: randomUUID(), startTime: Date.now() };
}

// =============================================================================
// CORS
// =============================================================================

export function getOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || req.headers.referer || "";
  return origin;
}

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export function setCorsHeaders(res: ServerResponse, origin: string) {
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

export function readBody(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<string> {
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

export function setSecurityHeaders(res: ServerResponse) {
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

export function recordRequestMetrics(method: string, path: string, statusCode: number, durationSec: number) {
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

export function logRequest(req: IncomingMessage, res: ServerResponse, ctx: ReqContext, path: string, durationMs: number) {
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

export function json(res: ServerResponse, status: number, data: unknown, ctx: ReqContext) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Request-ID": ctx.requestId,
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse, ctx: ReqContext) {
  json(res, 404, { success: false, error: { message: "Not found" } }, ctx);
}

export function serveStatic(res: ServerResponse, filePath: string, ctx: ReqContext) {
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

export function serveIndex(res: ServerResponse, ctx: ReqContext) {
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
export {
  WEB_DIST,
  DB_PATH,
  OUT_DIR,
  OUT_PATH,
  API_TOKEN,
  ALLOWED_ORIGINS,
  MAX_BODY_SIZE,
  MIME,
  selfHealer,
  mediaGenerator,
  i18n,
  contextManager,
  apiBrowserController,
  securityFramework,
  learningEngine,
  isAllowedOrigin,
  readBodyBuffer,
  parseMultipartFile,
  parseMultipartImage,
  ConfirmBodySchema,
  InstallSkillBodySchema,
  RestoreBackupBodySchema,
  parseBody,
  apiCache,
  MAX_API_CACHE_SIZE,
  getCached,
  getClientIp,
  isAuthValid,
  requestCounter,
  requestDurationHistogram,
  requestDurationBuckets,
  MAX_METRIC_COUNTER_KEYS,
  MAX_METRIC_HISTOGRAM_KEYS,
  normalizeMetricPath,
  pruneMetricsIfNeeded,
  incCounter,
  observeHistogram,
  getPrometheusMetrics,
  notFound,
  formatAsShareGPT,
  exportTrajectories,
  getHealthStatus,
};

export type {
  ReqContext,
  CacheEntry,
  ShareGPTConversation,
};
