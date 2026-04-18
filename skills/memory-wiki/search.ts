/**
 * Claim Search
 * ============
 * Full-text and structured search over claims.
 */

import { getDb } from "../../core/db-manager.ts";
import type { Claim, EvidenceSource } from "./types.ts";

function rowToClaim(row: unknown): Claim {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    category: String(r.category),
    content: String(r.content),
    freshness: String(r.freshness) as Claim["freshness"],
    status: String(r.status) as Claim["status"],
    confidence: Number(r.confidence),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    sources: r.sources ? (JSON.parse(String(r.sources)) as EvidenceSource[]) : [],
    contradictions: r.contradictions ? (JSON.parse(String(r.contradictions)) as string[]) : [],
  };
}

export interface SearchOptions {
  query?: string;
  category?: string;
  status?: Claim["status"];
  freshness?: Claim["freshness"];
  minConfidence?: number;
  maxConfidence?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  claims: Claim[];
  total: number;
}

export function searchClaims(options: SearchOptions): SearchResult {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.query) {
    conditions.push("(content LIKE ? OR category LIKE ?)");
    const pattern = `%${options.query}%`;
    params.push(pattern, pattern);
  }
  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.freshness) {
    conditions.push("freshness = ?");
    params.push(options.freshness);
  }
  if (options.minConfidence !== undefined) {
    conditions.push("confidence >= ?");
    params.push(options.minConfidence);
  }
  if (options.maxConfidence !== undefined) {
    conditions.push("confidence <= ?");
    params.push(options.maxConfidence);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM claims ${whereClause}`).get(...params) as { total: number };
  const total = countRow?.total ?? 0;

  // Fetch results
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const rows = db.prepare(
    `SELECT * FROM claims ${whereClause} ORDER BY confidence DESC, updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as unknown[];

  return {
    claims: rows.map(rowToClaim),
    total,
  };
}
