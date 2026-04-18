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
 *
 * This module re-exports from focused sub-modules for backward compatibility.
 * For direct imports of specific functionality, import from the sub-modules:
 * - self-healing-types.ts  : Core types and interfaces
 * - anomaly-classifier.ts   : Anomaly classification logic
 * - snapshot-manager.ts     : Snapshot management
 * - rollback-manager.ts    : Rollback point management
 * - repair-strategies.ts   : Built-in repair strategies
 * - self-healer.ts         : Main SelfHealer orchestrator
 * - canary-runner.ts       : Canary test runner
 */

export {
  AnomalyClassifier,
} from "./anomaly-classifier.ts";

export {
  SnapshotManager,
} from "./snapshot-manager.ts";

export {
  RollbackManager,
} from "./rollback-manager.ts";

export {
  BUILT_IN_STRATEGIES,
} from "./repair-strategies.ts";

export {
  SelfHealer,
  createSelfHealer,
} from "./self-healer.ts";

export {
  runCanaryTests,
} from "./canary-runner.ts";

// Re-export all types
export type {
  ErrorCategory,
  ErrorSeverity,
  SystemSnapshot,
  RollbackPoint,
  RepairResult,
  AnomalyInfo,
  RepairStrategy,
  SelfHealerConfig,
} from "./self-healing-types.ts";
