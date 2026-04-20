import { describe, it, expect } from "vitest";
import { getRedis, getRedisPub, getRedisSub, closeRedis } from "../../core/redis.ts";

describe("redis", () => {
  it("returns null when redis is not configured", () => {
    expect(getRedis()).toBeNull();
    expect(getRedisPub()).toBeNull();
    expect(getRedisSub()).toBeNull();
  });

  it("closeRedis does not throw when no client", async () => {
    await expect(closeRedis()).resolves.toBeUndefined();
  });
});
