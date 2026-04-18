/**
 * Ouroboros Progress Reporter
 * ==============================
 * Devin-style progress reporting with multi-level progress bars,
 * ETA calculation, checkpoint recording, and TTY/non-TTY output.
 */

import {
  type Checkpoint,
  type CheckpointStatus,
  type ProgressEvent,
  type ProgressEventType,
  type ProgressListener,
  type ProgressReport,
  type ProgressReporterOptions,
} from "./progress-types.ts";
import {
  clearLine,
  color,
  isTTY,
  moveUp,
  renderFinal,
  renderProgressLine,
} from "./progress-renderer.ts";
import { LogProgressReporter } from "./log-progress-reporter.ts";

// -----------------------------------------------------------------------------
// Sub-progress tracker (nested within a step)
// -----------------------------------------------------------------------------

export class SubProgress {
  private readonly _parent: MultiProgressReporter;
  private readonly _stepIndex: number;
  private _subStep = 0;
  private _subTotal = 10;
  private _subMessage = "";

  constructor(parent: MultiProgressReporter, stepIndex: number) {
    this._parent = parent;
    this._stepIndex = stepIndex;
  }

  setTotal(total: number): void {
    this._subTotal = total;
  }

  update(message: string, subStep?: number): void {
    this._subStep = subStep ?? this._subStep + 1;
    this._subMessage = message;
    this._parent.updateChildProgress(this._stepIndex, this._subStep, this._subTotal, message);
  }

  complete(message = "done"): void {
    this._subStep = this._subTotal;
    this._subMessage = message;
    this._parent.updateChildProgress(this._stepIndex, this._subTotal, this._subTotal, message);
  }
}

// -----------------------------------------------------------------------------
// Main Progress Reporter
// -----------------------------------------------------------------------------

export class ProgressReporter {
  private readonly _label: string;
  private _currentStep = 0;
  private _totalSteps: number;
  private _message = "";
  private _checkpoints: Checkpoint[] = [];
  private _startTime = 0;
  private _listeners: ProgressListener[] = [];
  private _spinnerFrame = 0;
  private _interactive = isTTY;
  private readonly _trackTime: boolean;
  private readonly _showETA: boolean;
  private _completed = false;
  private _errorMsg: string | undefined;
  private _warningMsg: string | undefined;
  private _childProgress: Array<{ subStep: number; subTotal: number; subMessage: string }> = [];

  constructor(opts: ProgressReporterOptions = {}) {
    this._label = opts.label ?? "Progress";
    this._totalSteps = opts.totalSteps ?? 100;
    this._trackTime = opts.trackTime ?? true;
    this._showETA = opts.showETA ?? true;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get report(): ProgressReport {
    return {
      currentStep: this._currentStep,
      totalSteps: this._totalSteps,
      message: this._message,
      percent: this._calcPercent(),
      estimatedTimeRemaining: this._calcETA(),
      checkpoints: this._checkpoints,
    };
  }

  onProgress(listener: ProgressListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  start(message = "Starting...", totalSteps?: number): this {
    if (totalSteps !== undefined) this._totalSteps = totalSteps;
    this._message = message;
    this._currentStep = 0;
    this._startTime = Date.now();
    this._completed = false;
    this._errorMsg = undefined;
    this._warningMsg = undefined;
    this._checkpoints = [];
    this._childProgress = [];
    this._emit("start");
    this._render();
    return this;
  }

  update(message: string, step?: number): this {
    this._message = message;
    if (step !== undefined) this._currentStep = step;
    this._emit("update");
    this._render();
    return this;
  }

  step(message: string): this {
    this._currentStep = Math.min(this._currentStep + 1, this._totalSteps);
    this._message = message;
    this._emit("step");
    this._render();
    return this;
  }

  checkpoint(id: string, label: string, status: CheckpointStatus = "active", message?: string): this {
    const existing = this._checkpoints.find((c) => c.id === id);
    if (existing) {
      existing.status = status;
      existing.message = message;
      existing.timestamp = Date.now();
    } else {
      this._checkpoints.push({ id, label, status, message, timestamp: Date.now() });
    }
    this._emit("checkpoint");
    this._render();
    return this;
  }

  completeCheckpoint(id: string, message?: string): this {
    const cp = this._checkpoints.find((c) => c.id === id);
    if (cp) {
      cp.status = "completed";
      cp.message = message;
      cp.timestamp = Date.now();
    }
    this._emit("checkpoint");
    this._render();
    return this;
  }

  error(message: string): this {
    this._errorMsg = message;
    this._completed = true;
    this._emit("error");
    this._renderFinal(`[${color("\x1b[31m", "ERROR")}] ${message}`);
    return this;
  }

  warning(message: string): this {
    this._warningMsg = message;
    this._emit("warning");
    this._render();
    return this;
  }

  complete(message = "Done"): this {
    this._currentStep = this._totalSteps;
    this._message = message;
    this._completed = true;
    this._emit("complete");
    this._renderFinal(message);
    return this;
  }

  setProgress(currentStep: number, totalSteps: number, message?: string): this {
    this._currentStep = Math.max(0, Math.min(currentStep, totalSteps));
    if (totalSteps !== this._totalSteps) this._totalSteps = totalSteps;
    if (message) this._message = message;
    this._emit("update");
    this._render();
    return this;
  }

  clear(): void {
    this._emit("clear");
    if (isTTY) {
      clearLine();
      moveUp(1);
      clearLine();
    }
  }

  createSubProgress(): SubProgress {
    const idx = this._currentStep;
    if (!this._childProgress[idx]) {
      this._childProgress[idx] = { subStep: 0, subTotal: 10, subMessage: "" };
    }
    return new SubProgress(this as unknown as MultiProgressReporter, idx);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _calcPercent(): number {
    if (this._totalSteps === 0) return 0;
    return Math.min(100, Math.round((this._currentStep / this._totalSteps) * 100));
  }

  private _calcETA(): number | undefined {
    if (!this._trackTime || this._startTime === 0 || this._currentStep === 0) return undefined;
    const elapsed = Date.now() - this._startTime;
    const rate = this._currentStep / elapsed;
    if (rate === 0) return undefined;
    const remaining = this._totalSteps - this._currentStep;
    return Math.round(remaining / rate);
  }

  private _emit(type: ProgressEventType, detail?: Record<string, unknown>): void {
    const event: ProgressEvent = {
      type,
      report: this.report,
      timestamp: Date.now(),
      detail,
    };
    for (const l of this._listeners) {
      try { l(event); } catch { /* ignore listener errors */ }
    }
  }

  private _render(): void {
    if (!this._interactive) return;
    clearLine();
    const output = this._renderToString();
    this._lastRender = output;
    process.stdout.write(output);
  }

  private _lastRender = "";

  private _renderToString(): string {
    const childActive = this._childProgress.findIndex(
      (c) => c.subStep > 0 && c.subStep < c.subTotal
    );
    return renderProgressLine({
      label: this._label,
      percent: this._calcPercent(),
      currentStep: this._currentStep,
      totalSteps: this._totalSteps,
      message: this._message,
      showETA: this._showETA,
      etaMs: this._calcETA(),
      spinnerFrame: ++this._spinnerFrame % 10,
      childProgress: childActive >= 0 ? this._childProgress[childActive] : null,
      checkpoints: this._checkpoints,
      warningMsg: this._warningMsg,
      errorMsg: this._errorMsg,
    });
  }

  private _renderFinal(message: string): void {
    if (!this._interactive) {
      renderFinal(this._label, message);
      return;
    }
    clearLine();
    renderFinal(this._label, message);
  }
}

// -----------------------------------------------------------------------------
// Multi-step Progress (manages multiple concurrent progress reporters)
// -----------------------------------------------------------------------------

export class MultiProgressReporter {
  private readonly _reporters = new Map<string, ProgressReporter>();
  private _activeId: string | null = null;

  get(id: string): ProgressReporter | undefined {
    return this._reporters.get(id);
  }

  create(id: string, opts: ProgressReporterOptions = {}): ProgressReporter {
    const r = new ProgressReporter(opts);
    this._reporters.set(id, r);
    this._activeId = id;
    return r;
  }

  setActive(id: string): void {
    if (!this._reporters.has(id)) throw new Error(`Progress reporter '${id}' not found`);
    this._activeId = id;
  }

  delete(id: string): void {
    this._reporters.get(id)?.clear();
    this._reporters.delete(id);
    if (this._activeId === id) {
      const keys = Array.from(this._reporters.keys());
      this._activeId = keys.length > 0 ? keys[0] : null;
    }
  }

  renderAll(): void {
    if (!isTTY) return;
    const ids = Array.from(this._reporters.keys());
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) moveUp(1);
    }
    for (const id of ids) {
      const r = this._reporters.get(id)!;
      const marker = id === this._activeId ? "›" : " ";
      clearLine();
      process.stdout.write(`${marker} ${r.report.message} [${r.report.currentStep}/${r.report.totalSteps}] ${r.report.percent}%`);
      if (Number(ids.indexOf(id)) < ids.length - 1) process.stdout.write("\n");
    }
  }

  // Called by SubProgress
  updateChildProgress(_stepIndex: number, _subStep: number, _subTotal: number, _subMessage: string): void {
    // Child progress is tracked within the reporter's own _childProgress array
    // The parent reporter's _render will pick this up on next call
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createProgressReporter(opts?: ProgressReporterOptions): ProgressReporter {
  return new ProgressReporter(opts);
}

export function createMultiProgressReporter(): MultiProgressReporter {
  return new MultiProgressReporter();
}

export function createLogProgressReporter(name: string): LogProgressReporter {
  return new LogProgressReporter(name);
}
