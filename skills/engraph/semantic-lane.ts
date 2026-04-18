import { getDb } from "../../core/db-manager.ts";
import type { SearchQuery, SearchResult } from "./types.ts";

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function bigramSet(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}

function combinedSemanticScore(query: string, doc: string): number {
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const dTokens = new Set(doc.toLowerCase().split(/\W+/).filter(Boolean));
  const tokenScore = jaccardSimilarity(qTokens, dTokens);

  const qBigrams = bigramSet(query);
  const dBigrams = bigramSet(doc);
  const bigramScore = jaccardSimilarity(qBigrams, dBigrams);

  // Weighted combination: unigrams 60%, bigrams 40%
  return tokenScore * 0.6 + bigramScore * 0.4;
}

/**
 * Semantic Lane v2
 * ================
 * Pre-filters candidates via FTS5 (up to 200), then scores with
 * unigram Jaccard + bigram overlap for better semantic matching.
 */
export function searchSemanticLane(query: SearchQuery): SearchResult[] {
  const db = getDb();
  const limit = query.limit ?? 10;
  const candidateLimit = 200;
  const queryText = query.text;

  if (!queryText.trim()) return [];

  const results: SearchResult[] = [];

  // Pre-filter candidates with FTS5 for efficiency
  const ftsQuery = queryText
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1)
    .join(" OR ");

  // kb_chunks via kb_fts
  try {
    const candidateIds: string[] = [];
    if (ftsQuery) {
      const ftsRows = db
        .prepare(`SELECT kb_chunk_id AS id FROM kb_fts WHERE kb_fts MATCH ? LIMIT ?`)
        .all(ftsQuery, candidateLimit) as Array<{ id: string }>;
      candidateIds.push(...ftsRows.map((r) => r.id));
    }

    // Fallback: if FTS returns few results, sample from kb_chunks directly
    if (candidateIds.length < candidateLimit / 2) {
      const sampleRows = db
        .prepare(`SELECT id, content FROM kb_chunks LIMIT ?`)
        .all(candidateLimit) as Array<{ id: string; content: string }>;

      const scored = sampleRows
        .map((row) => ({
          id: row.id,
          content: row.content,
          score: combinedSemanticScore(queryText, row.content),
        }))
        .filter((r) => r.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      results.push(
        ...scored.map((r) => ({
          id: r.id,
          content: r.content,
          score: Math.min(1, r.score),
          lane: "semantic" as const,
          metadata: { source: "kb_chunks", method: "fallback_scan" },
        }))
      );
    } else {
      const placeholders = candidateIds.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT id, content FROM kb_chunks WHERE id IN (${placeholders})`)
        .all(...candidateIds) as Array<{ id: string; content: string }>;

      const scored = rows
        .map((row) => ({
          id: row.id,
          content: row.content,
          score: combinedSemanticScore(queryText, row.content),
        }))
        .filter((r) => r.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      results.push(
        ...scored.map((r) => ({
          id: r.id,
          content: r.content,
          score: Math.min(1, r.score),
          lane: "semantic" as const,
          metadata: { source: "kb_chunks", method: "fts_prefilter" },
        }))
      );
    }
  } catch {
    // table may not exist yet
  }

  // messages via messages_fts
  try {
    const msgCandidates: number[] = [];
    if (ftsQuery) {
      const ftsRows = db
        .prepare(`SELECT rowid AS id FROM messages_fts WHERE messages_fts MATCH ? LIMIT ?`)
        .all(ftsQuery, candidateLimit) as Array<{ id: number }>;
      msgCandidates.push(...ftsRows.map((r) => r.id));
    }

    if (msgCandidates.length > 0) {
      const placeholders = msgCandidates.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT id, content FROM messages WHERE id IN (${placeholders})`)
        .all(...msgCandidates) as Array<{ id: number; content: string }>;

      const scored = rows
        .map((row) => ({
          id: String(row.id),
          content: row.content,
          score: combinedSemanticScore(queryText, row.content),
        }))
        .filter((r) => r.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      results.push(
        ...scored.map((r) => ({
          id: r.id,
          content: r.content,
          score: Math.min(1, r.score),
          lane: "semantic" as const,
          metadata: { source: "messages", method: "fts_prefilter" },
        }))
      );
    }
  } catch {
    // table may not exist yet
  }

  return results;
}
