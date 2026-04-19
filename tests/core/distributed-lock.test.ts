import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RedisDistributedLock,
  InMemoryDistributedLock,
  createDistributedLock,
  resetDistributedLock,
} from "../../core/distributed-lock.ts";

// ─── Mock ioredis ───────────────────────────────────────────────────────────

const redisMock = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue("OK"),
  eval: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue("OK"),
}));

vi.mock("ioredis", () => ({
  default: vi.fn(() => redisMock),
  Redis: vi.fn(() => redisMock),
}));

vi.mock("../../core/redis.ts", () => ({
  getRedis: vi.fn(() => null),
}));

vi.mock("../../core/config.ts", () => ({
  appConfig: {
    redis: {
      url: "",
      lockTtlMs: 60000,
    },
    log: {
      level: "info",
      format: "pretty",
    },
  },
}));

// ─── InMemoryDistributedLock Tests ──────────────────────────────────────────

describe("InMemoryDistributedLock", () => {
  let lock: InMemoryDistributedLock;

  beforeEach(() => {
    lock = new InMemoryDistributedLock();
  });

  it("acquires and releases a lock", async () => {
    const token = await lock.acquire("test:lock", 1000);
    expect(token).not.toBeNull();
    expect(token?.key).toBe("test:lock");
    expect(token?.value).toBeTruthy();

    const released = await lock.release(token!);
    expect(released).toBe(true);
  });

  it("extends a lock", async () => {
    const token = await lock.acquire("test:lock", 1000);
    expect(token).not.toBeNull();

    const extended = await lock.extend(token!, 2000);
    expect(extended).toBe(true);
  });

  it("prevents concurrent acquire (only one succeeds)", async () => {
    const results = await Promise.all([
      lock.acquire("concurrent:lock", 5000),
      lock.acquire("concurrent:lock", 5000),
      lock.acquire("concurrent:lock", 5000),
    ]);

    const acquired = results.filter((r) => r !== null);
    expect(acquired).toHaveLength(1);
  });

  it("allows re-acquire after release", async () => {
    const token1 = await lock.acquire("reacquire:lock", 5000);
    expect(token1).not.toBeNull();

    await lock.release(token1!);

    const token2 = await lock.acquire("reacquire:lock", 5000);
    expect(token2).not.toBeNull();
    expect(token2?.value).not.toBe(token1?.value);
  });

  it("allows re-acquire after expiration", async () => {
    vi.useFakeTimers();
    const token1 = await lock.acquire("expire:lock", 1000);
    expect(token1).not.toBeNull();

    vi.advanceTimersByTime(1500);

    const token2 = await lock.acquire("expire:lock", 5000);
    expect(token2).not.toBeNull();

    vi.useRealTimers();
  });

  it("fails to release with wrong token", async () => {
    const token = await lock.acquire("wrong:lock", 5000);
    expect(token).not.toBeNull();

    const released = await lock.release({ key: "wrong:lock", value: "bogus", acquiredAt: Date.now() });
    expect(released).toBe(false);

    // Original token should still work
    const released2 = await lock.release(token!);
    expect(released2).toBe(true);
  });

  it("fails to extend with wrong token", async () => {
    const token = await lock.acquire("extend:wrong", 5000);
    expect(token).not.toBeNull();

    const extended = await lock.extend({ key: "extend:wrong", value: "bogus", acquiredAt: Date.now() }, 10000);
    expect(extended).toBe(false);
  });
});

// ─── RedisDistributedLock Tests ─────────────────────────────────────────────

describe("RedisDistributedLock", () => {
  let lock: RedisDistributedLock;

  beforeEach(async () => {
    vi.clearAllMocks();
    redisMock.set.mockResolvedValue("OK");
    redisMock.eval.mockResolvedValue(1);
    const { Redis } = await import("ioredis");
    lock = new RedisDistributedLock(new Redis("redis://localhost"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acquires lock via SET NX PX", async () => {
    redisMock.set.mockResolvedValue("OK");
    const token = await lock.acquire("redis:lock", 30000);
    expect(token).not.toBeNull();
    expect(redisMock.set).toHaveBeenCalledWith("redis:lock", expect.any(String), "PX", 30000, "NX");
  });

  it("returns null when lock is already held", async () => {
    redisMock.set.mockResolvedValue(null);
    const token = await lock.acquire("redis:lock", 30000);
    expect(token).toBeNull();
  });

  it("releases lock via Lua script", async () => {
    redisMock.eval.mockResolvedValue(1);
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const released = await lock.release(token);
    expect(released).toBe(true);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "redis:lock",
      "abc-123"
    );
  });

  it("returns false when releasing non-owned lock", async () => {
    redisMock.eval.mockResolvedValue(0);
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const released = await lock.release(token);
    expect(released).toBe(false);
  });

  it("extends lock via Lua script", async () => {
    redisMock.eval.mockResolvedValue(1);
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const extended = await lock.extend(token, 60000);
    expect(extended).toBe(true);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("pexpire"),
      1,
      "redis:lock",
      "abc-123",
      "60000"
    );
  });

  it("returns false when extending non-owned lock", async () => {
    redisMock.eval.mockResolvedValue(0);
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const extended = await lock.extend(token, 60000);
    expect(extended).toBe(false);
  });

  it("fails closed on Redis error during acquire", async () => {
    redisMock.set.mockRejectedValue(new Error("Redis connection lost"));
    const token = await lock.acquire("redis:lock", 30000);
    expect(token).toBeNull();
  });

  it("fails closed on Redis error during release", async () => {
    redisMock.eval.mockRejectedValue(new Error("Redis connection lost"));
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const released = await lock.release(token);
    expect(released).toBe(false);
  });

  it("fails closed on Redis error during extend", async () => {
    redisMock.eval.mockRejectedValue(new Error("Redis connection lost"));
    const token = { key: "redis:lock", value: "abc-123", acquiredAt: Date.now() };
    const extended = await lock.extend(token, 60000);
    expect(extended).toBe(false);
  });
});

// ─── Factory / Singleton Tests ──────────────────────────────────────────────

describe("createDistributedLock", () => {
  beforeEach(() => {
    resetDistributedLock();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns InMemoryDistributedLock when Redis is not configured", async () => {
    const { getRedis } = await import("../../core/redis.ts");
    vi.mocked(getRedis).mockReturnValue(null);

    const lock = createDistributedLock();
    expect(lock).toBeInstanceOf(InMemoryDistributedLock);
  });

  it("returns RedisDistributedLock when Redis is configured", async () => {
    const mockRedis = { set: vi.fn(), eval: vi.fn() } as unknown as import("ioredis").Redis;
    const { getRedis } = await import("../../core/redis.ts");
    vi.mocked(getRedis).mockReturnValue(mockRedis);

    const lock = createDistributedLock();
    expect(lock).toBeInstanceOf(RedisDistributedLock);
  });
});
