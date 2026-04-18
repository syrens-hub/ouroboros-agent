import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext } from "../shared.ts";
import { getMonitoringSnapshot } from "../../../skills/monitoring-dashboard/index.ts";

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

  return false;
}
