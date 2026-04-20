import type { IncomingMessage, ServerResponse } from "http";
import { checkRateLimit } from "../../skills/rate-limiter/index.ts";
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

import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./constants.ts";
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
import { handleUpload } from "./handlers/upload.ts";
import { handleBrowser } from "./handlers/browser.ts";
import { handleCanvas } from "./handlers/canvas.ts";
import { handleChannels } from "./handlers/channels.ts";
import { handleDreaming } from "./handlers/dreaming.ts";
import { handleCrewAI } from "./handlers/crewai.ts";
import { handleLearning } from "./handlers/learning.ts";
import { handleSecurity } from "./handlers/security.ts";
import { handleSOP } from "./handlers/sop.ts";
import { handleWebhooks } from "./handlers/webhooks.ts";
import { handleMisc } from "./handlers/misc.ts";
import { handleOpenApi } from "./handlers/openapi.ts";
import { handleEvolution } from "./handlers/evolution.ts";
import { handleMonitoring } from "./handlers/monitoring.ts";
import { handleBridges } from "./handlers/bridges.ts";
import { handleResilience } from "./handlers/resilience.ts";
import { handlePermissions } from "./handlers/permissions.ts";
import { handleAgencyAgents } from "./handlers/agency-agents.ts";

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

  // CORS block for actual requests (skip health/readiness/metrics probes)
  const isProbePath = path === "/api/health" || path === "/api/ready" || path === "/api/metrics";
  if (!isProbePath && ALLOWED_ORIGINS.length > 0 && !isAllowedOrigin(origin)) {
    json(res, 403, { success: false, error: { message: "CORS origin not allowed" } }, ctx);
    return;
  }

  // Rate limit (skip for localhost in dev/test)
  const clientIp = getClientIp(req);
  const isLocalhost = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    const rate = await checkRateLimit(`api:${clientIp}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
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
  if (await handleUpload(req, res, method, path, ctx)) return;
  if (await handleBrowser(req, res, method, path, ctx)) return;
  if (await handleCanvas(req, res, method, path, ctx)) return;
  if (await handleChannels(req, res, method, path, ctx)) return;
  if (await handleDreaming(req, res, method, path, ctx)) return;
  if (await handleCrewAI(req, res, method, path, ctx)) return;
  if (await handleLearning(req, res, method, path, ctx)) return;
  if (await handleSecurity(req, res, method, path, ctx)) return;
  if (await handleSOP(req, res, method, path, ctx)) return;
  if (await handleWebhooks(req, res, method, path, ctx)) return;
  if (await handleOpenApi(req, res, method, path, ctx)) return;
  if (await handleEvolution(req, res, method, path, ctx)) return;
  if (await handleMonitoring(req, res, method, path, ctx)) return;
  if (await handleBridges(req, res, method, path, ctx)) return;
  if (await handleResilience(req, res, method, path, ctx)) return;
  if (await handlePermissions(req, res, method, path, ctx)) return;
  if (await handleAgencyAgents(req, res, method, path, ctx)) return;
  if (await handleMisc(req, res, method, path, ctx)) return;

  notFound(res, ctx);
}
