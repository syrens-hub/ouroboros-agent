/**
 * Memory Wiki Skill
 * =================
 * Knowledge Brain foundation with Claim/Evidence model.
 * Persistent claim storage backed by SQLite via DbAdapter.
 */

import { randomUUID } from "crypto";
import { getDb } from "../../core/db-manager.ts";
import type { Claim, EvidenceSource } from "./types.ts";
import {
  initMemoryWikiTables,
  ensureInitialized,
  rowToClaim,
  getClaim,
  updateClaim,
} from "./store.ts";

export type { Claim, EvidenceSource };
export { initMemoryWikiTables, ensureInitialized, rowToClaim, getClaim, updateClaim };

import { addRelation, removeRelation } from "./claim-graph.ts";

export function createClaim(
  claim: Omit<Claim, "id" | "createdAt" | "updatedAt">
): Claim {
  ensureInitialized();
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();
  const fullClaim: Claim = {
    ...claim,
    id,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO claims (id, category, content, freshness, status, confidence, created_at, updated_at, sources, contradictions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fullClaim.id,
    fullClaim.category,
    fullClaim.content,
    fullClaim.freshness,
    fullClaim.status,
    fullClaim.confidence,
    fullClaim.createdAt,
    fullClaim.updatedAt,
    JSON.stringify(fullClaim.sources),
    JSON.stringify(fullClaim.contradictions)
  );

  return fullClaim;
}



export function listClaims(options?: {
  category?: string;
  status?: Claim["status"];
  freshness?: Claim["freshness"];
  limit?: number;
}): Claim[] {
  ensureInitialized();
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.category !== undefined) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options?.status !== undefined) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.freshness !== undefined) {
    conditions.push("freshness = ?");
    params.push(options.freshness);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit !== undefined ? `LIMIT ?` : "";
  if (options?.limit !== undefined) {
    params.push(options.limit);
  }

  const rows = db.prepare(`SELECT * FROM claims ${whereClause} ORDER BY updated_at DESC ${limitClause}`).all(...params) as unknown[];
  return rows.map(rowToClaim);
}

export function deleteClaim(id: string): boolean {
  ensureInitialized();
  const db = getDb();
  const result = db.prepare(`DELETE FROM claims WHERE id = ?`).run(id);
  return (result as { changes: number }).changes > 0;
}

export function addContradiction(claimId: string, contradictsClaimId: string): void {
  const claim = getClaim(claimId);
  if (!claim) return;
  if (claim.contradictions.includes(contradictsClaimId)) return;
  claim.contradictions.push(contradictsClaimId);
  updateClaim(claimId, { contradictions: claim.contradictions });
  // Also register as a refutes relation in the graph
  addRelation(claimId, contradictsClaimId, "refutes", 0.8);
}

export function resolveContradiction(claimId: string, contradictsClaimId: string): void {
  const claim = getClaim(claimId);
  if (!claim) return;
  claim.contradictions = claim.contradictions.filter((c) => c !== contradictsClaimId);
  updateClaim(claimId, { contradictions: claim.contradictions });
  // Remove the refutes relation
  removeRelation(claimId, contradictsClaimId, "refutes");
}

// Re-export depth modules
export {
  addRelation,
  removeRelation,
  getRelatedClaims,
  getClaimGraph,
  initClaimGraphTables,
  type RelationType,
  type ClaimRelation,
  type ClaimNode,
} from "./claim-graph.ts";

export {
  propagateConfidence,
  batchPropagate,
  type ConfidencePropagationResult,
  type ConfidenceFactor,
} from "./confidence-engine.ts";

export {
  addEvidenceNode,
  getEvidenceNodes,
  getEvidenceTree,
  getEvidenceRoot,
  initEvidenceTreeTables,
  type EvidenceNode,
  type EvidenceSourceType,
} from "./evidence-tree.ts";

export { searchClaims, type SearchOptions, type SearchResult } from "./search.ts";
