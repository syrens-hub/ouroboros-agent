import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemorySemanticCache,
  DbSemanticCache,
  cosineSimilarity,
} from "../../core/semantic-cache.ts";
import { getDb, resetDbSingleton } from "../../core/db-manager.ts";
import { appConfig } from "../../core/config.ts";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it("handles mismatched dimensions by truncating", () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(
      cosineSimilarity([1, 2, 3], [1, 2, 3]),
      6
    );
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("InMemorySemanticCache", () => {
  let cache: InMemorySemanticCache;

  beforeEach(() => {
    cache = new InMemorySemanticCache(100);
  });

  it("stores and retrieves a cached response", async () => {
    const embedding = [1, 0, 0];
    await cache.set("hello", embedding, "world");
    const result = await cache.get("hello", embedding);
    expect(result).not.toBeNull();
    expect(result!.response).toBe("world");
    expect(result!.similarity).toBeCloseTo(1, 6);
  });

  it("returns null when no similar entry exists", async () => {
    const embedding = [1, 0, 0];
    await cache.set("hello", embedding, "world");
    const result = await cache.get("different", [0, 1, 0], { threshold: 0.95 });
    expect(result).toBeNull();
  });

  it("returns similar entry above threshold", async () => {
    const e1 = [1, 0, 0];
    const e2 = [0.99, 0.01, 0];
    await cache.set("query one", e1, "response one");
    const result = await cache.get("query two", e2, { threshold: 0.95 });
    expect(result).not.toBeNull();
    expect(result!.response).toBe("response one");
    expect(result!.similarity).toBeGreaterThan(0.95);
  });

  it("does not return entry below threshold", async () => {
    const e1 = [1, 0, 0];
    const e2 = [0.5, 0.5, 0];
    await cache.set("query one", e1, "response one");
    const result = await cache.get("query two", e2, { threshold: 0.95 });
    expect(result).toBeNull();
  });

  it("respects model filter", async () => {
    const embedding = [1, 0, 0];
    await cache.set("hello", embedding, "world", { model: "model-a" });
    const result = await cache.get("hello", embedding, { model: "model-b" });
    expect(result).toBeNull();
  });

  it("increments hit count on cache hit", async () => {
    const embedding = [1, 0, 0];
    await cache.set("hello", embedding, "world");
    await cache.get("hello", embedding);
    const result = await cache.get("hello", embedding);
    expect(result).not.toBeNull();
    expect(result!.entry.hitCount).toBe(2);
  });

  it("respects TTL and prunes expired entries", async () => {
    const embedding = [1, 0, 0];
    await cache.set("hello", embedding, "world", { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const result = await cache.get("hello", embedding);
    expect(result).toBeNull();

    const pruned = await cache.prune();
    expect(pruned).toBe(1);
  });

  it("evicts oldest entry when over capacity", async () => {
    const smallCache = new InMemorySemanticCache(2);
    await smallCache.set("a", [1, 0, 0], "A");
    await new Promise((r) => setTimeout(r, 5));
    await smallCache.set("b", [0, 1, 0], "B");
    await smallCache.set("c", [0, 0, 1], "C");

    const hitA = await smallCache.get("a", [1, 0, 0]);
    expect(hitA).toBeNull();

    const hitB = await smallCache.get("b", [0, 1, 0]);
    expect(hitB).not.toBeNull();
  });

  it("invalidate clears all entries when no pattern", async () => {
    await cache.set("a", [1, 0, 0], "A");
    await cache.set("b", [0, 1, 0], "B");
    const count = await cache.invalidate();
    expect(count).toBe(2);
    expect(await cache.get("a", [1, 0, 0])).toBeNull();
  });

  it("invalidate removes matching entries by pattern", async () => {
    await cache.set("hello world", [1, 0, 0], "A");
    await cache.set("goodbye", [0, 1, 0], "B");
    const count = await cache.invalidate("hello");
    expect(count).toBe(1);
    expect(await cache.get("hello world", [1, 0, 0])).toBeNull();
    expect(await cache.get("goodbye", [0, 1, 0])).not.toBeNull();
  });
});

describe("DbSemanticCache", () => {
  const originalUsePostgres = appConfig.db.usePostgres;
  const originalPostgresUrl = appConfig.db.postgresUrl;

  beforeEach(() => {
    appConfig.db.usePostgres = originalUsePostgres;
    appConfig.db.postgresUrl = originalPostgresUrl;
    resetDbSingleton();
    const db = getDb();
    db.prepare("DELETE FROM semantic_cache").run();
  });

  afterEach(() => {
    appConfig.db.usePostgres = originalUsePostgres;
    appConfig.db.postgresUrl = originalPostgresUrl;
    resetDbSingleton();
  });

  it("stores and retrieves from database", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);
    const embedding = [1, 0, 0];

    await cache.set("hello", embedding, "world", { model: "test-model" });
    const result = await cache.get("hello", embedding, { model: "test-model" });

    expect(result).not.toBeNull();
    expect(result!.response).toBe("world");
    expect(result!.similarity).toBeCloseTo(1, 5);
  });

  it("returns null for expired entries", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);
    const embedding = [1, 0, 0];

    await cache.set("hello", embedding, "world", { ttlMs: 1, model: "test-model" });
    await new Promise((r) => setTimeout(r, 10));

    const result = await cache.get("hello", embedding, { model: "test-model" });
    expect(result).toBeNull();
  });

  it("prunes expired entries from database", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);

    await cache.set("a", [1, 0, 0], "A", { ttlMs: 1, model: "test-model" });
    await new Promise((r) => setTimeout(r, 10));
    await cache.set("b", [0, 1, 0], "B", { ttlMs: 60000, model: "test-model" });

    const pruned = await cache.prune();
    expect(pruned).toBe(1);

    const result = await cache.get("a", [1, 0, 0], { model: "test-model" });
    expect(result).toBeNull();
  });

  it("respects similarity threshold", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);
    const e1 = [1, 0, 0];
    const e2 = [0.5, 0.5, 0];

    await cache.set("query one", e1, "response one", { model: "test-model" });
    const result = await cache.get("query two", e2, {
      threshold: 0.95,
      model: "test-model",
    });
    expect(result).toBeNull();
  });

  it("returns similar entry above threshold", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);
    const e1 = [1, 0, 0];
    const e2 = [0.99, 0.01, 0];

    await cache.set("query one", e1, "response one", { model: "test-model" });
    const result = await cache.get("query two", e2, {
      threshold: 0.95,
      model: "test-model",
    });
    expect(result).not.toBeNull();
    expect(result!.response).toBe("response one");
  });

  it("invalidate removes all entries when no pattern", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);

    await cache.set("a", [1, 0, 0], "A", { model: "test-model" });
    await cache.set("b", [0, 1, 0], "B", { model: "test-model" });
    const count = await cache.invalidate();
    expect(count).toBe(2);
  });

  it("invalidate removes matching entries by pattern", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);

    await cache.set("hello world", [1, 0, 0], "A", { model: "test-model" });
    await cache.set("goodbye", [0, 1, 0], "B", { model: "test-model" });
    const count = await cache.invalidate("hello");
    expect(count).toBe(1);
    expect(await cache.get("hello world", [1, 0, 0], { model: "test-model" })).toBeNull();
    expect(await cache.get("goodbye", [0, 1, 0], { model: "test-model" })).not.toBeNull();
  });

  it("increments hit count on cache hit", async () => {
    const db = getDb();
    const cache = new DbSemanticCache(db);
    const embedding = [1, 0, 0];

    await cache.set("hello", embedding, "world", { model: "test-model" });
    await cache.get("hello", embedding, { model: "test-model" });
    const result = await cache.get("hello", embedding, { model: "test-model" });

    expect(result).not.toBeNull();
    expect(result!.entry.hitCount).toBe(2);
  });
});
