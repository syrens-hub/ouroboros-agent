/**
 * Evolution Auto-Execution Daemon
 * ================================
 * Automatically executes approved evolutions and publishes
 * lifecycle events via the EventBus.
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { eventBus } from "../../core/event-bus.ts";
import { logger } from "../../core/logger.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";
import { initEvolutionVersionTables } from "../evolution-version-manager/index.ts";
import { executeEvolution } from "../evolution-orchestrator/index.ts";
import { changeFreezePeriod } from "../safety-controls/index.ts";

export interface ExecutionRecord {
  id: string;
  versionId: string;
  status: "queued" | "running" | "completed" | "failed" | "rolled_back";
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  testRunId: string | null;
}

export interface ExecutionDaemonConfig {
  pollIntervalMs: number;
  maxConcurrent: number;
  ownerId: string;
  enabled: boolean;
}

function genId(): string {
  return `exe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initExecutionTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_executions (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      test_run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_executions_status ON evolution_executions(status);
    CREATE INDEX IF NOT EXISTS idx_executions_version ON evolution_executions(version_id);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initEvolutionVersionTables(db);
  initExecutionTables(db);
}

export class ExecutionDaemon {
  private config: ExecutionDaemonConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private activeExecutions = 0;

  constructor(config?: Partial<ExecutionDaemonConfig>) {
    this.config = {
      pollIntervalMs: 10_000,
      maxConcurrent: 1,
      ownerId: "auto-executor",
      enabled: true,
      ...config,
    };
  }

  start(): void {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    ensureInitialized();
    logger.info("Evolution Execution Daemon started", { intervalMs: this.config.pollIntervalMs });
    this.tick().catch((e) => {
      logger.error("Execution daemon initial tick error", { error: String(e) });
    });
    this.timer = setInterval(() => {
      this.tick().catch((e) => {
        logger.error("Execution daemon tick error", { error: String(e) });
      });
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Evolution Execution Daemon stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (changeFreezePeriod.isFrozen()) {
      logger.debug("Execution daemon skipped: system is in freeze period");
      return;
    }
    if (this.activeExecutions >= this.config.maxConcurrent) {
      logger.debug("Execution daemon skipped: max concurrent reached", {
        active: this.activeExecutions,
      });
      return;
    }

    const pending = this._findPendingVersion();
    if (!pending) return;

    this.activeExecutions++;
    try {
      await this._execute(pending);
    } finally {
      this.activeExecutions--;
    }
  }

  private _findPendingVersion(): { versionId: string; filesChanged: string[] } | undefined {
    ensureInitialized();
    const db = getDb();

    // Find approved versions that have not been applied yet
    // and do not have a running/failed execution record
    const row = db
      .prepare(
        `SELECT v.id, v.files_changed
         FROM evolution_versions v
         LEFT JOIN evolution_executions e ON e.version_id = v.id
         WHERE v.approval_status IN ('approved','auto')
           AND v.applied_at IS NULL
           AND (e.status IS NULL OR e.status = 'queued')
         ORDER BY v.created_at ASC
         LIMIT 1`
      )
      .get() as { id: string; files_changed: string } | undefined;

    if (!row) return undefined;

    const filesChanged = safeJsonParse<string[]>(row.files_changed, "execution files") ?? [];
    return { versionId: row.id, filesChanged };
  }

  private async _execute(pending: { versionId: string; filesChanged: string[] }): Promise<void> {
    const { versionId, filesChanged } = pending;
    ensureInitialized();
    const db = getDb();
    const execId = genId();

    db.prepare(
      `INSERT INTO evolution_executions (id, version_id, status, started_at)
       VALUES (?, ?, 'running', ?)`
    ).run(execId, versionId, Date.now());

    eventBus.emitAsync("evolution:executed", {
      versionId,
      executionId: execId,
      status: "started",
      sessionId: this.config.ownerId,
    });

    logger.info("Auto-executing evolution", { versionId, executionId: execId });

    const result = await executeEvolution(versionId, filesChanged, this.config.ownerId);

    if (result.success) {
      db.prepare(
        `UPDATE evolution_executions SET status = 'completed', completed_at = ?, test_run_id = ? WHERE id = ?`
      ).run(Date.now(), result.testRunId ?? null, execId);

      eventBus.emitAsync("evolution:executed", {
        versionId,
        executionId: execId,
        status: "completed",
        testRunId: result.testRunId,
        sessionId: this.config.ownerId,
      });

      logger.info("Auto-execution completed", { versionId, executionId: execId });
    } else {
      db.prepare(
        `UPDATE evolution_executions SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`
      ).run(Date.now(), result.message, execId);

      eventBus.emitAsync("evolution:failed", {
        versionId,
        executionId: execId,
        stage: result.stage,
        error: result.message,
        sessionId: this.config.ownerId,
      });

      logger.warn("Auto-execution failed", { versionId, executionId: execId, error: result.message });
    }
  }

  getExecution(execId: string): ExecutionRecord | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, version_id, status, started_at, completed_at, error, test_run_id
         FROM evolution_executions WHERE id = ?`
      )
      .get(execId) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return {
      id: String(row.id),
      versionId: String(row.version_id),
      status: String(row.status) as ExecutionRecord["status"],
      startedAt: row.started_at ? Number(row.started_at) : null,
      completedAt: row.completed_at ? Number(row.completed_at) : null,
      error: row.error ? String(row.error) : null,
      testRunId: row.test_run_id ? String(row.test_run_id) : null,
    };
  }

  listExecutions(status?: ExecutionRecord["status"], limit = 50): ExecutionRecord[] {
    ensureInitialized();
    const db = getDb();
    const sql = status
      ? `SELECT id, version_id, status, started_at, completed_at, error, test_run_id
         FROM evolution_executions WHERE status = ? ORDER BY started_at DESC LIMIT ?`
      : `SELECT id, version_id, status, started_at, completed_at, error, test_run_id
         FROM evolution_executions ORDER BY started_at DESC LIMIT ?`;

    const rows = db.prepare(sql).all(status ? [status, limit] : [limit]) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      versionId: String(r.version_id),
      status: String(r.status) as ExecutionRecord["status"],
      startedAt: r.started_at ? Number(r.started_at) : null,
      completedAt: r.completed_at ? Number(r.completed_at) : null,
      error: r.error ? String(r.error) : null,
      testRunId: r.test_run_id ? String(r.test_run_id) : null,
    }));
  }
}

export const executionDaemon = new ExecutionDaemon();
