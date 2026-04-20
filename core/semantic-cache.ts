/**
 * Semantic Cache for LLM Queries
 * ================================
 * Reduces LLM API costs by caching responses keyed by query embedding
 * cosine similarity. Supports both in-memory and database-backed storage.
 */

import { randomUUID } from "crypto";
import { safeFailOpenAsync } from "./safe-utils.ts";
import type { DbAdapter } from "./db-adapter.ts";

export interface SemanticCacheEntry {
  id: string;
  queryEmbedding: number[];
  queryText: string;
  response: string;
  model: string;
  createdAt: number;
  hitCount: number;
  ttlMs: number;
}

export interface CacheResult {
  response: string;
  similarity: number;
  entry: SemanticCacheEntry;
}

export interface SemanticCache {
  get(
    query: string,
    embedding: number[],
    opts?: { threshold?: number; model?: string }
  ): Promise<CacheResult | null>;
  set(
    query: string,
    embedding: number[],
    response: string,
    opts?: { ttlMs?: number; model?: string }
  ): Promise<void>;
  invalidate(pattern?: string): Promise<number>;
  prune(): Promise<number>;
}

// =============================================================================
// Cosine Similarity
// =============================================================================

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Gracefully handle mismatched dimensions by truncating to the shorter length
    const len = Math.min(a.length, b.length);
    a = a.slice(0, len);
    b = b.slice(0, len);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// =============================================================================
// In-Memory Semantic Cache
// =============================================================================

export class InMemorySemanticCache implements SemanticCache {
  private store = new Map<string, SemanticCacheEntry>();
  private maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  async get(
    _query: string,
    embedding: number[],
    opts?: { threshold?: number; model?: string }
  ): Promise<CacheResult | null> {
    const threshold = opts?.threshold ?? 0.95;
    const model = opts?.model ?? "default";
    const now = Date.now();

    let best: CacheResult | null = null;

    for (const entry of this.store.values()) {
      if (entry.model !== model) continue;
      if (entry.createdAt + entry.ttlMs < now) continue;

      const similarity = cosineSimilarity(embedding, entry.queryEmbedding);
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { response: entry.response, similarity, entry };
      }
    }

    if (best) {
      const entry = this.store.get(best.entry.id);
      if (entry) {
        entry.hitCount += 1;
      }
    }

    return best;
  }

  async set(
    query: string,
    embedding: number[],
    response: string,
    opts?: { ttlMs?: number; model?: string }
  ): Promise<void> {
    const now = Date.now();
    const entry: SemanticCacheEntry = {
      id: randomUUID(),
      queryText: query,
      queryEmbedding: embedding,
      response,
      model: opts?.model ?? "default",
      createdAt: now,
      hitCount: 0,
      ttlMs: opts?.ttlMs ?? 7 * 24 * 60 * 60 * 1000,
    };

    // Simple LRU eviction when over capacity: remove oldest by createdAt
    if (this.store.size >= this.maxEntries) {
      let oldest: SemanticCacheEntry | undefined;
      for (const e of this.store.values()) {
        if (!oldest || e.createdAt < oldest.createdAt) {
          oldest = e;
        }
      }
      if (oldest) {
        this.store.delete(oldest.id);
      }
    }

    this.store.set(entry.id, entry);
  }

  async invalidate(pattern?: string): Promise<number> {
    if (!pattern) {
      const count = this.store.size;
      this.store.clear();
      return count;
    }
    const regex = new RegExp(pattern, "i");
    let count = 0;
    for (const [id, entry] of this.store.entries()) {
      if (regex.test(entry.queryText) || regex.test(entry.response)) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }

  async prune(): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, entry] of this.store.entries()) {
      if (entry.createdAt + entry.ttlMs < now) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }
}

// =============================================================================
// Database-Backed Semantic Cache
// =============================================================================

function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function deserializeEmbedding(buffer: Buffer | ArrayBuffer | Uint8Array): number[] {
  let buf: Buffer;
  if (buffer instanceof Buffer) {
    buf = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    buf = Buffer.from(buffer);
  } else {
    buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(floats);
}

export class DbSemanticCache implements SemanticCache {
  private db: DbAdapter;

  constructor(db: DbAdapter) {
    this.db = db;
  }

  async get(
    _query: string,
    embedding: number[],
    opts?: { threshold?: number; model?: string }
  ): Promise<CacheResult | null> {
    return safeFailOpenAsync(async () => {
      const threshold = opts?.threshold ?? 0.95;
      const model = opts?.model ?? "default";
      const now = Date.now();

      const stmt = this.db.prepare(
        `SELECT id, query_text, query_embedding, response, model, created_at, hit_count, ttl_ms
         FROM semantic_cache
         WHERE model = ? AND (created_at + ttl_ms) > ?`
      );
      const rows = (await stmt.all(model, now)) as Array<{
        id: string;
        query_text: string;
        query_embedding: Buffer;
        response: string;
        model: string;
        created_at: number;
        hit_count: number;
        ttl_ms: number;
      }>;

      let best: CacheResult | null = null;

      for (const row of rows) {
        const entryEmbedding = deserializeEmbedding(row.query_embedding);
        const similarity = cosineSimilarity(embedding, entryEmbedding);
        if (similarity >= threshold && (!best || similarity > best.similarity)) {
          best = {
            response: row.response,
            similarity,
            entry: {
              id: row.id,
              queryText: row.query_text,
              queryEmbedding: entryEmbedding,
              response: row.response,
              model: row.model,
              createdAt: row.created_at,
              hitCount: row.hit_count,
              ttlMs: row.ttl_ms,
            },
          };
        }
      }

      if (best) {
        const updateStmt = this.db.prepare(
          `UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = ?`
        );
        await updateStmt.run(best.entry.id);
        best.entry.hitCount += 1;
      }

      return best;
    }, "DbSemanticCache.get", null);
  }

  async set(
    query: string,
    embedding: number[],
    response: string,
    opts?: { ttlMs?: number; model?: string }
  ): Promise<void> {
    return safeFailOpenAsync(async () => {
      const id = randomUUID();
      const model = opts?.model ?? "default";
      const ttlMs = opts?.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
      const createdAt = Date.now();

      const stmt = this.db.prepare(
        `INSERT INTO semantic_cache (id, query_text, query_embedding, response, model, created_at, hit_count, ttl_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      await stmt.run(
        id,
        query,
        serializeEmbedding(embedding),
        response,
        model,
        createdAt,
        0,
        ttlMs
      );
    }, "DbSemanticCache.set", undefined);
  }

  async invalidate(pattern?: string): Promise<number> {
    return safeFailOpenAsync(async () => {
      if (!pattern) {
        const stmt = this.db.prepare(`DELETE FROM semantic_cache`);
        const result = await stmt.run();
        return Number(result.changes);
      }
      const stmt = this.db.prepare(
        `DELETE FROM semantic_cache WHERE query_text LIKE ? OR response LIKE ?`
      );
      const result = await stmt.run(`%${pattern}%`, `%${pattern}%`);
      return Number(result.changes);
    }, "DbSemanticCache.invalidate", 0);
  }

  async prune(): Promise<number> {
    return safeFailOpenAsync(async () => {
      const now = Date.now();
      const stmt = this.db.prepare(
        `DELETE FROM semantic_cache WHERE (created_at + ttl_ms) < ?`
      );
      const result = await stmt.run(now);
      return Number(result.changes);
    }, "DbSemanticCache.prune", 0);
  }
}
