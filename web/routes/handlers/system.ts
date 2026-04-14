import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import { listSessions, getMemoryRecalls24h } from "../../../core/session-db.ts";
import { getLLMMetrics } from "../../../core/llm-metrics.ts";
import { getGlobalTokenUsage, getTokenUsageTimeSeries } from "../../../core/repositories/token-usage.ts";
import { getRunnerPoolStats, llmCfg, discoverSkills, getDaemonStatus } from "../../runner-pool.ts";
import { getWsClientCount, getWsConnectionsTotal } from "../../ws-server.ts";
import { feishuPlugin } from "../../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../../extensions/im/mock-chat/index.ts";
import {
  json,
  getHealthStatus,
  getPrometheusMetrics,
  ReqContext,
  DB_PATH,
  taskScheduler,
} from "../shared.ts";

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
    json(res, 200, { status: "ready", db: existsSync(DB_PATH), llmConfigured: !!llmCfg }, ctx);
    return true;
  }
  if (path === "/api/metrics" && method === "GET") {
    const body = getPrometheusMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "X-Request-ID": ctx.requestId });
    res.end(body);
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
    return true;
  }

  return false;
}
