import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext } from "../shared.ts";
import {
  getHealthSnapshot,
  getOverallHealth,
  runSelfDiagnosis,
  getActiveDegradations,
  getRecentHealthEvents,
  getRecentDegradationEvents,
  pruneResilienceLogs,
  clearDegradation,
} from "../../../core/resilience-v2.ts";

export async function handleResilience(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // GET /api/resilience/health — component health snapshots
  if (path === "/api/resilience/health" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const component = q.searchParams.get("component") || undefined;
    const name = q.searchParams.get("name") || undefined;
    try {
      const snapshots = getHealthSnapshot(component as Parameters<typeof getHealthSnapshot>[0], name);
      json(res, 200, { success: true, data: { overall: getOverallHealth(), components: snapshots } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/resilience/diagnose — run self-diagnosis
  if (path === "/api/resilience/diagnose" && method === "GET") {
    try {
      const report = runSelfDiagnosis();
      json(res, 200, { success: true, data: report }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/resilience/degradations — active degradations
  if (path === "/api/resilience/degradations" && method === "GET") {
    try {
      const degradations = getActiveDegradations();
      json(res, 200, { success: true, data: degradations }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // DELETE /api/resilience/degradations/:component/:name — clear degradation
  const degradeClearMatch = path.match(/^\/api\/resilience\/degradations\/([^/]+)\/(.+)$/);
  if (degradeClearMatch && method === "DELETE") {
    try {
      const component = degradeClearMatch[1];
      const name = decodeURIComponent(degradeClearMatch[2]);
      clearDegradation(component as Parameters<typeof clearDegradation>[0], name);
      json(res, 200, { success: true, data: { cleared: true, component, name } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/resilience/events/health — recent health events
  if (path === "/api/resilience/events/health" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const component = q.searchParams.get("component") || undefined;
    const name = q.searchParams.get("name") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const events = getRecentHealthEvents(
        component as Parameters<typeof getRecentHealthEvents>[0],
        name,
        Number.isFinite(limit) && limit > 0 ? limit : 50
      );
      json(res, 200, { success: true, data: events }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/resilience/events/degradation — recent degradation events
  if (path === "/api/resilience/events/degradation" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const events = getRecentDegradationEvents(Number.isFinite(limit) && limit > 0 ? limit : 50);
      json(res, 200, { success: true, data: events }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/resilience/prune — prune old logs
  if (path === "/api/resilience/prune" && method === "POST") {
    const q = new URL(req.url || "", "http://localhost");
    const olderThanHours = q.searchParams.has("hours") ? parseInt(q.searchParams.get("hours")!, 10) : 168;
    const olderThanMs = (Number.isFinite(olderThanHours) && olderThanHours > 0 ? olderThanHours : 168) * 60 * 60 * 1000;
    try {
      const result = pruneResilienceLogs(olderThanMs);
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
