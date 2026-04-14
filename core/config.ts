/**
 * Ouroboros Configuration Center
 * ================================
 * Single source of truth for all environment-driven settings.
 */

export const appConfig = {
  llm: {
    provider: (process.env.LLM_PROVIDER as "openai" | "anthropic" | "local" | "minimax" | "qwen" | "gemini") || "local",
    model: process.env.LLM_MODEL || "mock",
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL,
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.2"),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),
  },
  fallbackLlm: {
    provider: (process.env.FALLBACK_LLM_PROVIDER as "openai" | "anthropic" | "local" | "minimax" | "qwen" | "gemini" | undefined) || undefined,
    model: process.env.FALLBACK_LLM_MODEL || undefined,
    apiKey: process.env.FALLBACK_LLM_API_KEY || undefined,
    baseUrl: process.env.FALLBACK_LLM_BASE_URL || undefined,
    temperature: process.env.FALLBACK_LLM_TEMPERATURE ? parseFloat(process.env.FALLBACK_LLM_TEMPERATURE) : undefined,
    maxTokens: process.env.FALLBACK_LLM_MAX_TOKENS ? parseInt(process.env.FALLBACK_LLM_MAX_TOKENS, 10) : undefined,
  },
  db: {
    dir: process.env.OUROBOROS_DB_DIR || ".ouroboros",
    usePostgres: process.env.USE_POSTGRES === "1" || process.env.USE_POSTGRES === "true",
    postgresUrl: process.env.DATABASE_URL || "",
    slowQueryThresholdMs: process.env.SLOW_QUERY_THRESHOLD_MS ? parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10) : 0,
  },
  skills: {
    dir: process.env.OUROBOROS_SKILL_DIR || "skills",
  },
  web: {
    port: parseInt(process.env.OUROBOROS_WEB_PORT || "8080", 10),
    apiToken: process.env.WEB_API_TOKEN || "",
    allowedOrigins: (process.env.WEB_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || "",
    appSecret: process.env.FEISHU_APP_SECRET || "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || "",
    webhookPort: parseInt(process.env.FEISHU_WEBHOOK_PORT || "3000", 10),
    webhookPath: process.env.FEISHU_WEBHOOK_PATH || "/feishu/webhook",
    autoStart: process.env.FEISHU_AUTO_START !== "false" && process.env.FEISHU_AUTO_START !== "0",
  },
  log: {
    level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
    format: (process.env.LOG_FORMAT as "json" | "pretty") || "pretty",
  },
  redis: {
    url: process.env.REDIS_URL || "",
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || "",
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  },
};

export type AppConfig = typeof appConfig;
