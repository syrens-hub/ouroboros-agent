/**
 * Crew History
 * ============
 * Persistent storage for crew runs and per-task results.
 */

import { randomUUID } from "crypto";
import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";

export interface CrewRunRecord {
  id: string;
  crewName: string;
  process: string;
  context: string;
  finalOutput: string;
  taskCount: number;
  durationMs: number;
  createdAt: number;
}

export interface CrewTaskRecord {
  id: string;
  crewRunId: string;
  taskId: string;
  agentRole: string;
  description: string;
  result: string;
  createdAt: number;
}

export function initCrewHistoryTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crew_runs (
      id TEXT PRIMARY KEY,
      crew_name TEXT NOT NULL,
      process TEXT NOT NULL,
      context TEXT NOT NULL,
      final_output TEXT NOT NULL,
      task_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crew_runs_created ON crew_runs(created_at);

    CREATE TABLE IF NOT EXISTS crew_run_tasks (
      id TEXT PRIMARY KEY,
      crew_run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      description TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crew_run_tasks_crew ON crew_run_tasks(crew_run_id);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initCrewHistoryTables(db);
}

export function recordCrewRun(
  run: Omit<CrewRunRecord, "id" | "createdAt">
): CrewRunRecord {
  ensureInitialized();
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  const full: CrewRunRecord = { ...run, id, createdAt };

  db.prepare(
    `INSERT INTO crew_runs (id, crew_name, process, context, final_output, task_count, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, run.crewName, run.process, run.context, run.finalOutput, run.taskCount, run.durationMs, createdAt);

  return full;
}

export function recordCrewTask(
  task: Omit<CrewTaskRecord, "id" | "createdAt">
): CrewTaskRecord {
  ensureInitialized();
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  const full: CrewTaskRecord = { ...task, id, createdAt };

  db.prepare(
    `INSERT INTO crew_run_tasks (id, crew_run_id, task_id, agent_role, description, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, task.crewRunId, task.taskId, task.agentRole, task.description, task.result, createdAt);

  return full;
}

export function getCrewRunHistory(limit = 20): CrewRunRecord[] {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, crew_name, process, context, final_output, task_count, duration_ms, created_at
     FROM crew_runs ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as unknown[];

  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      crewName: String(r.crew_name),
      process: String(r.process),
      context: String(r.context),
      finalOutput: String(r.final_output),
      taskCount: Number(r.task_count),
      durationMs: Number(r.duration_ms),
      createdAt: Number(r.created_at),
    };
  });
}

export function getCrewRunTasks(crewRunId: string): CrewTaskRecord[] {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, crew_run_id, task_id, agent_role, description, result, created_at
     FROM crew_run_tasks WHERE crew_run_id = ? ORDER BY created_at`
  ).all(crewRunId) as unknown[];

  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      crewRunId: String(r.crew_run_id),
      taskId: String(r.task_id),
      agentRole: String(r.agent_role),
      description: String(r.description),
      result: String(r.result),
      createdAt: Number(r.created_at),
    };
  });
}

export function getCrewRunMetrics(): { totalRuns: number; avgDurationMs: number; avgTasksPerRun: number } {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) as total, AVG(duration_ms) as avg_duration, AVG(task_count) as avg_tasks FROM crew_runs`
  ).get() as { total: number; avg_duration: number; avg_tasks: number } | undefined;

  return {
    totalRuns: Math.round(row?.total ?? 0),
    avgDurationMs: Math.round((row?.avg_duration ?? 0) * 100) / 100,
    avgTasksPerRun: Math.round((row?.avg_tasks ?? 0) * 100) / 100,
  };
}
