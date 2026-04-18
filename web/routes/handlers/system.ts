import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import { listSessions, getMemoryRecalls24h } from "../../../core/session-db.ts";
import { getLLMMetrics } from "../../../core/llm-metrics.ts";
import { getGlobalTokenUsage, getTokenUsageTimeSeries } from "../../../core/repositories/token-usage.ts";
import { getRunnerPoolStats, llmCfg, discoverSkills, getDaemonStatus } from "../../runner-pool.ts";
import { getSkillDiscoveryStats } from "../../../skills/learning/index.ts";
import { getCircuitBreakerStates } from "../../../core/llm-resilience.ts";
import { getWsClientCount, getWsConnectionsTotal } from "../../ws-server.ts";
import { feishuPlugin } from "../../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../../extensions/im/mock-chat/index.ts";
import { getDb } from "../../../core/db-manager.ts";
import { migrations } from "../../../core/migrations/index.ts";
import { getBudgetStatus } from "../../../skills/budget-guard/index.ts";
import {
  json,
  getHealthStatus,
  getPrometheusMetrics,
  ReqContext,
  taskScheduler,
} from "../shared.ts";
import { getOtelStatus } from "../../../skills/telemetry/otel.ts";

export async function handleSystem(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Health / Ready / Metrics (also under /api for consistency, but commonly at root)
  if (path === "/api/health" && method === "GET") {
    const health = await getHealthStatus();
    json(res, health.healthy ? 200 : 503, health, ctx);
    return true;
  }
  if (path === "/api/ready" && method === "GET") {
    const readyChecks: Record<string, { ok: boolean; detail?: string }> = {};
    let ready = true;

    // Real DB query check
    try {
      getDb().prepare("SELECT 1").get();
      readyChecks.db = { ok: true };
    } catch (e) {
      readyChecks.db = { ok: false, detail: String(e) };
      ready = false;
    }

    // Migration completeness check
    try {
      const db = getDb();
      const row = db.prepare("SELECT COUNT(*) as count FROM umzug_migrations").get() as { count: number } | undefined;
      const expected = migrations.length;
      const actual = row?.count ?? 0;
      if (actual === expected) {
        readyChecks.migrations = { ok: true, detail: `${actual}/${expected}` };
      } else {
        readyChecks.migrations = { ok: false, detail: `${actual}/${expected} migrations applied` };
        ready = false;
      }
    } catch (e) {
      readyChecks.migrations = { ok: false, detail: String(e) };
      ready = false;
    }

    readyChecks.llm = { ok: !!llmCfg, detail: llmCfg ? `${llmCfg.provider}:${llmCfg.model}` : "not configured" };

    json(res, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", checks: readyChecks }, ctx);
    return true;
  }
  if (path === "/api/metrics" && method === "GET") {
    const body = await getPrometheusMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "X-Request-ID": ctx.requestId });
    res.end(body);
    return true;
  }

  // System health with MCP included
  if (path === "/api/system/health" && method === "GET") {
    const health = await getHealthStatus();
    json(res, health.healthy ? 200 : 503, health, ctx);
    return true;
  }

  // OpenTelemetry trace exporter status
  if (path === "/api/traces/status" && method === "GET") {
    json(res, 200, { success: true, data: getOtelStatus() }, ctx);
    return true;
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
    return true;
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
    return true;
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
    const discoveryStats = getSkillDiscoveryStats();
    const data = {
      llmProvider: llmCfg?.provider || "local",
      llmModel: llmCfg?.model || "mock",
      sessionCount: sessions.length,
      skillCount: skills.length,
      lastSkillScanAt: discoveryStats.lastScanAt || null,
      daemonRunning: getDaemonStatus().running,
      imPlugins,
      memoryRecalls24h: memoryRecallsRes.success ? memoryRecallsRes.data : 0,
      deepDreamingLastRun,
    };
    json(res, 200, { success: true, data }, ctx);
    return true;
  }

  if (path === "/api/system/circuit-breakers" && method === "GET") {
    json(res, 200, { success: true, data: getCircuitBreakerStates() }, ctx);
    return true;
  }

  if (path === "/api/budget" && method === "GET") {
    json(res, 200, { success: true, data: getBudgetStatus() }, ctx);
    return true;
  }

  return false;
}
