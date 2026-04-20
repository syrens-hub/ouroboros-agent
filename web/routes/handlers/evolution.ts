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
import {
  runEvolutionCycle,
  listProposals,
  getProposal,
  approveProposal,
  rejectProposal,
  snoozeProposal,
  applyProposal,
  getProposalStats,
} from "../../../skills/auto-evolve/index.ts";

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

  // ================================================================
  // Auto-Evolve v1.1 API
  // ================================================================

  if (path === "/api/evolution/auto-check" && method === "POST") {
    const { checkup, proposals } = runEvolutionCycle("manual");
    json(res, 200, { success: true, data: { checkupId: checkup.id, proposalsGenerated: proposals.length, proposals: proposals.map((p) => ({ id: p.id, title: p.title, category: p.category, riskLevel: p.riskLevel, autoApplicable: p.autoApplicable })) } }, ctx);
    return true;
  }

  if (path === "/api/evolution/proposals" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const filter = {
      status: q.searchParams.get("status") as import("../../../skills/auto-evolve/proposal-db.ts").ProposalStatus | undefined,
      category: q.searchParams.get("category") as import("../../../skills/auto-evolve/proposal-db.ts").ProposalCategory | undefined,
      limit: q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50,
    };
    const proposals = listProposals(filter);
    json(res, 200, { success: true, data: proposals }, ctx);
    return true;
  }

  if (path === "/api/evolution/proposals/stats" && method === "GET") {
    const stats = getProposalStats();
    json(res, 200, { success: true, data: stats }, ctx);
    return true;
  }

  const proposalDetailMatch = path.match(/^\/api\/evolution\/proposals\/([^/]+)$/);
  if (proposalDetailMatch && method === "GET") {
    const proposal = getProposal(proposalDetailMatch[1]);
    if (!proposal) {
      json(res, 404, { success: false, error: { message: "Proposal not found" } }, ctx);
      return true;
    }
    json(res, 200, { success: true, data: proposal }, ctx);
    return true;
  }

  if (proposalDetailMatch && method === "POST") {
    const q = new URL(req.url || "", "http://localhost");
    const action = q.searchParams.get("action");
    const id = proposalDetailMatch[1];

    if (action === "approve") {
      const result = approveProposal(id);
      json(res, result.success ? 200 : 400, { success: result.success, data: result.proposal, error: result.error ? { message: result.error } : undefined }, ctx);
      return true;
    }
    if (action === "reject") {
      const result = rejectProposal(id);
      json(res, result.success ? 200 : 400, { success: result.success, data: result.proposal, error: result.error ? { message: result.error } : undefined }, ctx);
      return true;
    }
    if (action === "snooze") {
      const result = snoozeProposal(id);
      json(res, result.success ? 200 : 400, { success: result.success, data: result.proposal, error: result.error ? { message: result.error } : undefined }, ctx);
      return true;
    }
    if (action === "apply") {
      const result = await applyProposal(id);
      json(res, result.success ? 200 : 400, { success: result.success, data: result }, ctx);
      return true;
    }

    json(res, 400, { success: false, error: { message: "Unknown action. Use ?action=approve|reject|snooze|apply" } }, ctx);
    return true;
  }

  return false;
}
