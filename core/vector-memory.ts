/**
 * Vector Memory Layer
 * ===================
 * In-memory vector store with cosine similarity search.
 * Supports pluggable embedding functions; defaults to a lightweight
 * character n-gram fallback for zero-dependency demos.
 */

import { randomUUID } from "crypto";
import type { VectorMemory, VectorMemoryEntry, VectorMemorySearchResult } from "../types/index.ts";

export type EmbeddingFn = (text: string) => Promise<number[]> | number[];

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

// Lightweight fallback embedding: character trigram frequency vector (256 dims)
function charTrigramEmbedding(text: string): number[] {
  const vec = new Array(256).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length - 2; i++) {
    const tri = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < tri.length; j++) {
      hash = (hash * 31 + tri.charCodeAt(j)) % 256;
    }
    vec[hash] += 1;
  }
  return normalize(vec);
}

export function createInMemoryVectorMemory(embedding?: EmbeddingFn): VectorMemory {
  const store = new Map<string, VectorMemoryEntry>();
  const embed = embedding || charTrigramEmbedding;

  return {
    async add(sessionId, content, metadata = {}) {
      const embeddingVec = normalize(await embed(content));
      const entry: VectorMemoryEntry = {
        id: randomUUID(),
        sessionId,
        content,
        embedding: embeddingVec,
        metadata,
        createdAt: Date.now(),
      };
      store.set(entry.id, entry);
      return entry.id;
    },

    async search(sessionId, query, topK = 5) {
      const queryVec = normalize(await embed(query));
      const results: VectorMemorySearchResult[] = [];
      for (const entry of store.values()) {
        if (entry.sessionId !== sessionId) continue;
        const score = cosineSimilarity(queryVec, entry.embedding);
        results.push({ entry, score });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    },

    async delete(sessionId, id) {
      const entry = store.get(id);
      if (!entry || entry.sessionId !== sessionId) return false;
      store.delete(id);
      return true;
    },
  };
}
