import { describe, it, expect, vi, beforeEach } from "vitest";

describe("timedQuery", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("short-circuits when threshold <= 0", async () => {
    vi.doMock("../../../core/config.ts", () => ({
      appConfig: { db: { slowQueryThresholdMs: 0 }, log: { level: "info", format: "text" } },
    }));
    vi.doMock("../../../core/logger.ts", () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));
    const { timedQuery } = await import("../../../skills/telemetry/index.ts");
    const fn = vi.fn().mockResolvedValue("result");
    const result = await timedQuery("test", fn);
    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("logs slow query when duration exceeds threshold", async () => {
    vi.doMock("../../../core/config.ts", () => ({
      appConfig: { db: { slowQueryThresholdMs: 1 }, log: { level: "info", format: "text" } },
    }));
    vi.doMock("../../../core/logger.ts", () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));
    const { timedQuery } = await import("../../../skills/telemetry/index.ts");
    const { logger } = await import("../../../core/logger.ts");
    const fn = async () => {
      await new Promise((r) => setTimeout(r, 15));
      return "result";
    };
    const result = await timedQuery("slow", fn);
    expect(result).toBe("result");
    expect(logger.warn).toHaveBeenCalled();
  });
});
