/**
 * Rollback Manager
 * ================
 * Manages rollback points for system recovery.
 */

import type { RollbackPoint, SystemSnapshot } from "./self-healing-types.ts";
import type { SnapshotManager } from "./snapshot-manager.ts";

export class RollbackManager {
  private rollbackPoints: Map<string, RollbackPoint> = new Map();
  private snapshotManager: SnapshotManager;
  private static readonly MAX_ROLLBACK_POINTS = 1000;

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
  }

  createRollbackPoint(params: { snapshotId: string; description: string; parentId?: string }): RollbackPoint {
    // Enforce max limit of 1000 rollback points — delete oldest when exceeded
    if (this.rollbackPoints.size >= RollbackManager.MAX_ROLLBACK_POINTS) {
      const oldest = [...this.rollbackPoints.values()].sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldest) {
        this.rollbackPoints.delete(oldest.id);
      }
    }
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
