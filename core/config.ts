/**
 * Ouroboros Configuration Center
 * ================================
 * Single source of truth for all environment-driven settings.
 */

import { databaseConfig, redisConfig } from "./config-extension.ts";
import { join } from "path";

// Mutable shared state for backward-compatible db alias getters/setters
const _dbState = {
  backend: databaseConfig.backend,
  connectionString: databaseConfig.connectionString || "",
};

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
  database: {
    get backend(): "sqlite" | "postgres" {
      return _dbState.backend;
    },
    set backend(v: "sqlite" | "postgres") {
      _dbState.backend = v;
    },
    get connectionString(): string {
      return _dbState.connectionString;
    },
    set connectionString(v: string) {
      _dbState.connectionString = v;
    },
    poolSize: databaseConfig.poolSize,
    ssl: databaseConfig.ssl,
    get sqlite() {
      return {
        path: process.env.DATABASE_PATH || join(process.env.OUROBOROS_DB_DIR || ".ouroboros", "session.db"),
        wal: process.env.SQLITE_WAL !== "false",
      };
    },
  },
  db: {
    dir: process.env.OUROBOROS_DB_DIR || ".ouroboros",
    get usePostgres() {
      return _dbState.backend === "postgres";
    },
    set usePostgres(v: boolean) {
      _dbState.backend = v ? "postgres" : "sqlite";
    },
    get postgresUrl() {
      return _dbState.connectionString;
    },
    set postgresUrl(v: string) {
      _dbState.connectionString = v;
    },
    slowQueryThresholdMs: process.env.SLOW_QUERY_THRESHOLD_MS ? parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10) : 500,
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
    autoStart: process.env.FEISHU_AUTO_START === "true" || process.env.FEISHU_AUTO_START === "1",
  },
  log: {
    level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
    format: (process.env.LOG_FORMAT as "json" | "pretty") || "pretty",
  },
  redis: {
    url: redisConfig.url || "",
    lockTtlMs: redisConfig.lockTtlMs,
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || "",
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  },
  auxiliary: {
    compression: {
      provider: process.env.AUXILIARY_COMPRESSION_PROVIDER || undefined,
      model: process.env.AUXILIARY_COMPRESSION_MODEL || undefined,
      apiKey: process.env.AUXILIARY_COMPRESSION_API_KEY || undefined,
      baseUrl: process.env.AUXILIARY_COMPRESSION_BASE_URL || undefined,
    },
    review: {
      provider: process.env.AUXILIARY_REVIEW_PROVIDER || undefined,
      model: process.env.AUXILIARY_REVIEW_MODEL || undefined,
      apiKey: process.env.AUXILIARY_REVIEW_API_KEY || undefined,
      baseUrl: process.env.AUXILIARY_REVIEW_BASE_URL || undefined,
    },
    vision: {
      provider: process.env.AUXILIARY_VISION_PROVIDER || undefined,
      model: process.env.AUXILIARY_VISION_MODEL || undefined,
      apiKey: process.env.AUXILIARY_VISION_API_KEY || undefined,
      baseUrl: process.env.AUXILIARY_VISION_BASE_URL || undefined,
    },
    summarization: {
      provider: process.env.AUXILIARY_SUMMARIZATION_PROVIDER || undefined,
      model: process.env.AUXILIARY_SUMMARIZATION_MODEL || undefined,
      apiKey: process.env.AUXILIARY_SUMMARIZATION_API_KEY || undefined,
      baseUrl: process.env.AUXILIARY_SUMMARIZATION_BASE_URL || undefined,
    },
  },
  mcp: {
    servers: (() => {
      try {
        const raw = process.env.MCP_SERVERS;
        if (raw) return JSON.parse(raw);
      } catch {
        // ignore malformed JSON
      }
      return [];
    })(),
  },
  otel: {
    enabled: process.env.OTEL_ENABLED === "1" || process.env.OTEL_ENABLED === "true",
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    headers: (() => {
      try {
        const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
        if (raw) {
          return Object.fromEntries(raw.split(",").map((pair) => {
            const [k, ...rest] = pair.trim().split("=");
            return [k, rest.join("=")];
          }));
        }
      } catch {
        // ignore malformed headers
      }
      return {} as Record<string, string>;
    })(),
    serviceName: process.env.OTEL_SERVICE_NAME || "ouroboros-agent",
    serviceVersion: process.env.OTEL_SERVICE_VERSION || "0.1.0",
    timeoutMs: process.env.OTEL_EXPORTER_OTLP_TIMEOUT ? parseInt(process.env.OTEL_EXPORTER_OTLP_TIMEOUT, 10) : 10_000,
  },
  cleanup: {
    maxDbBackups: parseInt(process.env.OUROBOROS_MAX_DB_BACKUPS || "10", 10),
    maxEvolutionBackups: parseInt(process.env.OUROBOROS_MAX_EVOLUTION_BACKUPS || "50", 10),
    maxCheckpoints: parseInt(process.env.OUROBOROS_MAX_CHECKPOINTS || "30", 10),
    retentionDays: parseInt(process.env.OUROBOROS_RETENTION_DAYS || "30", 10),
  },
};

export type AppConfig = typeof appConfig;

export function validateConfig(
  config: AppConfig = appConfig,
  nodeEnv: string = process.env.NODE_ENV || "development",
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. LLM config (when provider is not local)
  if (config.llm.provider !== "local") {
    if (!config.llm.apiKey || config.llm.apiKey.trim() === "") {
      errors.push("LLM_API_KEY is required and must not be empty when LLM_PROVIDER is not 'local'");
    }
    if (!config.llm.model || config.llm.model.trim() === "") {
      errors.push("LLM_MODEL is required and must not be empty when LLM_PROVIDER is not 'local'");
    }
  }

  // 2. Web config (production only)
  if (nodeEnv === "production") {
    if (!config.web.apiToken || config.web.apiToken.length < 16) {
      errors.push("WEB_API_TOKEN is required in production and must be at least 16 characters long");
    }
    if (config.database.backend === "sqlite") {
      errors.push("SQLite is not recommended for production. Set DATABASE_BACKEND=postgres and configure DATABASE_URL.");
    }
  }

  // 3. PostgreSQL config
  if (config.database.backend === "postgres" || config.db.usePostgres) {
    const pgUrl = config.database.connectionString || config.db.postgresUrl;
    if (!pgUrl) {
      errors.push("DATABASE_URL is required when PostgreSQL backend is enabled");
    } else if (
      !pgUrl.startsWith("postgres://") &&
      !pgUrl.startsWith("postgresql://")
    ) {
      errors.push("DATABASE_URL must start with 'postgres://' or 'postgresql://'");
    }
  }

  // 4. Feishu config (when auto-start is enabled)
  if (config.feishu.autoStart) {
    if (!config.feishu.appId || config.feishu.appId.trim() === "") {
      errors.push("FEISHU_APP_ID is required and must not be empty when FEISHU_AUTO_START is enabled");
    }
    if (!config.feishu.appSecret || config.feishu.appSecret.trim() === "") {
      errors.push("FEISHU_APP_SECRET is required and must not be empty when FEISHU_AUTO_START is enabled");
    }
  }

  return { valid: errors.length === 0, errors };
}
