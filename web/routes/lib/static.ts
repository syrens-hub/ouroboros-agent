/**
 * Static File Serving
 * ===================
 */

import type { ServerResponse } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { appConfig } from "../../../core/config.ts";
import type { ReqContext } from "./context.ts";
import { notFound } from "./response.ts";
import { getApiToken } from "./auth.ts";

export const WEB_DIST = join(process.cwd(), "web", "dist");

export const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function serveStatic(res: ServerResponse, filePath: string, ctx: ReqContext) {
  if (!existsSync(filePath)) {
    notFound(res, ctx);
    return;
  }
  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    notFound(res, ctx);
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "X-Request-ID": ctx.requestId,
  });
  res.end(readFileSync(filePath));
}

export function serveIndex(res: ServerResponse, ctx: ReqContext) {
  const indexPath = join(WEB_DIST, "index.html");
  if (!existsSync(indexPath)) {
    res.writeHead(503, { "Content-Type": "text/plain", "X-Request-ID": ctx.requestId });
    res.end("Web UI not built. Run 'npm run web:build' first.");
    return;
  }
  let html = readFileSync(indexPath, "utf-8");
  const injects: string[] = [];
  const token = getApiToken();
  if (token) {
    injects.push(`<script>window.__OUROBOROS_API_TOKEN__=${JSON.stringify(token)}</script>`);
  }
  if (appConfig.sentry.dsn) {
    injects.push(`<script>window.__SENTRY_DSN__=${JSON.stringify(appConfig.sentry.dsn)};window.__SENTRY_ENV__=${JSON.stringify(appConfig.sentry.environment)}</script>`);
  }
  if (injects.length > 0) {
    html = html.replace("<head>", `<head>\n${injects.join("\n")}`);
  }
  res.writeHead(200, { "Content-Type": "text/html", "X-Request-ID": ctx.requestId });
  res.end(html);
}
