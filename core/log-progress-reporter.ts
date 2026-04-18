/**
 * Ouroboros Log Progress Reporter
 * ===============================
 * Structured log-based progress reporting (non-TTY output).
 */

import { logger } from "./logger.ts";
import type { Checkpoint, CheckpointStatus } from "./progress-types.ts";

export class LogProgressReporter {
  private readonly _name: string;
  private readonly _checkpoints: Checkpoint[] = [];
  private _startTime = 0;

  constructor(name: string) {
    this._name = name;
  }

  start(message: string, totalSteps: number): void {
    this._startTime = Date.now();
    this._checkpoints.length = 0;
    logger.info(`[${this._name}] Start: ${message}`, { totalSteps });
  }

  step(message: string, currentStep: number, totalSteps: number): void {
    const pct = Math.round((currentStep / totalSteps) * 100);
    logger.info(`[${this._name}] Step ${currentStep}/${totalSteps} (${pct}%): ${message}`);
  }

  checkpoint(id: string, label: string, status: CheckpointStatus, message?: string): void {
    const cp: Checkpoint = { id, label, status, message, timestamp: Date.now() };
    this._checkpoints.push(cp);
    const icon = status === "completed" ? "✓" : status === "error" ? "✗" : status === "warning" ? "⚠" : "›";
    logger.info(`[${this._name}] Checkpoint ${icon} ${label}${message ? `: ${message}` : ""}`, { id, status });
  }

  complete(message: string): void {
    const duration = this._startTime ? Date.now() - this._startTime : 0;
    const done = this._checkpoints.filter((c) => c.status === "completed").length;
    logger.info(`[${this._name}] Complete: ${message}`, { durationMs: duration, checkpointsPassed: done });
  }

  error(message: string): void {
    logger.error(`[${this._name}] Error: ${message}`, { checkpoints: this._checkpoints });
  }
}
