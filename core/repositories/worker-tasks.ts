/**
 * Worker Tasks Repository
 * =======================
 * Persist queued/running worker tasks to survive process restarts.
 */

import { getDb } from "../db-manager.ts";

export interface WorkerTaskRow {
  id: number;
  parent_session_id: string;
  worker_session_id: string;
  task_name: string | null;
  task_description: string | null;
  allowed_tools: string | null;
  status: "queued" | "running" | "completed" | "failed";
  result: string | null;
  error: string | null;
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export function insertWorkerTask(
  entry: Omit<WorkerTaskRow, "id" | "created_at" | "started_at" | "completed_at">
): { success: true; id: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO worker_tasks (parent_session_id, worker_session_id, task_name, task_description, allowed_tools, status, result, error, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.parent_session_id,
      entry.worker_session_id,
      entry.task_name ?? null,
      entry.task_description ?? null,
      entry.allowed_tools ?? null,
      entry.status,
      entry.result ?? null,
      entry.error ?? null,
      entry.priority ?? 0
    );
    return { success: true, id: Number((result as { lastInsertRowid: number | bigint }).lastInsertRowid) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function updateWorkerTask(
  id: number,
  partial: Partial<Pick<WorkerTaskRow, "status" | "result" | "error" | "started_at" | "completed_at">>
): { success: true; changes: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (partial.status !== undefined) {
      sets.push("status = ?");
      params.push(partial.status);
    }
    if (partial.result !== undefined) {
      sets.push("result = ?");
      params.push(partial.result);
    }
    if (partial.error !== undefined) {
      sets.push("error = ?");
      params.push(partial.error);
    }
    if (partial.started_at !== undefined) {
      sets.push("started_at = ?");
      params.push(partial.started_at);
    }
    if (partial.completed_at !== undefined) {
      sets.push("completed_at = ?");
      params.push(partial.completed_at);
    }
    if (sets.length === 0) return { success: true, changes: 0 };
    const sql = `UPDATE worker_tasks SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);
    const result = db.prepare(sql).run(...params);
    return { success: true, changes: (result as { changes: number }).changes };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function listPendingWorkerTasks(): { success: true; data: WorkerTaskRow[] } | { success: false; error: string } {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM worker_tasks WHERE status IN ('queued', 'running') ORDER BY priority DESC, created_at ASC`
    ).all() as WorkerTaskRow[];
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function deleteWorkerTask(id: number): { success: true; changes: number } | { success: false; error: string } {
  try {
    const db = getDb();
    const result = db.prepare("DELETE FROM worker_tasks WHERE id = ?").run(id);
    return { success: true, changes: (result as { changes: number }).changes };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
