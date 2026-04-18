/**
 * Hybrid Approval Generator
 * =========================
 * Risk-based approval routing for self-evolution.
 *
 * Decision tiers:
 *   - auto    : risk < 20, all safety green
 *   - delayed : 20 ≤ risk < 50, safety green → auto-approves after cooldown
 *   - manual  : risk ≥ 50 or safety yellow → requires human/multi-sig
 *   - denied  : risk ≥ 100 or safety red (frozen, budget exhausted)
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { logger } from "../../core/logger.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

export type ApprovalDecision = "auto" | "delayed" | "manual" | "denied";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  filesChanged: string[];
  riskScore: number;
  estimatedCostUsd?: number;
  description: string;
}

export interface ApprovalRecord {
  id: string;
  decision: ApprovalDecision;
  status: ApprovalStatus;
  riskScore: number;
  filesChanged: string[];
  description: string;
  reason: string;
  delayMs?: number;
  createdAt: number;
  resolvedAt?: number;
}

export interface ApprovalResult {
  decision: ApprovalDecision;
  delayMs?: number;
  reason: string;
  approvalId: string;
}

export interface SafetyStatus {
  frozen: boolean;
  budgetExhausted: boolean;
  locked: boolean;
}

const DEFAULT_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_RISK_THRESHOLD = 20;
const DELAYED_RISK_THRESHOLD = 50;
const DENY_RISK_THRESHOLD = 100;

function genId(): string {
  return `apv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initApprovalTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_approvals (
      id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      risk_score INTEGER,
      files_changed TEXT NOT NULL,
      description TEXT,
      reason TEXT,
      delay_ms INTEGER,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON evolution_approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_created ON evolution_approvals(created_at DESC);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initApprovalTables(db);
}

function serializeFiles(files: string[]): string {
  try {
    return JSON.stringify(files);
  } catch {
    return "[]";
  }
}

function parseFiles(raw: string): string[] {
  return safeJsonParse<string[]>(raw, "approval files") ?? [];
}

export class HybridApprovalGenerator {
  private autoThreshold: number;
  private delayedThreshold: number;
  private denyThreshold: number;
  private defaultDelayMs: number;

  constructor(opts?: {
    autoThreshold?: number;
    delayedThreshold?: number;
    denyThreshold?: number;
    defaultDelayMs?: number;
  }) {
    this.autoThreshold = opts?.autoThreshold ?? AUTO_RISK_THRESHOLD;
    this.delayedThreshold = opts?.delayedThreshold ?? DELAYED_RISK_THRESHOLD;
    this.denyThreshold = opts?.denyThreshold ?? DENY_RISK_THRESHOLD;
    this.defaultDelayMs = opts?.defaultDelayMs ?? DEFAULT_DELAY_MS;
  }

  generateApproval(req: ApprovalRequest, safety?: SafetyStatus): ApprovalResult {
    ensureInitialized();

    let decision: ApprovalDecision;
    let delayMs: number | undefined;
    let reason: string;

    const risk = req.riskScore;

    if (risk >= this.denyThreshold) {
      decision = "denied";
      reason = `Risk score ${risk} exceeds deny threshold (${this.denyThreshold})`;
    } else if (safety?.budgetExhausted) {
      decision = "denied";
      reason = "Budget exhausted";
    } else if (risk >= this.delayedThreshold) {
      decision = "manual";
      reason = `Risk score ${risk} requires manual approval (threshold: ${this.delayedThreshold})`;
    } else if (safety?.frozen) {
      decision = "manual";
      reason = "System is in change freeze period";
    } else if (safety?.locked) {
      decision = "manual";
      reason = "Evolution lock is held by another process";
    } else if (risk >= this.autoThreshold) {
      decision = "delayed";
      delayMs = this.defaultDelayMs;
      reason = `Risk score ${risk} triggers delayed approval (${delayMs}ms cooldown)`;
    } else {
      decision = "auto";
      reason = `Risk score ${risk} below auto threshold (${this.autoThreshold})`;
    }

    const record: ApprovalRecord = {
      id: genId(),
      decision,
      status: decision === "auto" ? "approved" : "pending",
      riskScore: risk,
      filesChanged: req.filesChanged,
      description: req.description,
      reason,
      delayMs,
      createdAt: Date.now(),
      resolvedAt: decision === "auto" ? Date.now() : undefined,
    };

    this._persist(record);

    if (decision === "auto") {
      logger.info("Auto-approved evolution", { approvalId: record.id, risk });
    } else if (decision === "delayed") {
      logger.info("Delayed approval scheduled", { approvalId: record.id, delayMs, risk });
    } else {
      logger.warn("Evolution requires manual approval or denied", { approvalId: record.id, decision, risk });
    }

    return {
      decision,
      delayMs,
      reason,
      approvalId: record.id,
    };
  }

  /** Resolve a delayed approval early (e.g. human reviewed). */
  resolveApproval(approvalId: string, approved: boolean): boolean {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(`SELECT id, status FROM evolution_approvals WHERE id = ?`)
      .get(approvalId) as { id: string; status: string } | undefined;

    if (!row || row.status !== "pending") return false;

    db.prepare(
      `UPDATE evolution_approvals SET status = ?, resolved_at = ? WHERE id = ?`
    ).run(approved ? "approved" : "denied", Date.now(), approvalId);

    return true;
  }

  /** Check if a delayed approval has passed its cooldown. */
  isDelayExpired(approvalId: string): boolean {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(`SELECT created_at, delay_ms, status FROM evolution_approvals WHERE id = ?`)
      .get(approvalId) as { created_at: number; delay_ms: number; status: string } | undefined;

    if (!row || row.status !== "pending") return false;
    if (!row.delay_ms) return false;
    return Date.now() >= row.created_at + row.delay_ms;
  }

  /** Auto-resolve any expired delayed approvals. */
  processExpiredDelays(): number {
    ensureInitialized();
    const db = getDb();
    const now = Date.now();
    const result = db.prepare(
      `UPDATE evolution_approvals
       SET status = 'approved', resolved_at = ?
       WHERE status = 'pending'
         AND decision = 'delayed'
         AND ? >= created_at + delay_ms`
    ).run(now, now) as { changes: number };

    const count = result.changes;
    if (count > 0) {
      logger.info("Auto-resolved delayed approvals", { count });
    }
    return count;
  }

  getApproval(approvalId: string): ApprovalRecord | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, decision, status, risk_score, files_changed, description, reason, delay_ms, created_at, resolved_at
         FROM evolution_approvals WHERE id = ?`
      )
      .get(approvalId) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this._rowToRecord(row);
  }

  listApprovals(status?: ApprovalStatus, limit = 100): ApprovalRecord[] {
    ensureInitialized();
    const db = getDb();
    const sql = status
      ? `SELECT id, decision, status, risk_score, files_changed, description, reason, delay_ms, created_at, resolved_at
         FROM evolution_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, decision, status, risk_score, files_changed, description, reason, delay_ms, created_at, resolved_at
         FROM evolution_approvals ORDER BY created_at DESC LIMIT ?`;

    const rows = db.prepare(sql).all(status ? [status, limit] : [limit]) as Record<string, unknown>[];
    return rows.map((r) => this._rowToRecord(r));
  }

  private _persist(record: ApprovalRecord): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO evolution_approvals (id, decision, status, risk_score, files_changed, description, reason, delay_ms, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.decision,
      record.status,
      record.riskScore,
      serializeFiles(record.filesChanged),
      record.description,
      record.reason,
      record.delayMs ?? null,
      record.createdAt,
      record.resolvedAt ?? null
    );
  }

  private _rowToRecord(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: String(row.id),
      decision: String(row.decision) as ApprovalDecision,
      status: String(row.status) as ApprovalStatus,
      riskScore: Number(row.risk_score),
      filesChanged: parseFiles(String(row.files_changed)),
      description: String(row.description ?? ""),
      reason: String(row.reason ?? ""),
      delayMs: row.delay_ms ? Number(row.delay_ms) : undefined,
      createdAt: Number(row.created_at),
      resolvedAt: row.resolved_at ? Number(row.resolved_at) : undefined,
    };
  }
}

export const approvalGenerator = new HybridApprovalGenerator();
