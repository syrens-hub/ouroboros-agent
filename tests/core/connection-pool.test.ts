import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionPool } from "../../core/connection-pool.ts";

describe("ConnectionPool", () => {
  let factory: () => Promise<{ id: number }>;
  let closer: (conn: { id: number }) => Promise<void>;
  let pool: ConnectionPool<{ id: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    let counter = 0;
    factory = vi.fn(async () => ({ id: ++counter }));
    closer = vi.fn(async () => {});
  });

  afterEach(async () => {
    if (pool) {
      await pool.drain().catch(() => {});
    }
    vi.useRealTimers();
  });

  it("acquire/release basic flow", async () => {
    pool = new ConnectionPool(factory, closer, { maxConnections: 2 });
    const onAcquire = vi.fn();
    const onCreate = vi.fn();
    const onRelease = vi.fn();
    pool.on("acquire", onAcquire).on("create", onCreate).on("release", onRelease);

    const conn = await pool.acquire();
    expect(conn).toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(conn);
    expect(onAcquire).toHaveBeenCalledWith(conn);

    pool.release(conn);
    expect(onRelease).toHaveBeenCalledWith(conn);
    expect(closer).not.toHaveBeenCalled();
  });

  it("factory called only up to maxConnections", async () => {
    pool = new ConnectionPool(factory, closer, { maxConnections: 2 });
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(factory).toHaveBeenCalledTimes(2);

    const p3 = pool.acquire();
    await vi.advanceTimersByTimeAsync(10);
    expect(factory).toHaveBeenCalledTimes(2);

    pool.release(c1);
    const c3 = await p3;
    expect(c3).toBe(c1);

    pool.release(c2);
    pool.release(c3);
  });

  it("queued acquire when pool exhausted", async () => {
    pool = new ConnectionPool(factory, closer, { maxConnections: 1 });
    const c1 = await pool.acquire();
    const p2 = pool.acquire();
    let resolved = false;
    p2.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);

    pool.release(c1);
    const c2 = await p2;
    expect(c2).toBe(c1);
    pool.release(c2);
  });

  it("acquire timeout", async () => {
    pool = new ConnectionPool(factory, closer, {
      maxConnections: 1,
      acquireTimeoutMs: 500,
    });
    const c1 = await pool.acquire();
    const p2 = pool.acquire();

    vi.advanceTimersByTime(500);
    await expect(p2).rejects.toThrow("Acquire timeout");

    pool.release(c1);
  });

  it("validator rejecting stale connections", async () => {
    const validator = vi.fn().mockResolvedValue(false);
    pool = new ConnectionPool(factory, closer, { maxConnections: 2 }, validator);
    const c1 = await pool.acquire();
    pool.release(c1);

    const c2 = await pool.acquire();
    expect(validator).toHaveBeenCalledWith(c1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(c2).toEqual({ id: 2 });
    pool.release(c2);
  });

  it("idle cleanup closes stale connections", async () => {
    pool = new ConnectionPool(factory, closer, {
      maxConnections: 2,
      idleTimeoutMs: 1000,
    });
    const c1 = await pool.acquire();
    pool.release(c1);
    expect(closer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(closer).toHaveBeenCalledTimes(1);
    expect(closer).toHaveBeenCalledWith(c1);
  });

  it("drain closes everything and rejects pending waiters", async () => {
    pool = new ConnectionPool(factory, closer, { maxConnections: 2 });
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    const p3 = pool.acquire();

    const onClose = vi.fn();
    pool.on("close", onClose);

    const drainPromise = pool.drain();
    await expect(p3).rejects.toThrow("Pool is drained");
    await drainPromise;

    expect(closer).toHaveBeenCalledTimes(2);
    expect(closer).toHaveBeenCalledWith(c1);
    expect(closer).toHaveBeenCalledWith(c2);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
