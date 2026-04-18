/**
 * Claim Graph
 * ===========
 * Typed relations between claims: supports, refutes, refines, related.
 * Enables graph traversal and subgraph queries.
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";

export type RelationType = "supports" | "refutes" | "refines" | "related";

export interface ClaimRelation {
  fromClaimId: string;
  toClaimId: string;
  relationType: RelationType;
  strength: number; // 0.0 - 1.0
  createdAt: number;
}

export interface ClaimNode {
  claimId: string;
  depth: number;
  relations: ClaimRelation[];
}

export function initClaimGraphTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claim_relations (
      from_claim_id TEXT NOT NULL,
      to_claim_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (from_claim_id, to_claim_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_claim_rel_from ON claim_relations(from_claim_id);
    CREATE INDEX IF NOT EXISTS idx_claim_rel_to ON claim_relations(to_claim_id);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initClaimGraphTables(db);
}

export function addRelation(
  fromClaimId: string,
  toClaimId: string,
  relationType: RelationType,
  strength = 1.0
): void {
  ensureInitialized();
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO claim_relations
     (from_claim_id, to_claim_id, relation_type, strength, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(fromClaimId, toClaimId, relationType, Math.max(0, Math.min(1, strength)), Date.now());
}

export function removeRelation(
  fromClaimId: string,
  toClaimId: string,
  relationType?: RelationType
): boolean {
  ensureInitialized();
  const db = getDb();
  if (relationType) {
    const result = db.prepare(
      `DELETE FROM claim_relations WHERE from_claim_id = ? AND to_claim_id = ? AND relation_type = ?`
    ).run(fromClaimId, toClaimId, relationType);
    return (result as { changes: number }).changes > 0;
  }
  const result = db.prepare(
    `DELETE FROM claim_relations WHERE from_claim_id = ? AND to_claim_id = ?`
  ).run(fromClaimId, toClaimId);
  return (result as { changes: number }).changes > 0;
}

export function getRelatedClaims(
  claimId: string,
  options?: {
    relationType?: RelationType;
    direction?: "outgoing" | "incoming" | "both";
  }
): ClaimRelation[] {
  ensureInitialized();
  const db = getDb();
  const direction = options?.direction ?? "both";
  const relations: ClaimRelation[] = [];

  if (direction === "outgoing" || direction === "both") {
    const typeFilter = options?.relationType ? "AND relation_type = ?" : "";
    const rows = db.prepare(
      `SELECT from_claim_id, to_claim_id, relation_type, strength, created_at
       FROM claim_relations WHERE from_claim_id = ? ${typeFilter}`
    ).all(options?.relationType ? [claimId, options.relationType] : [claimId]) as unknown[];
    relations.push(...rows.map(rowToRelation));
  }

  if (direction === "incoming" || direction === "both") {
    const typeFilter = options?.relationType ? "AND relation_type = ?" : "";
    const rows = db.prepare(
      `SELECT from_claim_id, to_claim_id, relation_type, strength, created_at
       FROM claim_relations WHERE to_claim_id = ? ${typeFilter}`
    ).all(options?.relationType ? [claimId, options.relationType] : [claimId]) as unknown[];
    relations.push(...rows.map(rowToRelation));
  }

  return relations;
}

export function getClaimGraph(
  claimId: string,
  maxDepth = 2
): ClaimNode[] {
  ensureInitialized();
  const visited = new Set<string>();
  const nodes: ClaimNode[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: claimId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const relations = getRelatedClaims(current.id, { direction: "both" });
    nodes.push({ claimId: current.id, depth: current.depth, relations });

    if (current.depth < maxDepth) {
      for (const rel of relations) {
        const nextId = rel.fromClaimId === current.id ? rel.toClaimId : rel.fromClaimId;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, depth: current.depth + 1 });
        }
      }
    }
  }

  return nodes;
}

function rowToRelation(row: unknown): ClaimRelation {
  const r = row as Record<string, unknown>;
  return {
    fromClaimId: String(r.from_claim_id),
    toClaimId: String(r.to_claim_id),
    relationType: String(r.relation_type) as RelationType,
    strength: Number(r.strength),
    createdAt: Number(r.created_at),
  };
}
