/**
 * Web Routes Shared Module
 * ========================
 * Barrel file for route utilities and singleton services.
 * Previously a 567-line god file — now decomposed into focused lib/*.ts modules.
 */

import "dotenv/config";
import { hookRegistry } from "../../core/hook-system.ts";
import { initSentry } from "../../core/sentry.ts";

import { feishuPlugin } from "../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../../extensions/im/telegram/index.ts";
import { discordPlugin } from "../../extensions/im/discord/index.ts";
import { slackPlugin } from "../../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../../extensions/im/wechatwork/index.ts";
import { getChannelRegistry } from "../../core/channel-registry.ts";

import { createSelfHealer } from "../../skills/self-healing/index.ts";
import { createTaskScheduler } from "../../skills/task-scheduler/index.ts";
import { MultimediaGenerator } from "../../skills/multimedia/index.ts";
import { getI18n, createI18n } from "../../skills/i18n/index.ts";
import { createContextManager } from "../../skills/context-management/index.ts";
import { BrowserController } from "../../skills/browser/index.ts";
import { createSecurityFramework } from "../../core/security-framework.ts";
import { WebhookManager } from "../../skills/webhooks/index.ts";
import { LearningEngine } from "../../skills/learning/engine.ts";

initSentry();

hookRegistry.registerBuiltins();
hookRegistry.discoverAndLoad();

// Shared feature singletons for API routes
const selfHealer = createSelfHealer();
export const taskScheduler = createTaskScheduler();
const mediaGenerator = new MultimediaGenerator();
const i18n = getI18n() || createI18n({ defaultLocale: "en" });
const contextManager = createContextManager();
const apiBrowserController = new BrowserController({ headless: true });
const securityFramework = createSecurityFramework();
export const webhookManager = new WebhookManager();
export const channelRegistry = getChannelRegistry();
const learningEngine = new LearningEngine();

// Register IM channels
channelRegistry.register(feishuPlugin);
channelRegistry.register(mockChatPlugin);
channelRegistry.register(telegramPlugin);
channelRegistry.register(discordPlugin);
channelRegistry.register(slackPlugin);
channelRegistry.register(dingtalkPlugin);
channelRegistry.register(wechatworkPlugin);

// =============================================================================
// Re-exports from decomposed lib modules
// =============================================================================

export { createReqContext, getClientIp, type ReqContext } from "./lib/context.ts";
export { getOrigin, setCorsHeaders, ALLOWED_ORIGINS, isAllowedOrigin } from "./lib/cors.ts";
export {
  readBody,
  readBodyBuffer,
  parseMultipartFile,
  parseMultipartImage,
  parseBody,
  readJsonBody,
  ConfirmBodySchema,
  InstallSkillBodySchema,
  RestoreBackupBodySchema,
  MAX_BODY_SIZE,
} from "./lib/body.ts";
export { getCached, MAX_API_CACHE_SIZE, type CacheEntry } from "./lib/cache.ts";
export { isAuthValid, getApiToken } from "./lib/auth.ts";
export { setSecurityHeaders } from "./lib/security.ts";
export { json, notFound } from "./lib/response.ts";
export { serveStatic, serveIndex, WEB_DIST, MIME } from "./lib/static.ts";
export { exportTrajectories, type ShareGPTConversation, DB_PATH, OUT_DIR, OUT_PATH } from "./lib/export.ts";

export {
  recordRequestMetrics,
  logRequest,
  requestCounter,
  requestDurationHistogram,
  requestDurationBuckets,
  MAX_METRIC_COUNTER_KEYS,
} from "./lib/metrics.ts";

export { getHealthStatus } from "./lib/health.ts";
export { recordApiAudit, pruneApiAuditLogs } from "./lib/audit.ts";

export async function getPrometheusMetrics(): Promise<string> {
  const { getPrometheusMetrics: _getPrometheusMetrics } = await import("./lib/metrics.ts");
  return _getPrometheusMetrics(taskScheduler);
}

// Re-export singletons and internal helpers for backward compatibility
export {
  selfHealer,
  mediaGenerator,
  i18n,
  contextManager,
  apiBrowserController,
  securityFramework,
  learningEngine,
};
