import { describe, it, expect } from "vitest";
import { validateConfig } from "../../core/config.ts";
import type { AppConfig } from "../../core/config.ts";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    llm: {
      provider: "local",
      model: "mock",
      apiKey: undefined,
      baseUrl: undefined,
      temperature: 0.2,
      maxTokens: 4096,
      ...overrides.llm,
    },
    fallbackLlm: {
      provider: undefined,
      model: undefined,
      apiKey: undefined,
      baseUrl: undefined,
      temperature: undefined,
      maxTokens: undefined,
      ...overrides.fallbackLlm,
    },
    database: {
      backend: "sqlite",
      connectionString: "",
      poolSize: 10,
      ssl: false,
      sqlite: {
        path: ".ouroboros/session.db",
        wal: true,
      },
      ...overrides.database,
    },
    db: {
      dir: ".ouroboros",
      usePostgres: false,
      postgresUrl: "",
      slowQueryThresholdMs: 0,
      ...overrides.db,
    },
    skills: {
      dir: "skills",
      ...overrides.skills,
    },
    web: {
      port: 8080,
      apiToken: "",
      allowedOrigins: [],
      ...overrides.web,
    },
    feishu: {
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      webhookPort: 3000,
      webhookPath: "/feishu/webhook",
      autoStart: false,
      ...overrides.feishu,
    },
    log: {
      level: "info",
      format: "pretty",
      ...overrides.log,
    },
    redis: {
      url: "",
      lockTtlMs: 60000,
      ...overrides.redis,
    },
    sentry: {
      dsn: "",
      environment: "development",
      ...overrides.sentry,
    },
    auxiliary: {
      compression: {},
      review: {},
      vision: {},
      summarization: {},
      ...overrides.auxiliary,
    },
    mcp: {
      servers: [],
      ...overrides.mcp,
    },
    otel: {
      enabled: false,
      endpoint: "http://localhost:4318",
      headers: {},
      serviceName: "ouroboros-agent",
      serviceVersion: "0.1.0",
      timeoutMs: 10_000,
      ...overrides.otel,
    },
  } as AppConfig;
}

describe("validateConfig", () => {
  it("passes for minimal valid local config", () => {
    const config = makeConfig();
    const result = validateConfig(config, "development");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  describe("LLM config", () => {
    it("passes when provider is non-local and both apiKey and model are set", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "gpt-4", apiKey: "sk-123", baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails when provider is non-local and apiKey is missing", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "gpt-4", apiKey: undefined, baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("LLM_API_KEY is required and must not be empty when LLM_PROVIDER is not 'local'");
    });

    it("fails when provider is non-local and apiKey is empty string", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "gpt-4", apiKey: "", baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("LLM_API_KEY is required and must not be empty when LLM_PROVIDER is not 'local'");
    });

    it("fails when provider is non-local and model is missing", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "", apiKey: "sk-123", baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("LLM_MODEL is required and must not be empty when LLM_PROVIDER is not 'local'");
    });

    it("fails with both LLM errors when both apiKey and model are missing", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "", apiKey: "", baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain("LLM_API_KEY is required and must not be empty when LLM_PROVIDER is not 'local'");
      expect(result.errors).toContain("LLM_MODEL is required and must not be empty when LLM_PROVIDER is not 'local'");
    });
  });

  describe("Web config", () => {
    it("passes in production when WEB_API_TOKEN is 16+ characters", () => {
      const config = makeConfig({
        web: { port: 8080, apiToken: "a".repeat(16), allowedOrigins: [] },
      });
      const result = validateConfig(config, "production");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails in production when WEB_API_TOKEN is missing", () => {
      const config = makeConfig({
        web: { port: 8080, apiToken: "", allowedOrigins: [] },
      });
      const result = validateConfig(config, "production");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("WEB_API_TOKEN is required in production and must be at least 16 characters long");
    });

    it("fails in production when WEB_API_TOKEN is too short", () => {
      const config = makeConfig({
        web: { port: 8080, apiToken: "short", allowedOrigins: [] },
      });
      const result = validateConfig(config, "production");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("WEB_API_TOKEN is required in production and must be at least 16 characters long");
    });

    it("passes in development even when WEB_API_TOKEN is missing", () => {
      const config = makeConfig({
        web: { port: 8080, apiToken: "", allowedOrigins: [] },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("PostgreSQL config", () => {
    it("passes when USE_POSTGRES is enabled and DATABASE_URL is valid", () => {
      const config = makeConfig({
        db: { dir: ".ouroboros", usePostgres: true, postgresUrl: "postgres://user:pass@localhost/db", slowQueryThresholdMs: 0 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes when USE_POSTGRES is enabled and DATABASE_URL uses postgresql://", () => {
      const config = makeConfig({
        db: { dir: ".ouroboros", usePostgres: true, postgresUrl: "postgresql://user:pass@localhost/db", slowQueryThresholdMs: 0 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails when USE_POSTGRES is enabled but DATABASE_URL is missing", () => {
      const config = makeConfig({
        db: { dir: ".ouroboros", usePostgres: true, postgresUrl: "", slowQueryThresholdMs: 0 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("DATABASE_URL is required when PostgreSQL backend is enabled");
    });

    it("fails when USE_POSTGRES is enabled but DATABASE_URL has invalid prefix", () => {
      const config = makeConfig({
        db: { dir: ".ouroboros", usePostgres: true, postgresUrl: "mysql://localhost/db", slowQueryThresholdMs: 0 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("DATABASE_URL must start with 'postgres://' or 'postgresql://'");
    });

    it("passes when USE_POSTGRES is disabled even if DATABASE_URL is missing", () => {
      const config = makeConfig({
        db: { dir: ".ouroboros", usePostgres: false, postgresUrl: "", slowQueryThresholdMs: 0 },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("Feishu config", () => {
    it("passes when FEISHU_AUTO_START is true and credentials are set", () => {
      const config = makeConfig({
        feishu: { appId: "app-id", appSecret: "secret", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: true },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails when FEISHU_AUTO_START is true but FEISHU_APP_ID is missing", () => {
      const config = makeConfig({
        feishu: { appId: "", appSecret: "secret", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: true },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("FEISHU_APP_ID is required and must not be empty when FEISHU_AUTO_START is enabled");
    });

    it("fails when FEISHU_AUTO_START is true but FEISHU_APP_SECRET is missing", () => {
      const config = makeConfig({
        feishu: { appId: "app-id", appSecret: "", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: true },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("FEISHU_APP_SECRET is required and must not be empty when FEISHU_AUTO_START is enabled");
    });

    it("fails with both Feishu errors when both credentials are missing", () => {
      const config = makeConfig({
        feishu: { appId: "", appSecret: "", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: true },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain("FEISHU_APP_ID is required and must not be empty when FEISHU_AUTO_START is enabled");
      expect(result.errors).toContain("FEISHU_APP_SECRET is required and must not be empty when FEISHU_AUTO_START is enabled");
    });

    it("passes when FEISHU_AUTO_START is false even if credentials are missing", () => {
      const config = makeConfig({
        feishu: { appId: "", appSecret: "", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: false },
      });
      const result = validateConfig(config, "development");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("combined errors", () => {
    it("collects errors from multiple categories", () => {
      const config = makeConfig({
        llm: { provider: "openai", model: "", apiKey: "", baseUrl: undefined, temperature: 0.2, maxTokens: 4096 },
        web: { port: 8080, apiToken: "short", allowedOrigins: [] },
        db: { dir: ".ouroboros", usePostgres: true, postgresUrl: "bad://url", slowQueryThresholdMs: 0 },
        feishu: { appId: "", appSecret: "", verificationToken: "", encryptKey: "", webhookPort: 3000, webhookPath: "/feishu/webhook", autoStart: true },
      });
      const result = validateConfig(config, "production");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(6);
      expect(result.errors).toContain("LLM_API_KEY is required and must not be empty when LLM_PROVIDER is not 'local'");
      expect(result.errors).toContain("LLM_MODEL is required and must not be empty when LLM_PROVIDER is not 'local'");
      expect(result.errors).toContain("WEB_API_TOKEN is required in production and must be at least 16 characters long");
      expect(result.errors).toContain("DATABASE_URL must start with 'postgres://' or 'postgresql://'");
      expect(result.errors).toContain("FEISHU_APP_ID is required and must not be empty when FEISHU_AUTO_START is enabled");
      expect(result.errors).toContain("FEISHU_APP_SECRET is required and must not be empty when FEISHU_AUTO_START is enabled");
    });
  });
});
