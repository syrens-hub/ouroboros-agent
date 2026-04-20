import { describe, it, expect, vi, afterAll } from "vitest";
import { checkRateLimit, stopRateLimiterCleanup } from "../../../skills/rate-limiter/index.ts";

vi.mock("../../../core/redis.ts", () => {
  const exec = vi.fn().mockResolvedValue([
    [null, 1],
    [null, 0],
    [null, 1],
    [null, 1],
  ]);
  const pipeline = vi.fn().mockReturnValue({
    zremrangebyscore: vi.fn(),
    zcard: vi.fn(),
    zadd: vi.fn(),
    pexpire: vi.fn(),
    exec,
  });
  return {
    getRedis: vi.fn().mockReturnValue({
      pipeline,
      pttl: vi.fn().mockResolvedValue(5000),
    }),
    __testRedisMocks: { exec, pipeline },
  };
});

describe("rate-limiter", () => {
  afterAll(() => {
    stopRateLimiterCleanup();
  });

  it("allows first request via redis path", async () => {
    const result = await checkRateLimit("key1", 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks when limit exceeded via redis", async () => {
    const { __testRedisMocks } = await import("../../../core/redis.ts") as any;
    __testRedisMocks.exec.mockResolvedValue([
      [null, 1],
      [null, 5],
      [null, 1],
      [null, 1],
    ]);
    const result = await checkRateLimit("key1", 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
