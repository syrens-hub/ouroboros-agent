import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../../core/rate-limiter.ts";

describe("Rate Limiter (memory fallback)", () => {
  it("allows requests under the limit", async () => {
    const result = await checkRateLimit("ip:1", 3, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks requests over the limit", async () => {
    await checkRateLimit("ip:2", 2, 1000);
    await checkRateLimit("ip:2", 2, 1000);
    const result = await checkRateLimit("ip:2", 2, 1000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets the bucket after the window expires", async () => {
    await checkRateLimit("ip:3", 1, 50);
    const blocked = await checkRateLimit("ip:3", 1, 50);
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    const reset = await checkRateLimit("ip:3", 1, 50);
    expect(reset.allowed).toBe(true);
  });

  it("tracks different keys independently", async () => {
    await checkRateLimit("key:a", 1, 1000);
    const other = await checkRateLimit("key:b", 1, 1000);
    expect(other.allowed).toBe(true);
  });
});
