import { existsSync, readFileSync } from "fs";
import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import type { IncomingMessage, ServerResponse } from "http";
import { createBackup, listBackups, restoreBackup } from "../../../skills/backup/index.ts";
import { gracefulShutdown } from "../../shutdown.ts";
import {
  json,
  readBody,
  parseBody,
  RestoreBackupBodySchema,
  ReqContext,
  OUT_PATH,
  exportTrajectories,
} from "../shared.ts";

export async function handleBackup(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Backup export (trajectories JSONL)
  if (path === "/api/backup/export" && method === "POST") {
    try {
      const result = await exportTrajectories();
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  if (path === "/api/backup/download" && method === "GET") {
    if (!existsSync(OUT_PATH)) {
      json(res, 404, { success: false, error: { message: "No backup file found" } }, ctx);
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="trajectories.jsonl"`,
      "X-Request-ID": ctx.requestId,
    });
    res.end(readFileSync(OUT_PATH));
    return true;
  }

  // Database backup management
  if (path === "/api/backup/db/list" && method === "GET") {
    const backups = listBackups();
    json(res, 200, { success: true, data: backups }, ctx);
    return true;
  }
  if (path === "/api/backup/db/create" && method === "POST") {
    const result = await createBackup();
    json(res, result.success ? 200 : 500, { success: result.success, data: result.success ? { filename: result.filename, path: result.path } : undefined, error: result.error ? { message: result.error } : undefined }, ctx);
    return true;
  }
  if (path === "/api/backup/db/restore" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, RestoreBackupBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const result = restoreBackup(parsed.data.filename);
    json(res, result.success ? 200 : 500, { success: result.success, error: result.error ? { message: result.error } : undefined }, ctx);
    if (result.success) {
      // Close server and exit so the orchestrator restarts with the restored database
      setTimeout(() => gracefulShutdown(null, "RESTORE", 0), 500);
    }
    return true;
  }

  return false;
}
