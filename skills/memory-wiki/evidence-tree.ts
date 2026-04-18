/**
 * Evidence Tree
 * =============
 * Hierarchical evidence tracking for claims.
 * Each evidence node can have a parent, forming a chain/tree of provenance.
 */

import { randomUUID } from "crypto";
import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";

export type EvidenceSourceType = "file" | "session" | "external" | "inference" | "expert";

export interface EvidenceNode {
  id: string;
  claimId: string;
  parentId: string | null;
  sourceType: EvidenceSourceType;
  sourceRef: string; // e.g. filepath, URL, sessionId, reasoning
  confidence: number;
  createdAt: number;
}

export function initEvidenceTreeTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_nodes (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      parent_id TEXT,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_claim ON evidence_nodes(claim_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_parent ON evidence_nodes(parent_id);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initEvidenceTreeTables(db);
}

export function addEvidenceNode(
  claimId: string,
  sourceType: EvidenceSourceType,
  sourceRef: string,
  options?: {
    parentId?: string;
    confidence?: number;
  }
): EvidenceNode {
  ensureInitialized();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const node: EvidenceNode = {
    id,
    claimId,
    parentId: options?.parentId ?? null,
    sourceType,
    sourceRef,
    confidence: options?.confidence ?? 0.8,
    createdAt: now,
  };

  db.prepare(
    `INSERT INTO evidence_nodes (id, claim_id, parent_id, source_type, source_ref, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, claimId, node.parentId, sourceType, sourceRef, node.confidence, now);

  return node;
}

export function getEvidenceNodes(claimId: string): EvidenceNode[] {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, claim_id, parent_id, source_type, source_ref, confidence, created_at
     FROM evidence_nodes WHERE claim_id = ? ORDER BY created_at DESC`
  ).all(claimId) as unknown[];
  return rows.map(rowToNode);
}

export function getEvidenceTree(claimId: string): EvidenceNode[][] {
  ensureInitialized();
  const db = getDb();
  const allRows = db.prepare(
    `SELECT id, claim_id, parent_id, source_type, source_ref, confidence, created_at
     FROM evidence_nodes WHERE claim_id = ?`
  ).all(claimId) as unknown[];
  const nodes = allRows.map(rowToNode);

  // Group by depth (BFS from roots)
  const roots = nodes.filter((n) => !n.parentId);
  const levels: EvidenceNode[][] = [];
  let current = [...roots];
  const visited = new Set<string>(roots.map((n) => n.id));

  while (current.length > 0) {
    levels.push(current);
    const next: EvidenceNode[] = [];
    for (const parent of current) {
      const children = nodes.filter((n) => n.parentId === parent.id && !visited.has(n.id));
      for (const child of children) {
        visited.add(child.id);
        next.push(child);
      }
    }
    current = next;
  }

  return levels;
}

export function getEvidenceRoot(nodeId: string): EvidenceNode | undefined {
  ensureInitialized();
  const db = getDb();
  let currentId: string | null = nodeId;
  let current: EvidenceNode | undefined;

  // Safety limit to prevent infinite loops from corrupted data
  for (let i = 0; i < 100 && currentId; i++) {
    const row = db.prepare(
      `SELECT id, claim_id, parent_id, source_type, source_ref, confidence, created_at
       FROM evidence_nodes WHERE id = ?`
    ).get(currentId) as unknown;
    if (!row) break;
    current = rowToNode(row);
    currentId = current.parentId;
  }

  return current;
}

function rowToNode(row: unknown): EvidenceNode {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    claimId: String(r.claim_id),
    parentId: r.parent_id ? String(r.parent_id) : null,
    sourceType: String(r.source_type) as EvidenceSourceType,
    sourceRef: String(r.source_ref),
    confidence: Number(r.confidence),
    createdAt: Number(r.created_at),
  };
}
