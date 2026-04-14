/**
 * Ouroboros Self-Healing System
 * ==============================
 * Ported from OpenClaw ClaudeFusion.
 *
 * Features:
 * - Anomaly detection & classification
 * - Snapshot management with SQLite persistence
 * - Chainable rollback points
 * - Pluggable repair strategies
 */

import type { BaseMessage } from "../types/index.ts";
import { getDb } from "./db-manager.ts";

// =============================================================================
// Types
// =============================================================================

export type ErrorCategory =
  | "tool_execution"
  | "model_call"
  | "memory_failure"
  | "security_violation"
  | "channel_disconnect"
  | "timeout"
  | "unknown";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export interface SystemSnapshot {
  id: string;
  timestamp: number;
  sessionId: string;
  messages: BaseMessage[];
  memoryState: Record<string, unknown>;
  toolStates: Record<string, unknown>;
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RollbackPoint {
  id: string;
  snapshotId: string;
  description: string;
  timestamp: number;
  parentId?: string;
}

export interface RepairResult {
  success: boolean;
  errorCategory: ErrorCategory;
  attempts: number;
  solution?: string;
  rollbackPerformed: boolean;
  newSnapshotId?: string;
}

export interface AnomalyInfo {
  category: ErrorCategory;
  severity: ErrorSeverity;
  error: Error;
  context: Record<string, unknown>;
  timestamp: number;
  recoverable: boolean;
}

export interface RepairStrategy {
  name: string;
  applicableCategories: ErrorCategory[];
  execute: (anomaly: AnomalyInfo, snapshot: SystemSnapshot) => Promise<RepairResult>;
}

export interface SelfHealerConfig {
  maxRepairAttempts: number;
  enableAutoRollback: boolean;
  rollbackThreshold: number;
  snapshotBeforeRepair: boolean;
}

// =============================================================================
// Anomaly Classifier
// =============================================================================

export class AnomalyClassifier {
  private static readonly PATTERNS: Array<{
    category: ErrorCategory;
    patterns: RegExp[];
    severity: ErrorSeverity;
  }> = [
    {
      category: "tool_execution",
      patterns: [
        /tool.*not.*found/i,
        /execution.*failed/i,
        /permission.*denied/i,
        /file.*not.*found/i,
        /tool.*timeout/i,
      ],
      severity: "medium",
    },
    {
      category: "model_call",
      patterns: [
        /rate.*limit/i,
        /model.*error/i,
        /api.*error/i,
        /context.*length/i,
        /token.*exceeded/i,
      ],
      severity: "high",
    },
    {
      category: "memory_failure",
      patterns: [
        /memory.*error/i,
        /allocation.*failed/i,
        /out.*of.*memory/i,
        /snapshot.*corrupt/i,
      ],
      severity: "critical",
    },
    {
      category: "security_violation",
      patterns: [
        /security.*error/i,
        /injection.*detected/i,
        /unauthorized.*access/i,
        /invalid.*input/i,
      ],
      severity: "high",
    },
    {
      category: "channel_disconnect",
      patterns: [
        /connection.*failed/i,
        /channel.*disconnect/i,
        /network.*error/i,
        /timeout.*exceeded/i,
      ],
      severity: "medium",
    },
    {
      category: "timeout",
      patterns: [/timeout/i, /timed.*out/i, /deadline.*exceeded/i],
      severity: "low",
    },
  ];

  classify(error: Error, context?: Record<string, unknown>): AnomalyInfo {
    const message = error.message.toLowerCase();
    for (const { category, patterns, severity } of AnomalyClassifier.PATTERNS) {
      if (patterns.some((p) => p.test(message))) {
        return {
          category,
          severity,
          error,
          context: context ?? {},
          timestamp: Date.now(),
          recoverable: severity !== "critical",
        };
      }
    }
    return {
      category: "unknown",
      severity: "medium",
      error,
      context: context ?? {},
      timestamp: Date.now(),
      recoverable: true,
    };
  }

  isRecoverable(anomaly: AnomalyInfo): boolean {
    if (anomaly.severity === "critical") return false;
    if (anomaly.category === "memory_failure") return false;
    return anomaly.recoverable;
  }
}

// =============================================================================
// Snapshot Manager
// =============================================================================

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
  }

  getSnapshot(id: string): SystemSnapshot | undefined {
    const cached = this.snapshots.get(id);
    if (cached) return cached;
    return this.loadSnapshot(id);
  }

  private loadSnapshot(id: string): SystemSnapshot | undefined {
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
      messages: JSON.parse(row.messages),
      memoryState: JSON.parse(row.memory_state),
      toolStates: JSON.parse(row.tool_states),
      config: JSON.parse(row.config),
      metadata: JSON.parse(row.metadata),
    };
    this.snapshots.set(id, snapshot);
    return snapshot;
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
    for (const [id] of toDelete) {
      this.deleteSnapshot(id);
    }
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
    return rows.map((r) => this.getSnapshot(r.id)).filter((s): s is SystemSnapshot => !!s);
  }
}

// =============================================================================
// Rollback Manager
// =============================================================================

export class RollbackManager {
  private rollbackPoints: Map<string, RollbackPoint> = new Map();
  private snapshotManager: SnapshotManager;

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
  }

  createRollbackPoint(params: { snapshotId: string; description: string; parentId?: string }): RollbackPoint {
    const id = `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const point: RollbackPoint = {
      id,
      snapshotId: params.snapshotId,
      description: params.description,
      timestamp: Date.now(),
      parentId: params.parentId,
    };
    this.rollbackPoints.set(id, point);
    return point;
  }

  getRollbackPoint(id: string): RollbackPoint | undefined {
    return this.rollbackPoints.get(id);
  }

  async performRollback(rollbackPointId: string): Promise<{ success: boolean; snapshot?: SystemSnapshot; error?: string }> {
    const point = this.rollbackPoints.get(rollbackPointId);
    if (!point) return { success: false, error: "Rollback point not found" };

    if (point.parentId) {
      const parentResult = await this.performRollback(point.parentId);
      if (!parentResult.success) return parentResult;
    }

    const snapshot = this.snapshotManager.getSnapshot(point.snapshotId);
    if (!snapshot) return { success: false, error: "Snapshot not found" };
    return { success: true, snapshot };
  }

  getRollbackChain(rollbackPointId: string): RollbackPoint[] {
    const chain: RollbackPoint[] = [];
    let current = this.rollbackPoints.get(rollbackPointId);
    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.rollbackPoints.get(current.parentId) : undefined;
    }
    return chain;
  }

  getAllRollbackPoints(): RollbackPoint[] {
    return [...this.rollbackPoints.values()].sort((a, b) => b.timestamp - a.timestamp);
  }
}

// =============================================================================
// Built-in Repair Strategies
// =============================================================================

const BUILT_IN_STRATEGIES: RepairStrategy[] = [
  {
    name: "tool_retry",
    applicableCategories: ["tool_execution"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Tool execution will be retried with adjusted parameters",
      rollbackPerformed: false,
    }),
  },
  {
    name: "model_fallback",
    applicableCategories: ["model_call"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Model fallback triggered - using backup model",
      rollbackPerformed: false,
    }),
  },
  {
    name: "security_rollback",
    applicableCategories: ["security_violation"],
    execute: async (anomaly) => ({
      success: false,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Security violation detected - manual intervention required",
      rollbackPerformed: false,
    }),
  },
  {
    name: "timeout_retry",
    applicableCategories: ["timeout"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Operation will be retried with extended timeout",
      rollbackPerformed: false,
    }),
  },
];

// =============================================================================
// Self Healer
// =============================================================================

export class SelfHealer {
  private config: SelfHealerConfig;
  private classifier: AnomalyClassifier;
  private snapshotManager: SnapshotManager;
  private rollbackManager: RollbackManager;
  private strategies: RepairStrategy[];
  private failureCount = 0;
  private repairHistory: Array<{ anomaly: AnomalyInfo; result: RepairResult; timestamp: number }> = [];

  constructor(config: Partial<SelfHealerConfig> = {}) {
    this.config = {
      maxRepairAttempts: 3,
      enableAutoRollback: true,
      rollbackThreshold: 5,
      snapshotBeforeRepair: true,
      ...config,
    };
    this.classifier = new AnomalyClassifier();
    this.snapshotManager = new SnapshotManager();
    this.rollbackManager = new RollbackManager(this.snapshotManager);
    this.strategies = [...BUILT_IN_STRATEGIES];
  }

  registerStrategy(strategy: RepairStrategy): void {
    // Remove existing strategy with same name to allow overrides
    this.strategies = this.strategies.filter((s) => s.name !== strategy.name);
    this.strategies.push(strategy);
  }

  unregisterStrategy(name: string): void {
    this.strategies = this.strategies.filter((s) => s.name !== name);
  }

  diagnose(error: Error, context?: Record<string, unknown>): AnomalyInfo {
    return this.classifier.classify(error, context);
  }

  async attemptRepair(params: {
    error: Error;
    context?: Record<string, unknown>;
    currentSnapshot: SystemSnapshot;
  }): Promise<RepairResult> {
    const { error, context, currentSnapshot } = params;
    const anomaly = this.diagnose(error, context);

    if (!this.classifier.isRecoverable(anomaly)) {
      return { success: false, errorCategory: anomaly.category, attempts: 0, rollbackPerformed: false };
    }

    this.failureCount++;

    if (this.config.enableAutoRollback && this.failureCount >= this.config.rollbackThreshold) {
      return this.performRollbackRepair(anomaly, currentSnapshot);
    }

    for (let attempt = 1; attempt <= this.config.maxRepairAttempts; attempt++) {
      const result = await this.executeRepairStrategy(anomaly, currentSnapshot);
      if (result.success) {
        this.failureCount = 0;
        this.recordRepair(anomaly, result);
        return result;
      }
    }

    if (this.config.enableAutoRollback) {
      return this.performRollbackRepair(anomaly, currentSnapshot);
    }

    return {
      success: false,
      errorCategory: anomaly.category,
      attempts: this.config.maxRepairAttempts,
      rollbackPerformed: false,
    };
  }

  private async executeRepairStrategy(anomaly: AnomalyInfo, snapshot: SystemSnapshot): Promise<RepairResult> {
    for (const strategy of this.strategies) {
      if (strategy.applicableCategories.includes(anomaly.category)) {
        try {
          const result = await strategy.execute(anomaly, snapshot);
          return { ...result, attempts: 1 };
        } catch {
          continue;
        }
      }
    }
    return { success: false, errorCategory: anomaly.category, attempts: 1, rollbackPerformed: false };
  }

  private async performRollbackRepair(anomaly: AnomalyInfo, currentSnapshot: SystemSnapshot): Promise<RepairResult> {
    const preRollbackSnapshot = this.config.snapshotBeforeRepair
      ? this.snapshotManager.createSnapshot({
          sessionId: currentSnapshot.sessionId,
          messages: currentSnapshot.messages,
          memoryState: currentSnapshot.memoryState,
          toolStates: currentSnapshot.toolStates,
          config: currentSnapshot.config,
          metadata: { reason: "pre_rollback" },
        })
      : currentSnapshot;

    const stableSnapshot = this.findStableSnapshot(currentSnapshot.sessionId);
    if (!stableSnapshot) {
      return { success: false, errorCategory: anomaly.category, attempts: 0, rollbackPerformed: false };
    }

    let parentRollbackId: string | undefined;
    if (preRollbackSnapshot.id !== stableSnapshot.id) {
      const parentPoint = this.rollbackManager.createRollbackPoint({
        snapshotId: preRollbackSnapshot.id,
        description: `Pre-rollback anchor for: ${anomaly.category}`,
      });
      parentRollbackId = parentPoint.id;
    }

    const rollbackPoint = this.rollbackManager.createRollbackPoint({
      snapshotId: stableSnapshot.id,
      description: `Rollback due to: ${anomaly.category}`,
      parentId: parentRollbackId,
    });

    const result = await this.rollbackManager.performRollback(rollbackPoint.id);
    if (result.success && result.snapshot) {
      return {
        success: true,
        errorCategory: anomaly.category,
        attempts: 1,
        solution: `Rolled back to snapshot ${stableSnapshot.id}`,
        rollbackPerformed: true,
        newSnapshotId: result.snapshot.id,
      };
    }

    return {
      success: false,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Rollback failed",
      rollbackPerformed: false,
    };
  }

  private findStableSnapshot(sessionId?: string): SystemSnapshot | undefined {
    const snapshots = this.snapshotManager.getAllSnapshots(sessionId);
    const current = snapshots.find((s) => s.metadata?.reason === "pre_rollback" || s.metadata?.reason === "repair_failed");
    if (snapshots.length > 1) {
      return snapshots.find((s) => s.id !== current?.id && !s.metadata?.reason);
    }
    return snapshots[0];
  }

  private recordRepair(anomaly: AnomalyInfo, result: RepairResult): void {
    this.repairHistory.push({ anomaly, result, timestamp: Date.now() });
    if (this.repairHistory.length > 100) this.repairHistory.shift();
  }

  createSnapshot(params: Omit<SystemSnapshot, "id" | "timestamp">): SystemSnapshot {
    return this.snapshotManager.createSnapshot(params);
  }

  async performRollback(rollbackPointId: string): Promise<{ success: boolean; snapshot?: SystemSnapshot; error?: string }> {
    return this.rollbackManager.performRollback(rollbackPointId);
  }

  getRepairHistory(): Array<{ anomaly: AnomalyInfo; result: RepairResult; timestamp: number }> {
    return [...this.repairHistory];
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  resetFailureCount(): void {
    this.failureCount = 0;
  }

  getSnapshots(sessionId?: string): SystemSnapshot[] {
    return this.snapshotManager.getAllSnapshots(sessionId);
  }

  getRollbackPoints(): RollbackPoint[] {
    return this.rollbackManager.getAllRollbackPoints();
  }
}

export function createSelfHealer(config?: Partial<SelfHealerConfig>): SelfHealer {
  return new SelfHealer(config);
}
