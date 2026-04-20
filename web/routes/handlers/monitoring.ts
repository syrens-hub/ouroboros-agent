import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext } from "../shared.ts";
import { getMonitoringSnapshot } from "../../../skills/monitoring-dashboard/index.ts";
import { buildRuntimeSummary, runAutoCheck, exportPrometheus } from "../../../skills/telemetry-v2/index.ts";

export async function handleMonitoring(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  if (path === "/api/monitoring/status" && method === "GET") {
    const snapshot = getMonitoringSnapshot();
    json(res, 200, { success: true, data: snapshot }, ctx);
    return true;
  }

  if (path === "/api/monitoring/event-bus" && method === "GET") {
    const { getEventBusStatus } = await import("../../../skills/monitoring-dashboard/index.ts");
    json(res, 200, { success: true, data: getEventBusStatus() }, ctx);
    return true;
  }

  if (path === "/api/monitoring/safety" && method === "GET") {
    const { getSafetyStatus } = await import("../../../skills/monitoring-dashboard/index.ts");
    json(res, 200, { success: true, data: getSafetyStatus() }, ctx);
    return true;
  }

  if (path === "/api/monitoring/approvals" && method === "GET") {
    const { getApprovalQueueStatus } = await import("../../../skills/monitoring-dashboard/index.ts");
    json(res, 200, { success: true, data: getApprovalQueueStatus() }, ctx);
    return true;
  }

  if (path === "/api/monitoring/versions" && method === "GET") {
    const { getEvolutionVersionStatus } = await import("../../../skills/monitoring-dashboard/index.ts");
    json(res, 200, { success: true, data: getEvolutionVersionStatus() }, ctx);
    return true;
  }

  if (path === "/api/monitoring/test-runs" && method === "GET") {
    const { getTestRunStatus } = await import("../../../skills/monitoring-dashboard/index.ts");
    json(res, 200, { success: true, data: getTestRunStatus() }, ctx);
    return true;
  }

  // ================================================================
  // Telemetry v2 — Runtime Dashboard
  // ================================================================
  if (path === "/api/admin/runtime" && method === "GET") {
    const summary = buildRuntimeSummary();
    json(res, 200, { success: true, data: summary }, ctx);
    return true;
  }

  if (path === "/api/admin/auto-check" && method === "GET") {
    const report = runAutoCheck("manual");
    json(res, 200, { success: true, data: report }, ctx);
    return true;
  }

  if (path === "/api/admin/metrics" && method === "GET") {
    const metricsText = exportPrometheus();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(metricsText);
    return true;
  }

  return false;
}
