import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext, readBody, parseBody } from "../shared.ts";
import { z } from "zod";
import {
  getEvolutionHistory,
  getEvolutionMetrics,
  getEvolutionTimeSeries,
  enrichHistoryWithMetadata,
  detectTrends,
} from "../../../skills/evolution-viz/index.ts";
import {
  resolveAndExecute,
} from "../../../skills/evolution-orchestrator/index.ts";
import { evolutionVersionManager } from "../../../skills/evolution-version-manager/index.ts";
import { approvalGenerator } from "../../../skills/approval/index.ts";
import { formatPrometheusMetrics, getEvolutionMetricsSnapshot } from "../../../skills/evolution-observability/index.ts";

const ApproveSchema = z.object({
  approvalId: z.string(),
  versionId: z.string(),
  changedFiles: z.array(z.string()),
  approved: z.boolean(),
});

const RollbackSchema = z.object({
  versionId: z.string(),
});

export async function handleEvolution(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  if (path === "/api/evolution/history" && method === "GET") {
    const commits = getEvolutionHistory(100);
    const enriched = enrichHistoryWithMetadata(commits);
    json(res, 200, { success: true, data: enriched }, ctx);
    return true;
  }

  if (path === "/api/evolution/metrics" && method === "GET") {
    const metrics = getEvolutionMetrics();
    json(res, 200, { success: true, data: metrics }, ctx);
    return true;
  }

  if (path === "/api/evolution/trends" && method === "GET") {
    const trends = detectTrends();
    json(res, 200, { success: true, data: trends }, ctx);
    return true;
  }

  if (path === "/api/evolution/timeseries" && method === "GET") {
    const days = parseInt(new URL(req.url || "/", "http://localhost").searchParams.get("days") || "30", 10);
    const series = getEvolutionTimeSeries(Number.isFinite(days) && days > 0 ? days : 30);
    json(res, 200, { success: true, data: series }, ctx);
    return true;
  }

  if (path === "/api/evolution/approve" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(raw, ApproveSchema);
    if (!body.success) {
      json(res, 400, { success: false, error: { message: body.error } }, ctx);
      return true;
    }
    const result = await resolveAndExecute(
      body.data.approvalId,
      body.data.versionId,
      body.data.changedFiles,
      "dashboard-operator",
      body.data.approved
    );
    json(res, result.success ? 200 : 400, { success: result.success, data: result }, ctx);
    return true;
  }

  if (path === "/api/evolution/rollback" && method === "POST") {
    const raw = await readBody(req);
    const body = parseBody(raw, RollbackSchema);
    if (!body.success) {
      json(res, 400, { success: false, error: { message: body.error } }, ctx);
      return true;
    }
    const target = evolutionVersionManager.getRollbackTarget(body.data.versionId);
    if (!target) {
      json(res, 400, { success: false, error: { message: "No rollback target for this version" } }, ctx);
      return true;
    }
    json(res, 200, { success: true, data: { rollbackVersionId: target.id, rollbackTag: target.versionTag } }, ctx);
    return true;
  }

  if (path === "/api/evolution/approvals" && method === "GET") {
    const approvals = approvalGenerator.listApprovals("pending", 50);
    json(res, 200, { success: true, data: approvals }, ctx);
    return true;
  }

  if (path === "/api/evolution/versions" && method === "GET") {
    const versions = evolutionVersionManager.listVersions(50);
    json(res, 200, { success: true, data: versions }, ctx);
    return true;
  }

  if (path === "/api/evolution/live-metrics" && method === "GET") {
    const metrics = getEvolutionMetricsSnapshot();
    json(res, 200, { success: true, data: metrics }, ctx);
    return true;
  }

  if (path === "/api/evolution/prometheus" && method === "GET") {
    const body = formatPrometheusMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Request-ID": ctx.requestId });
    res.end(body);
    return true;
  }

  return false;
}
