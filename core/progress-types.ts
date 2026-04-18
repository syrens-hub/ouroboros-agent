/**
 * Ouroboros Progress Types
 * =========================
 * Shared types and interfaces for progress reporting.
 */

export type CheckpointStatus = "pending" | "active" | "completed" | "skipped" | "error" | "warning";

export interface Checkpoint {
  readonly id: string;
  readonly label: string;
  status: CheckpointStatus;
  message?: string;
  timestamp?: number;
  durationMs?: number;
}

export interface ProgressReport {
  currentStep: number;
  totalSteps: number;
  message: string;
  percent: number;
  estimatedTimeRemaining?: number; // milliseconds
  checkpoints: Checkpoint[];
}

export type ProgressEventType = "start" | "update" | "step" | "checkpoint" | "complete" | "error" | "warning" | "clear";

export interface ProgressEvent {
  readonly type: ProgressEventType;
  readonly report: ProgressReport;
  readonly timestamp: number;
  readonly detail?: Record<string, unknown>;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface ProgressReporterOptions {
  readonly label?: string;
  readonly totalSteps?: number;
  readonly showETA?: boolean;
  readonly showCheckpoints?: boolean;
  readonly trackTime?: boolean;
}
