import type { IncomingMessage, ServerResponse } from "http";
import { checkRateLimit } from "../../core/rate-limiter.ts";
import {
  ALLOWED_ORIGINS,
  json,
  getOrigin,
  setCorsHeaders,
  getClientIp,
  isAllowedOrigin,
  isAuthValid,
  notFound,
  ReqContext,
} from "./shared.ts";

import { handleSystem } from "./handlers/system.ts";
import { handleSessions } from "./handlers/sessions.ts";
import { handleSkills } from "./handlers/skills.ts";
import { handleLLM } from "./handlers/llm.ts";
import { handleMemory } from "./handlers/memory.ts";
import { handleBackup } from "./handlers/backup.ts";
import { handleIM } from "./handlers/im.ts";
import { handleDaemon } from "./handlers/daemon.ts";
import { handleSelfHealing } from "./handlers/selfHealing.ts";
import { handleTasks } from "./handlers/tasks.ts";
import { handlePersonality } from "./handlers/personality.ts";
import { handleContext } from "./handlers/context.ts";
import { handleKB } from "./handlers/kb.ts";
import { handleGallery } from "./handlers/gallery.ts";
import { handleExport } from "./handlers/export.ts";
import { handleMisc } from "./handlers/misc.ts";

export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: ReqContext) {
  const method = req.method || "GET";
  const origin = getOrigin(req);
  setCorsHeaders(res, origin);

  // Preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "X-Request-ID": ctx.requestId });
    res.end();
    return;
  }

  // CORS block for actual requests
  if (ALLOWED_ORIGINS.length > 0 && !isAllowedOrigin(origin)) {
    json(res, 403, { success: false, error: { message: "CORS origin not allowed" } }, ctx);
    return;
  }

  // Rate limit (skip for localhost in dev/test)
  const clientIp = getClientIp(req);
  const isLocalhost = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    const rate = await checkRateLimit(`api:${clientIp}`, 60, 60_000);
    res.setHeader("X-RateLimit-Limit", String(60));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      json(res, 429, { success: false, error: { message: "Too many requests", retryAfter: rate.retryAfter } }, ctx);
      return;
    }
  }

  // Auth for API endpoints
  if (!isAuthValid(req, path)) {
    json(res, 401, { success: false, error: { message: "Unauthorized" } }, ctx);
    return;
  }

  if (await handleSystem(req, res, method, path, ctx)) return;
  if (await handleSessions(req, res, method, path, ctx)) return;
  if (await handleSkills(req, res, method, path, ctx)) return;
  if (await handleLLM(req, res, method, path, ctx)) return;
  if (await handleMemory(req, res, method, path, ctx)) return;
  if (await handleBackup(req, res, method, path, ctx)) return;
  if (await handleIM(req, res, method, path, ctx)) return;
  if (await handleDaemon(req, res, method, path, ctx)) return;
  if (await handleSelfHealing(req, res, method, path, ctx)) return;
  if (await handleTasks(req, res, method, path, ctx)) return;
  if (await handlePersonality(req, res, method, path, ctx)) return;
  if (await handleContext(req, res, method, path, ctx)) return;
  if (await handleKB(req, res, method, path, ctx)) return;
  if (await handleGallery(req, res, method, path, ctx)) return;
  if (await handleExport(req, res, method, path, ctx)) return;
  if (await handleMisc(req, res, method, path, ctx)) return;

  notFound(res, ctx);
}
