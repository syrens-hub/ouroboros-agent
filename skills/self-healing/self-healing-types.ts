/**
 * Self-Healing Types
 * ==================
 * Core type definitions for the self-healing system.
 */

import type { BaseMessage } from "../../types/index.ts";

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
