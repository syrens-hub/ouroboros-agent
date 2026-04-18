import "dotenv/config";
import { z } from "zod";
import { type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { randomUUID, timingSafeEqual, createHash } from "crypto";
import Database from "better-sqlite3";
import { createTrajectoryCompressor } from "../../skills/learning/index.ts";
import type { TrajectoryEntry } from "../../types/index.ts";
import { appConfig } from "../../core/config.ts";
import { PAYLOAD_TOO_LARGE } from "./constants.ts";
import { notificationBus, type NotificationEvent } from "../../skills/notification/index.ts";

import { initSentry } from "../../core/sentry.ts";
import { feishuPlugin } from "../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../../extensions/im/telegram/index.ts";
import { discordPlugin } from "../../extensions/im/discord/index.ts";
import { slackPlugin } from "../../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../../extensions/im/wechatwork/index.ts";
import { ChannelRegistry } from "../../core/channel-registry.ts";

import { createSelfHealer } from "../../skills/self-healing/index.ts";
import { createTaskScheduler } from "../../skills/task-scheduler/index.ts";
import { MultimediaGenerator } from "../../skills/multimedia/index.ts";
import { getI18n, createI18n } from "../../skills/i18n/index.ts";
import { createContextManager } from "../../skills/context-management/index.ts";
import { BrowserController } from "../../skills/browser/index.ts";
import { createSecurityFramework } from "../../core/security-framework.ts";
import { WebhookManager } from "../../skills/webhooks/index.ts";
import { LearningEngine } from "../../skills/learning/engine.ts";
import { broadcastNotification } from "../ws-server.ts";
import { hookRegistry } from "../../core/hook-system.ts";

initSentry();

const WEB_DIST = join(process.cwd(), "web", "dist");
const DB_PATH = join(appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir), "session.db");
const OUT_DIR = join(process.cwd(), ".ouroboros");
const OUT_PATH = join(OUT_DIR, "trajectories.jsonl");

function getApiToken(): string {
  return appConfig.web.apiToken || "";
}
const ALLOWED_ORIGINS = appConfig.web.allowedOrigins;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

notificationBus.on("notification", (evt: NotificationEvent) => {
  broadcastNotification(evt);
  hookRegistry.emit("notification", {
    type: evt.type,
    title: evt.title,
    message: evt.message,
    timestamp: evt.timestamp,
    ...evt.meta,
  }).catch(() => {});
});

// Initialize hooks once at module load
hookRegistry.registerBuiltins();
hookRegistry.discoverAndLoad();

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
  // Only use Origin header for CORS validation. Referer can be forged or omitted.
  const origin = req.headers.origin || "";
  return origin;
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false; // Never allow missing origin for credentialed requests
  if (ALLOWED_ORIGINS.length === 0) {
    // No origins configured: require explicit Authorization header for all protected endpoints
    return false;
  }
  // Only match exact origins — no subdomain or prefix wildcards without explicit config
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Determine the appropriate Access-Control-Allow-Origin header value.
 * Returns the matching origin for credentialed requests, or "*" only when
 * no credentials are involved and origins are explicitly allowed.
 */
function getAllowOriginValue(origin: string): string {
  if (!origin) return "";
  if (!isAllowedOrigin(origin)) {
    // Fallback to the first explicitly configured origin (for preflight responses only).
    // This does NOT grant cross-origin access — CORS validation above already rejected it.
    // We return an empty string so the browser receives no Allow-Origin, denying the request.
    return "";
  }
  return origin;
}

export function setCorsHeaders(res: ServerResponse, origin: string) {
  const allowOrigin = getAllowOriginValue(origin);
  // Only set the header when we have a validated origin — never "*" with credentials
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Vary", "Origin");
  }
  // Credentials are never sent to untrusted origins here
  res.setHeader("Access-Control-Allow-Credentials", "false");
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
        reject(new Error(PAYLOAD_TOO_LARGE));
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
        reject(new Error(PAYLOAD_TOO_LARGE));
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

export async function readJsonBody<T>(
  req: IncomingMessage,
  schema: z.ZodSchema<T>,
): Promise<{ success: true; data: T } | { success: false; error: string; status: 400 | 413 }> {
  let body: string;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
      return { success: false, error: "Payload too large", status: 413 };
    }
    throw e;
  }
  const parsed = parseBody(body, schema);
  if (!parsed.success) {
    return { success: false, error: parsed.error, status: 400 };
  }
  return { success: true, data: parsed.data };
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
  // Use >= so that entries that are exactly at expiry are treated as expired
  // (same semantics as a wall-clock TTL boundary).
  if (entry && entry.expiresAt >= now) return entry.data as T;

  // Evict expired entries opportunistically when cache is not full.
  // This prevents unbounded growth of stale entries.
  if (apiCache.size >= MAX_API_CACHE_SIZE) {
    // Remove all expired entries first before forcing LRU eviction.
    for (const [k, e] of apiCache.entries()) {
      if (e.expiresAt < now) apiCache.delete(k);
    }
    // If still full after purging expired, evict the oldest entry.
    if (apiCache.size >= MAX_API_CACHE_SIZE) {
      const firstKey = apiCache.keys().next().value;
      if (firstKey !== undefined) apiCache.delete(firstKey);
    }
  }

  const data = fn();
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

function isAuthValid(req: IncomingMessage, urlPath: string): boolean {
  // Health/readiness/metrics probes must remain unauthenticated for load balancers and k8s
  if (urlPath === "/api/health" || urlPath === "/api/ready" || urlPath === "/api/metrics") {
    return true;
  }
  // SECURITY FIX: Empty API token means authentication is REQUIRED but not configured.
  // Previously this returned `true` (bypassing auth), which is a critical security hole.
  // In production, WEB_API_TOKEN must be set to a non-empty value.
  const apiToken = getApiToken();
  if (!apiToken) {
    // Log the first attempt per process to help operators diagnose misconfiguration,
    // but don't include sensitive details in the log.
    if (process.env.NODE_ENV === "production") {
      // In production, deny ALL authenticated endpoints when the token is not configured.
      // This prevents accidental deployment with auth disabled.
      return false;
    }
    // In development, warn loudly but still allow unauthenticated access for local testing.
    if (process.env.NODE_ENV === "development") {
      // Only warn once to avoid log spam during dev sessions.
      if (!_authWarningEmitted) {
        _authWarningEmitted = true;
         
        console.warn(
          "[Ouroboros Security] WEB_API_TOKEN is not set. " +
            "Authentication is bypassed in development mode. " +
            "Set WEB_API_TOKEN in production to enable authentication."
        );
      }
      return true;
    }
    return false;
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  // Use timing-safe comparison to prevent timing attacks on the API token.
  const a = createHash("sha256").update(bearer).digest();
  const b = createHash("sha256").update(apiToken).digest();
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let _authWarningEmitted = false;

// =============================================================================
// Security Headers
// =============================================================================

export function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP: SPA需要 'unsafe-inline'，未来应迁移到 nonce-based 方案
  // 'strict-dynamic' 可以帮助但需要 Vite 配置支持
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data: https:; font-src 'self'; base-uri 'self';"
  );
}

export {
  recordRequestMetrics,
  logRequest,
  requestCounter,
  requestDurationHistogram,
  requestDurationBuckets,
  MAX_METRIC_COUNTER_KEYS,
} from "./lib/metrics.ts";

async function getPrometheusMetrics(): Promise<string> {
  const { getPrometheusMetrics: _getPrometheusMetrics } = await import("./lib/metrics.ts");
  return _getPrometheusMetrics(taskScheduler);
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
  const token = getApiToken();
  if (token) {
    injects.push(`<script>window.__OUROBOROS_API_TOKEN__=${JSON.stringify(token)}</script>`);
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

export { getHealthStatus } from "./lib/health.ts";

// =============================================================================
// Route Handlers
// =============================================================================
export {
  WEB_DIST,
  DB_PATH,
  OUT_DIR,
  OUT_PATH,
  getApiToken,
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
  getPrometheusMetrics,
  notFound,
  formatAsShareGPT,
  exportTrajectories,
};

export type {
  ReqContext,
  CacheEntry,
  ShareGPTConversation,
};
