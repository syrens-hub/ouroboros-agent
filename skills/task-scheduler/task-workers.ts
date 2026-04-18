/**
 * Task Workers
 * ===========
 * Worker pool management extracted from task-scheduler.
 * Handles task execution, timeout, retry logic, and worker pool.
 */

import type { Task, TaskResult } from "./task-scheduler-types.ts";
import { TaskPrioritizer } from "./task-prioritizer.ts";

export interface TaskWorkerOptions {
  prioritizer: TaskPrioritizer;
  defaultTimeout?: number;
  defaultRetryDelay?: number;
}

export class TaskWorkers {
  private handlers: Map<string, (task: Task) => Promise<unknown>>;
  private retryTimers: Map<string, ReturnType<typeof setTimeout>>;
  private prioritizer: TaskPrioritizer;
  private readonly defaultTimeout: number;
  private readonly defaultRetryDelay: number;

  constructor(options: TaskWorkerOptions) {
    this.handlers = new Map();
    this.retryTimers = new Map();
    this.prioritizer = options.prioritizer;
    this.defaultTimeout = options.defaultTimeout || 30000;
    this.defaultRetryDelay = options.defaultRetryDelay || 5000;
  }

  /**
   * Register a task handler
   */
  registerHandler(taskId: string, handler: (task: Task) => Promise<unknown>): void {
    this.handlers.set(taskId, handler);
  }

  /**
   * Remove a task handler
   */
  removeHandler(taskId: string): void {
    this.handlers.delete(taskId);
  }

  /**
   * Execute a task by ID
   */
  async executeTask(
    taskId: string,
    task: Task,
    emit: (event: string, data: unknown) => void
  ): Promise<TaskResult> {
    const handler = this.handlers.get(taskId);
    if (!handler) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Check if already running (double-check via prioritizer)
    if (this.prioritizer.isRunning(taskId)) {
      emit("task_skipped", { taskId, reason: "Already running" });
      return { taskId, success: false, error: "Task already running", duration: 0, runAt: Date.now() };
    }

    this.prioritizer.markRunning(taskId);
    task.status = "running";
    task.lastRunAt = Date.now();

    const startTime = Date.now();
    let result: TaskResult;

    try {
      const timeout = task.options.timeout || this.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Task timeout")), timeout)
      );

      const executionPromise = handler(task);
      const actualResult = await Promise.race([executionPromise, timeoutPromise]);

      task.runCount++;
      task.status = "completed";
      task.lastError = undefined;

      result = {
        taskId,
        success: true,
        result: actualResult,
        duration: Date.now() - startTime,
        runAt: task.lastRunAt,
      };

      emit("task_completed", result);
    } catch (error) {
      result = await this.handleTaskError(taskId, task, error, startTime, emit);
    } finally {
      this.prioritizer.markDone(taskId);
    }

    return result;
  }

  private async handleTaskError(
    taskId: string,
    task: Task,
    error: unknown,
    startTime: number,
    emit: (event: string, data: unknown) => void
  ): Promise<TaskResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    task.errorCount++;
    task.lastError = errorMessage;

    const maxRetries = task.options.maxRetries || 0;
    if (task.errorCount <= maxRetries) {
      task.status = "pending";
      const retryDelay = task.options.retryDelay || this.defaultRetryDelay;
      const retryTimer = setTimeout(async () => {
        await this.executeTask(taskId, task, emit);
      }, retryDelay);
      this.retryTimers.set(taskId, retryTimer);

      emit("task_retry", { taskId, attempt: task.errorCount, delay: retryDelay });
    } else {
      task.status = "failed";
      emit("task_failed", { taskId, error: errorMessage });
    }

    return {
      taskId,
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
      runAt: task.lastRunAt || Date.now(),
    };
  }

  private cleanupRetryTimer(taskId: string): void {
    const retryTimer = this.retryTimers.get(taskId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(taskId);
    }
  }

  /**
   * Cancel any pending retry for a task
   */
  cancelRetry(taskId: string): void {
    const retryTimer = this.retryTimers.get(taskId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(taskId);
    }
  }

  /**
   * Destroy workers - clear all timers
   */
  destroy(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.handlers.clear();
  }
}
