/**
 * Snapshot Manager
 * =================
 * Manages system snapshots with SQLite persistence.
 */

import { getDb } from "../../core/db-manager.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";
import type { SystemSnapshot } from "./self-healing-types.ts";
import type { BaseMessage } from "../../types/index.ts";

export class SnapshotManager {
  private snapshots: Map<string, SystemSnapshot> = new Map();
  private maxSnapshots: number;

  constructor(maxSnapshots = 50) {
    this.maxSnapshots = maxSnapshots;
  }

  createSnapshot(params: Omit<SystemSnapshot, "id" | "timestamp">): SystemSnapshot {
    const id = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const snapshot: SystemSnapshot = {
      id,
      timestamp: Date.now(),
      ...params,
    };
    this.snapshots.set(id, snapshot);
    this.persistSnapshot(snapshot);
    this.cleanupOldSnapshots();
    return snapshot;
  }

  private persistSnapshot(snapshot: SystemSnapshot): void {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO snapshots (id, session_id, timestamp, messages, memory_state, tool_states, config, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         session_id=excluded.session_id,
         timestamp=excluded.timestamp,
         messages=excluded.messages,
         memory_state=excluded.memory_state,
         tool_states=excluded.tool_states,
         config=excluded.config,
         metadata=excluded.metadata`
    );
    // Run in transaction to avoid blocking the event loop
    db.transaction(() => {
      stmt.run(
        snapshot.id,
        snapshot.sessionId,
        snapshot.timestamp,
        JSON.stringify(snapshot.messages),
        JSON.stringify(snapshot.memoryState),
        JSON.stringify(snapshot.toolStates),
        JSON.stringify(snapshot.config),
        JSON.stringify(snapshot.metadata ?? {})
      );
    })();
  }

  getSnapshot(id: string, skipCache = false): SystemSnapshot | undefined {
    if (!skipCache) {
      const cached = this.snapshots.get(id);
      if (cached) return cached;
    }
    return this.loadSnapshot(id);
  }

  /** Loads directly from DB without hitting cache. Used by getAllSnapshots() to avoid N+1. */
  private loadSnapshotDirect(id: string): SystemSnapshot | undefined {
    const db = getDb();
    const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as
      | {
          id: string;
          session_id: string;
          timestamp: number;
          messages: string;
          memory_state: string;
          tool_states: string;
          config: string;
          metadata: string;
        }
      | undefined;
    if (!row) return undefined;
    const snapshot: SystemSnapshot = {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      messages: safeJsonParse<BaseMessage[]>(row.messages, "snapshot messages") ?? [],
      memoryState: safeJsonParse<Record<string, unknown>>(row.memory_state, "snapshot memory") ?? {},
      toolStates: safeJsonParse<Record<string, unknown>>(row.tool_states, "snapshot tools") ?? {},
      config: safeJsonParse<Record<string, unknown>>(row.config, "snapshot config") ?? {},
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, "snapshot metadata") ?? {},
    };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  private loadSnapshot(id: string): SystemSnapshot | undefined {
    return this.loadSnapshotDirect(id);
  }

  getLatestSnapshot(sessionId?: string): SystemSnapshot | undefined {
    const db = getDb();
    const row = db
      .prepare(
        sessionId
          ? "SELECT id FROM snapshots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1"
          : "SELECT id FROM snapshots ORDER BY timestamp DESC LIMIT 1"
      )
      .get(sessionId) as { id: string } | undefined;
    return row ? this.getSnapshot(row.id) : undefined;
  }

  deleteSnapshot(id: string): boolean {
    const db = getDb();
    db.prepare("DELETE FROM snapshots WHERE id = ?").run(id);
    return this.snapshots.delete(id);
  }

  private cleanupOldSnapshots(): void {
    if (this.snapshots.size <= this.maxSnapshots) return;
    const sorted = [...this.snapshots.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = sorted.slice(0, this.snapshots.size - this.maxSnapshots);
    // Batch-delete in a transaction to avoid N sequential writes
    const db = getDb();
    const deleteStmt = db.prepare("DELETE FROM snapshots WHERE id = ?");
    db.transaction(() => {
      for (const [id] of toDelete) {
        deleteStmt.run(id);
        this.snapshots.delete(id);
      }
    })();
  }

  getAllSnapshots(sessionId?: string): SystemSnapshot[] {
    const db = getDb();
    const rows = db
      .prepare(
        sessionId
          ? "SELECT id FROM snapshots WHERE session_id = ? ORDER BY timestamp DESC"
          : "SELECT id FROM snapshots ORDER BY timestamp DESC"
      )
      .all(sessionId) as { id: string }[];
    // Load directly from DB without cache to avoid N+1 queries
    return rows.map((r) => this.loadSnapshotDirect(r.id)).filter((s): s is SystemSnapshot => !!s);
  }
}
