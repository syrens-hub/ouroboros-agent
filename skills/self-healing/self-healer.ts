/**
 * Self Healer
 * ===========
 * Main orchestrator for self-healing operations.
 */

import { restoreCheckpoint, listCheckpoints } from "../checkpoint/index.ts";
import { logger } from "../../core/logger.ts";
import { AnomalyClassifier } from "./anomaly-classifier.ts";
import { SnapshotManager } from "./snapshot-manager.ts";
import { RollbackManager } from "./rollback-manager.ts";
import { BUILT_IN_STRATEGIES } from "./repair-strategies.ts";
import type {
  AnomalyInfo,
  RepairResult,
  RepairStrategy,
  SelfHealerConfig,
  SystemSnapshot,
} from "./self-healing-types.ts";

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

  private async attemptCheckpointRollback(sessionId: string, anomaly: AnomalyInfo): Promise<RepairResult | null> {
    const checkpoints = listCheckpoints(sessionId);
    if (checkpoints.length === 0) return null;
    const latest = checkpoints[0];
    const result = restoreCheckpoint(latest.id);
    if (result.success) {
      logger.info("Self-healing performed checkpoint rollback", { checkpointId: latest.id, sessionId });
      return {
        success: true,
        errorCategory: anomaly.category,
        attempts: 1,
        solution: `Rolled back to checkpoint ${latest.id}`,
        rollbackPerformed: true,
        newSnapshotId: latest.id,
      };
    }
    logger.warn("Checkpoint rollback failed, falling back to snapshot rollback", { checkpointId: latest.id, error: result.error });
    return null;
  }

  private async performRollbackRepair(anomaly: AnomalyInfo, currentSnapshot: SystemSnapshot): Promise<RepairResult> {
    // Try git checkpoint rollback first
    if (currentSnapshot.sessionId) {
      const cpResult = await this.attemptCheckpointRollback(currentSnapshot.sessionId, anomaly);
      if (cpResult) return cpResult;
    }

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

  getRollbackPoints() {
    return this.rollbackManager.getAllRollbackPoints();
  }
}

export function createSelfHealer(config?: Partial<SelfHealerConfig>): SelfHealer {
  return new SelfHealer(config);
}
