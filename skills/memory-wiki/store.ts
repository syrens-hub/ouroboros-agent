/**
 * Memory Wiki Store
 * =================
 * Low-level claim storage operations to avoid circular deps with confidence-engine.
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import type { Claim, EvidenceSource } from "./types.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";
import { initClaimGraphTables } from "./claim-graph.ts";
import { initEvidenceTreeTables } from "./evidence-tree.ts";

export function initMemoryWikiTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      freshness TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sources TEXT,
      contradictions TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category);
    CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_claims_freshness ON claims(freshness);
  `);
  initClaimGraphTables(db);
  initEvidenceTreeTables(db);
}

export function ensureInitialized(): void {
  const db = getDb();
  initMemoryWikiTables(db);
}

export function rowToClaim(row: unknown): Claim {
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
    sources: r.sources ? (safeJsonParse<EvidenceSource[]>(String(r.sources), "claim sources") ?? []) : [],
    contradictions: r.contradictions ? (safeJsonParse<string[]>(String(r.contradictions), "claim contradictions") ?? []) : [],
  };
}

export function getClaim(id: string): Claim | undefined {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id);
  if (!row) return undefined;
  return rowToClaim(row);
}

export function updateClaim(id: string, updates: Partial<Claim>): Claim | undefined {
  ensureInitialized();
  const db = getDb();
  const existing = getClaim(id);
  if (!existing) return undefined;

  const updated: Claim = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  db.prepare(
    `UPDATE claims SET category = ?, content = ?, freshness = ?, status = ?, confidence = ?, updated_at = ?, sources = ?, contradictions = ? WHERE id = ?`
  ).run(
    updated.category,
    updated.content,
    updated.freshness,
    updated.status,
    updated.confidence,
    updated.updatedAt,
    JSON.stringify(updated.sources),
    JSON.stringify(updated.contradictions),
    updated.id
  );

  return updated;
}
