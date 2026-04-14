import type { IncomingMessage, ServerResponse } from "http";
import { getDaemonStatus, getDaemonHistory, startDaemon, stopDaemon } from "../../runner-pool.ts";
import { json, ReqContext } from "../shared.ts";

export async function handleDaemon(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Daemon control
  if (path === "/api/daemon/status" && method === "GET") {
    json(res, 200, { success: true, data: getDaemonStatus() }, ctx);
    return true;
  }
  if (path === "/api/daemon/history" && method === "GET") {
    json(res, 200, { success: true, data: getDaemonHistory() }, ctx);
    return true;
  }
  if (path === "/api/daemon/start" && method === "POST") {
    const ok = startDaemon();
    json(res, 200, { success: ok, data: { running: getDaemonStatus().running } }, ctx);
    return true;
  }
  if (path === "/api/daemon/stop" && method === "POST") {
    const ok = stopDaemon();
    json(res, 200, { success: ok, data: { running: getDaemonStatus().running } }, ctx);
    return true;
  }

  return false;
}
