/**
 * Auto-Evolve Proposal Database
 * =============================
 * SQLite-backed queue for improvement proposals generated from telemetry.
 * Separate from evolution_approvals — this is for lightweight, data-driven
 * improvements (indexes, config, prompts) rather than code evolutions.
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";

export type ProposalCategory = "performance" | "reliability" | "resource" | "security" | "ux";
export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed" | "snoozed";
export type ProposalRisk = "low" | "medium" | "high";

export interface ImprovementProposal {
  id: string;
  category: ProposalCategory;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  rootCause: string;
  suggestedFix: string;
  expectedImpact: string;
  riskLevel: ProposalRisk;
  autoApplicable: boolean;
  status: ProposalStatus;
  sourceCheckupId?: string;
  relatedMetric?: string;
  currentValue?: number;
  threshold?: number;
  createdAt: number;
  resolvedAt?: number;
  appliedAt?: number;
  errorMessage?: string;
  gitCommit?: string;
}

export interface ProposalFilter {
  status?: ProposalStatus;
  category?: ProposalCategory;
  limit?: number;
}

export function initProposalTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_evolve_proposals (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      suggested_fix TEXT NOT NULL,
      expected_impact TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      auto_applicable INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      source_checkup_id TEXT,
      related_metric TEXT,
      current_value REAL,
      threshold REAL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      applied_at INTEGER,
      error_message TEXT,
      git_commit TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ae_proposals_status ON auto_evolve_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_ae_proposals_category ON auto_evolve_proposals(category);
    CREATE INDEX IF NOT EXISTS idx_ae_proposals_created ON auto_evolve_proposals(created_at DESC);
  `);
}

function ensureInitialized(): void {
  initProposalTables(getDb());
}

function genId(): string {
  return `aep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createProposal(
  draft: Omit<ImprovementProposal, "id" | "status" | "createdAt">
): ImprovementProposal {
  ensureInitialized();
  const proposal: ImprovementProposal = {
    ...draft,
    id: genId(),
    status: draft.autoApplicable ? "pending" : "pending",
    createdAt: Date.now(),
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO auto_evolve_proposals
     (id, category, severity, title, description, root_cause, suggested_fix,
      expected_impact, risk_level, auto_applicable, status, source_checkup_id,
      related_metric, current_value, threshold, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    proposal.id,
    proposal.category,
    proposal.severity,
    proposal.title,
    proposal.description,
    proposal.rootCause,
    proposal.suggestedFix,
    proposal.expectedImpact,
    proposal.riskLevel,
    proposal.autoApplicable ? 1 : 0,
    proposal.status,
    proposal.sourceCheckupId ?? null,
    proposal.relatedMetric ?? null,
    proposal.currentValue ?? null,
    proposal.threshold ?? null,
    proposal.createdAt
  );

  return proposal;
}

export function getProposal(id: string): ImprovementProposal | undefined {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM auto_evolve_proposals WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToProposal(row) : undefined;
}

export function listProposals(filter: ProposalFilter = {}): ImprovementProposal[] {
  ensureInitialized();
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.category) {
    conditions.push("category = ?");
    params.push(filter.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 100;

  const rows = db.prepare(
    `SELECT * FROM auto_evolve_proposals ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as Record<string, unknown>[];

  return rows.map(rowToProposal);
}

export function updateProposalStatus(
  id: string,
  status: ProposalStatus,
  meta?: { errorMessage?: string; gitCommit?: string }
): boolean {
  ensureInitialized();
  const db = getDb();
  const now = Date.now();

  const sets = ["status = ?"];
  const params: (string | number | null)[] = [status];

  if (status === "applied" || status === "failed" || status === "rejected") {
    sets.push("resolved_at = ?");
    params.push(now);
  }
  if (status === "applied") {
    sets.push("applied_at = ?");
    params.push(now);
  }
  if (meta?.errorMessage) {
    sets.push("error_message = ?");
    params.push(meta.errorMessage);
  }
  if (meta?.gitCommit) {
    sets.push("git_commit = ?");
    params.push(meta.gitCommit);
  }

  params.push(id);

  const result = db.prepare(
    `UPDATE auto_evolve_proposals SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return (result as { changes: number }).changes > 0;
}

export function deleteProposal(id: string): boolean {
  ensureInitialized();
  const db = getDb();
  const result = db.prepare("DELETE FROM auto_evolve_proposals WHERE id = ?").run(id);
  return (result as { changes: number }).changes > 0;
}

export function getProposalStats(): Record<ProposalStatus, number> {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT status, COUNT(*) as count FROM auto_evolve_proposals GROUP BY status`
  ).all() as Array<{ status: string; count: number }>;

  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, applied: 0, failed: 0, snoozed: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats as Record<ProposalStatus, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToProposal(row: Record<string, unknown>): ImprovementProposal {
  return {
    id: String(row.id),
    category: String(row.category) as ProposalCategory,
    severity: String(row.severity) as "critical" | "warning" | "info",
    title: String(row.title),
    description: String(row.description),
    rootCause: String(row.root_cause),
    suggestedFix: String(row.suggested_fix),
    expectedImpact: String(row.expected_impact),
    riskLevel: String(row.risk_level) as ProposalRisk,
    autoApplicable: Boolean(row.auto_applicable),
    status: String(row.status) as ProposalStatus,
    sourceCheckupId: row.source_checkup_id ? String(row.source_checkup_id) : undefined,
    relatedMetric: row.related_metric ? String(row.related_metric) : undefined,
    currentValue: row.current_value ? Number(row.current_value) : undefined,
    threshold: row.threshold ? Number(row.threshold) : undefined,
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at ? Number(row.resolved_at) : undefined,
    appliedAt: row.applied_at ? Number(row.applied_at) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    gitCommit: row.git_commit ? String(row.git_commit) : undefined,
  };
}

/** Reset all proposals — intended for testing only */
export function _resetProposals(): void {
  const db = getDb();
  initProposalTables(db);
  db.prepare("DELETE FROM auto_evolve_proposals").run();
}
