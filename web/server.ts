#!/usr/bin/env tsx
/**
 * Ouroboros Web UI Server
 * ========================
 * Native Node.js HTTP server serving the built SPA and API endpoints.
 */

import "dotenv/config";
import "../skills/evolution-core/init.ts";
import { type Server, createServer } from "http";
import { existsSync, statSync, readdirSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";
import { appConfig, validateConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { notificationBus } from "../skills/notification/index.ts";
import { maybeAutoBackup } from "../skills/backup/index.ts";
import {
  SERVER_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_HEADERS_TIMEOUT_MS,
} from "./routes/constants.ts";
import {
  startRunnerIdleCleanup,
  reconcileSkillRegistry,
  getOrCreateRunner,
  globalPool,
  llmCfg,
} from "./runner-pool.ts";
import { startWorkerIdleCleanup, resumeQueuedWorkerTasks } from "../skills/orchestrator/index.ts";
import { feishuPlugin, FEISHU_API_BASE, getTenantAccessToken } from "../extensions/im/feishu/index.ts";
import { attachWebSocket } from "./ws-server.ts";
import { captureException } from "../core/sentry.ts";
import { initOtel } from "../skills/telemetry/otel.ts";
import { consolidateMemoryLayers } from "../core/memory-consolidation.ts";
import type { ContentBlock } from "../types/index.ts";
import { pruneDeletedSessions } from "../core/session-db.ts";
import { dbInitPromise } from "../core/db-manager.ts";
import { pruneTokenUsage } from "../core/repositories/token-usage.ts";
import { handleApi } from "./routes/api.ts";
import { checkRateLimit } from "../skills/rate-limiter/index.ts";
import { gracefulShutdown } from "./shutdown.ts";
import { executionDaemon } from "../skills/evolution-executor/index.ts";
import { registerFeedbackLoop } from "../skills/evolution-feedback/index.ts";
import { registerEvolutionObservability } from "../skills/evolution-observability/index.ts";
import { autonomousEvolutionLoop } from "../skills/autonomous-evolution/index.ts";
import { runMetaEvolutionAnalysis } from "../skills/meta-evolution/index.ts";
import {
  readBody,
  json,
  serveStatic,
  serveIndex,
  createReqContext,
  getOrigin,
  setCorsHeaders,
  setSecurityHeaders,
  logRequest,
  recordRequestMetrics,
  recordApiAudit,
  pruneApiAuditLogs,
  webhookManager,
  taskScheduler,
  channelRegistry,
} from "./routes/shared.ts";
import { safeJsonParse } from "../core/safe-utils.ts";
import { securityConfig } from "../core/config-extension.ts";
import { pruneDeadLetters } from "../core/event-bus.ts";
import { pruneSecurityAuditLogs } from "../core/security-framework.ts";
import { checkAndRollback, clearPendingMarker } from "../core/evolution/rollback.ts";
import { startDiskMonitor, stopDiskMonitor } from "../core/disk-monitor.ts";

import { detectIntrusion, recordViolation } from "../core/intrusion-detection.ts";
import { getSecret } from "../core/config/secret-manager.ts";

const PORT = appConfig.web.port;
const WEB_DIST = join(process.cwd(), "web", "dist");


// Initialize OpenTelemetry early
initOtel();

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

    // Intrusion detection layer
    const intrusion = detectIntrusion(req);
    if (intrusion.blocked) {
      const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.socket.remoteAddress || "unknown";
      recordViolation(clientIp);
      json(res, 403, { success: false, error: { message: "Request blocked by security policy." } }, ctx);
      return;
    }

    const start = Date.now();
    try {
      // Also handle root-level health endpoints for load balancers / k8s probes
      if (path === "/health" || path === "/ready" || path === "/metrics") {
        await handleApi(req, res, `/api${path}`, ctx);
        return;
      }

      // Per-IP rate limiting for API and webhook endpoints (skip localhost in dev/test)
      if (path.startsWith("/api/") || path.startsWith("/webhooks/")) {
        const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.socket.remoteAddress || "unknown";
        const isLocalhost = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
        if (!isLocalhost) {
          const rateLimitKey = `http:${clientIp}`;
          const rateLimit = await checkRateLimit(rateLimitKey, 100, 60_000); // 100 req/min per IP
          if (!rateLimit.allowed) {
            res.setHeader("Retry-After", String(Math.ceil(rateLimit.retryAfter / 1000)));
            json(res, 429, { success: false, error: { message: "Too many requests. Please slow down." } }, ctx);
            return;
          }
        }
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
      if (securityConfig.auditLogging.enabled && (path.startsWith("/api/") || path.startsWith("/webhooks/"))) {
        recordApiAudit(req, res, ctx, path, durationMs);
      }
    }
  });
  activeServer = server;
  server.timeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
  attachWebSocket(server);
  return server;
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
    const validation = validateConfig();
    if (!validation.valid) {
      logger.error("Configuration validation failed", { errors: validation.errors });
      throw new Error(`Invalid configuration:\n${validation.errors.map((e) => "  - " + e).join("\n")}`);
    }

    await checkAndRollback();

    // Load secrets from external vault if configured
    const secretApiKey = await getSecret("LLM_API_KEY");
    if (secretApiKey) appConfig.llm.apiKey = secretApiKey;
    const secretWebToken = await getSecret("WEB_API_TOKEN");
    if (secretWebToken) appConfig.web.apiToken = secretWebToken;

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

    taskScheduler.registerCronTask(
      async () => {
        const retentionDays = securityConfig.auditLogging.retentionDays ?? 30;
        const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
        const dlDeleted = pruneDeadLetters(retentionMs);
        const auditDeleted = pruneApiAuditLogs(retentionMs);
        const securityDeleted = pruneSecurityAuditLogs(retentionMs);
        if (dlDeleted > 0 || auditDeleted > 0 || securityDeleted > 0) {
          logger.info("Pruned old logs", { dlDeleted, auditDeleted, securityDeleted });
        }
      },
      { id: "prune-logs", name: "Prune Old Audit & Dead Letter Logs", cron: "0 3 * * *", enabled: true }
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
      } catch (_e) {
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
              const parsed = safeJsonParse<Record<string, any>>(event.content, "tool result");
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

    if (dbInitPromise) {
      await dbInitPromise;
    }

    // Start evolution auto-execution daemon and feedback loop (v7.1)
    executionDaemon.start();
    registerFeedbackLoop(undefined, { autoRollback: true, autoRepropose: false });
    registerEvolutionObservability();

    // Start autonomous evolution loop (v9.0)
    autonomousEvolutionLoop.start();

    // Register meta-evolution analysis cron (v9.1)
    taskScheduler.registerCronTask(
      async () => {
        runMetaEvolutionAnalysis();
      },
      { id: "meta-evolution", name: "Meta-Evolution Analysis", cron: "0 1 * * *", enabled: true }
    );

    const server = createApp();
    server.listen(PORT, () => {
      clearPendingMarker();
      startDiskMonitor();
      logger.info(`Ouroboros Web server running at http://localhost:${PORT}`, { dist: WEB_DIST });
    });

    process.on("SIGTERM", () => {
      stopDiskMonitor();
      taskScheduler.destroy();
      executionDaemon.stop();
      autonomousEvolutionLoop.stop();
      gracefulShutdown(activeServer, "SIGTERM", 0);
    });
    process.on("SIGINT", () => {
      stopDiskMonitor();
      taskScheduler.destroy();
      executionDaemon.stop();
      autonomousEvolutionLoop.stop();
      gracefulShutdown(activeServer, "SIGINT", 0);
    });
  })();
}
