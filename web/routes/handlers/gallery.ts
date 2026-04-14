import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import { homedir } from "os";
import { json, serveStatic, ReqContext } from "../shared.ts";

export async function handleGallery(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Gallery API
  // ================================================================
  if (path === "/api/gallery/screenshots" && method === "GET") {
    try {
      const { readdirSync, statSync } = await import("fs");
      const screenshotsDir = join(homedir(), ".ouroboros", "browser-screenshots");
      if (!existsSync(screenshotsDir)) {
        json(res, 200, { success: true, data: [] }, ctx);
        return true;
      }
      const entries = readdirSync(screenshotsDir)
        .filter((f) => f.endsWith(".png"))
        .map((f) => {
          const stat = statSync(join(screenshotsDir, f));
          return { filename: f, url: `/api/gallery/screenshots/${f}`, createdAt: stat.mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      json(res, 200, { success: true, data: entries }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  if (path.startsWith("/api/gallery/screenshots/") && method === "GET") {
    const filename = path.replace("/api/gallery/screenshots/", "").replace(/[\\/]/g, "");
    if (!filename || !filename.endsWith(".png")) {
      return false;
    }
    const filePath = join(homedir(), ".ouroboros", "browser-screenshots", filename);
    serveStatic(res, filePath, ctx);
    return true;
  }

  return false;
}
