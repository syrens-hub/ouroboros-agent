/**
 * Persistent Vector Store
 * =======================
 * SQLite-backed vector storage with HNSW approximate nearest neighbor search
 * via usearch. Falls back to brute-force if index is not yet initialized.
 */

import { getDb } from "../../core/db-manager.ts";
import { Index, MetricKind, ScalarKind } from "usearch";

export interface VectorEntry {
  id: string;
  sessionId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec;
  return vec.map((v) => v / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export class VectorStore {
  private index: Index | null = null;
  private nextKey = 1n;
  private idToKey = new Map<string, bigint>();
  private keyToEntry = new Map<bigint, VectorEntry>();
  private indexLoaded = false;

  constructor() {
    const db = getDb();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )`
    ).run();
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_vector_session ON vector_embeddings(session_id)`
    ).run();
  }

  private ensureIndex(dimensions: number): Index {
    if (!this.index) {
      this.index = new Index(dimensions, MetricKind.Cos, ScalarKind.F32, 0, 0, 0);
    }
    return this.index;
  }

  private loadIndexFromDb(): void {
    if (this.indexLoaded) return;
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, session_id, content, embedding, metadata, created_at
       FROM vector_embeddings`
    ).all() as Array<{
      id: string;
      session_id: string;
      content: string;
      embedding: string;
      metadata: string;
      created_at: number;
    }>;

    if (rows.length > 0) {
      const firstEmbedding = JSON.parse(rows[0].embedding) as number[];
      const index = this.ensureIndex(firstEmbedding.length);
      for (const row of rows) {
        const embedding = JSON.parse(row.embedding) as number[];
        const key = this.nextKey++;
        index.add(key, new Float32Array(embedding), 1);
        const entry: VectorEntry = {
          id: row.id,
          sessionId: row.session_id,
          content: row.content,
          embedding,
          metadata: JSON.parse(row.metadata || "{}"),
          createdAt: row.created_at,
        };
        this.idToKey.set(entry.id, key);
        this.keyToEntry.set(key, entry);
      }
    }
    this.indexLoaded = true;
  }

  add(entry: VectorEntry): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO vector_embeddings (id, session_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id,
      entry.sessionId,
      entry.content,
      JSON.stringify(entry.embedding),
      JSON.stringify(entry.metadata || {}),
      entry.createdAt
    );

    this.loadIndexFromDb();
    const index = this.ensureIndex(entry.embedding.length);
    const key = this.nextKey++;
    index.add(key, new Float32Array(entry.embedding));
    this.idToKey.set(entry.id, key);
    this.keyToEntry.set(key, entry);
  }

  addMany(entries: VectorEntry[]): void {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO vector_embeddings (id, session_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const item of entries) {
      insert.run(
        item.id,
        item.sessionId,
        item.content,
        JSON.stringify(item.embedding),
        JSON.stringify(item.metadata || {}),
        item.createdAt
      );
    }

    this.loadIndexFromDb();
    if (entries.length > 0) {
      const index = this.ensureIndex(entries[0].embedding.length);
      for (const item of entries) {
        const key = this.nextKey++;
        index.add(key, new Float32Array(item.embedding));
        this.idToKey.set(item.id, key);
        this.keyToEntry.set(key, item);
      }
    }
  }

  search(sessionId: string, queryEmbedding: number[], topK = 5): SearchResult[] {
    this.loadIndexFromDb();
    if (this.index) {
      const queryVec = new Float32Array(queryEmbedding);
      // Fetch more than topK to allow for session filtering
      const raw = this.index.search(queryVec, topK * 3, 1);
      const hits: SearchResult[] = [];
      for (let i = 0; i < raw.keys.length; i++) {
        const key = raw.keys[i];
        const entry = this.keyToEntry.get(key);
        if (!entry || entry.sessionId !== sessionId) continue;
        const score = 1 - raw.distances[i];
        hits.push({ entry, score });
        if (hits.length >= topK) break;
      }
      if (hits.length > 0) return hits;
      // Fallback to brute-force if HNSW didn't return enough for this session
    }

    // Brute-force fallback (handles empty index or missing session data)
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, session_id, content, embedding, metadata, created_at
       FROM vector_embeddings
       WHERE session_id = ?`
    ).all(sessionId) as Array<{
      id: string;
      session_id: string;
      content: string;
      embedding: string;
      metadata: string;
      created_at: number;
    }>;

    const queryVec = normalize(queryEmbedding);
    const results: SearchResult[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryVec, normalize(embedding));
      results.push({
        entry: {
          id: row.id,
          sessionId: row.session_id,
          content: row.content,
          embedding,
          metadata: JSON.parse(row.metadata || "{}"),
          createdAt: row.created_at,
        },
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  delete(sessionId: string, id: string): boolean {
    const db = getDb();
    const result = db.prepare(
      `DELETE FROM vector_embeddings WHERE session_id = ? AND id = ?`
    ).run(sessionId, id);
    const changed = (result as { changes: number }).changes > 0;

    if (changed) {
      const key = this.idToKey.get(id);
      if (key && this.index) {
        try {
          this.index.remove(key);
        } catch {
          // ignore remove failures
        }
        this.idToKey.delete(id);
        this.keyToEntry.delete(key);
      }
    }
    return changed;
  }

  clear(sessionId: string): void {
    const db = getDb();
    db.prepare(`DELETE FROM vector_embeddings WHERE session_id = ?`).run(sessionId);

    if (this.index) {
      for (const [key, entry] of this.keyToEntry) {
        if (entry.sessionId === sessionId) {
          try {
            this.index.remove(key);
          } catch {
            // ignore
          }
          this.idToKey.delete(entry.id);
          this.keyToEntry.delete(key);
        }
      }
    }
  }

  count(sessionId: string): number {
    const db = getDb();
    const row = db.prepare(
      `SELECT COUNT(*) as c FROM vector_embeddings WHERE session_id = ?`
    ).get(sessionId) as { c: number };
    return row?.c ?? 0;
  }
}

export function createVectorStore(): VectorStore {
  return new VectorStore();
}
