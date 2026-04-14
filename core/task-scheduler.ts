/**
 * Ouroboros Task Scheduler
 * =========================
 * Ported from OpenClaw ClaudeFusion.
 *
 * Supports Cron, delayed, interval, and one-time tasks with dependencies,
 * retries, and timeout control.
 */

import { EventEmitter } from "events";
import cron from "node-cron";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskOptions {
  id?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScheduledTaskOptions extends TaskOptions {
  cron: string;
  timezone?: string;
}

export interface DelayedTaskOptions extends TaskOptions {
  delay: number;
}

export interface IntervalTaskOptions extends TaskOptions {
  interval: number;
}

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  errorCount: number;
  lastError?: string;
  options: TaskOptions;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  runAt: number;
}

interface CronScheduledTask {
  start(): void;
  stop(): void;
  destroy(): void;
}

// =============================================================================
// Task Scheduler
// =============================================================================

export class TaskScheduler extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private cronTasks: Map<string, CronScheduledTask> = new Map();
  private intervalTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private runningTasks: Set<string> = new Set();
  private taskHandlers: Map<string, (task: Task) => Promise<unknown>> = new Map();

  registerCronTask(handler: (task: Task) => Promise<unknown>, options: ScheduledTaskOptions): string {
    const taskId = options.id || `cron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const task: Task = {
      id: taskId,
      name: options.name || taskId,
      status: options.enabled !== false ? "pending" : "cancelled",
      createdAt: Date.now(),
      runCount: 0,
      errorCount: 0,
      options,
    };

    this.tasks.set(taskId, task);
    this.taskHandlers.set(taskId, handler);

    if (cron.validate(options.cron)) {
      const scheduledTask = cron.schedule(
        options.cron,
        async () => {
          await this.executeTask(taskId);
        },
        {
          timezone: options.timezone,
          name: options.name,
        }
      );
      if (options.enabled === false) {
        scheduledTask.stop();
      }
      this.cronTasks.set(taskId, scheduledTask as unknown as CronScheduledTask);
      this.updateNextRunTime(taskId);
    }

    this.emit("task_registered", task);
    return taskId;
  }

  registerDelayedTask(handler: (task: Task) => Promise<unknown>, options: DelayedTaskOptions): string {
    const taskId = options.id || `delay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const task: Task = {
      id: taskId,
      name: options.name || taskId,
      status: "pending",
      createdAt: Date.now(),
      runCount: 0,
      errorCount: 0,
      options,
    };

    this.tasks.set(taskId, task);
    this.taskHandlers.set(taskId, handler);

    const timer = setTimeout(async () => {
      await this.executeTask(taskId);
    }, options.delay);

    this.timeoutTimers.set(taskId, timer);
    task.nextRunAt = Date.now() + options.delay;

    this.emit("task_registered", task);
    return taskId;
  }

  registerIntervalTask(handler: (task: Task) => Promise<unknown>, options: IntervalTaskOptions): string {
    const taskId = options.id || `interval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const task: Task = {
      id: taskId,
      name: options.name || taskId,
      status: options.enabled !== false ? "pending" : "cancelled",
      createdAt: Date.now(),
      runCount: 0,
      errorCount: 0,
      options,
    };

    this.tasks.set(taskId, task);
    this.taskHandlers.set(taskId, handler);

    const timer = setInterval(async () => {
      await this.executeTask(taskId);
    }, options.interval);

    if (options.enabled === false) {
      clearInterval(timer);
    }

    this.intervalTimers.set(taskId, timer);
    this.updateNextRunTime(taskId);

    this.emit("task_registered", task);
    return taskId;
  }

  registerOneTimeTask(handler: (task: Task) => Promise<unknown>, options: DelayedTaskOptions): string {
    return this.registerDelayedTask(handler, {
      ...options,
      maxRetries: options.maxRetries || 1,
    });
  }

  private async executeTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    const handler = this.taskHandlers.get(taskId);

    if (!task || !handler) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.options.dependencies?.length) {
      const dependenciesMet = await this.checkDependencies(task.options.dependencies);
      if (!dependenciesMet) {
        this.emit("task_skipped", { taskId, reason: "Dependencies not met" });
        return { taskId, success: false, error: "Dependencies not met", duration: 0, runAt: Date.now() };
      }
    }

    if (this.runningTasks.has(taskId)) {
      this.emit("task_skipped", { taskId, reason: "Already running" });
      return { taskId, success: false, error: "Task already running", duration: 0, runAt: Date.now() };
    }

    this.runningTasks.add(taskId);
    task.status = "running";
    task.lastRunAt = Date.now();

    const startTime = Date.now();
    let result: TaskResult;

    try {
      const timeoutPromise = task.options.timeout
        ? new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Task timeout")), task.options.timeout)
          )
        : Promise.race([]);

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

      this.emit("task_completed", result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      task.errorCount++;
      task.lastError = errorMessage;

      const maxRetries = task.options.maxRetries || 0;
      if (task.errorCount <= maxRetries) {
        task.status = "pending";
        const retryDelay = task.options.retryDelay || 5000;
        setTimeout(async () => {
          await this.executeTask(taskId);
        }, retryDelay);

        this.emit("task_retry", { taskId, attempt: task.errorCount, delay: retryDelay });
      } else {
        task.status = "failed";
        this.emit("task_failed", { taskId, error: errorMessage });
      }

      result = {
        taskId,
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
        runAt: task.lastRunAt,
      };
    } finally {
      this.runningTasks.delete(taskId);
      this.updateNextRunTime(taskId);
    }

    return result;
  }

  private async checkDependencies(dependencies: string[]): Promise<boolean> {
    for (const depId of dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask) continue;
      if (depTask.status === "running") return false;
      if (depTask.status === "failed") return false;
    }
    return true;
  }

  async triggerTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return this.executeTask(taskId);
  }

  enableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const cronTask = this.cronTasks.get(taskId);
    if (cronTask) cronTask.start();

    const intervalTimer = this.intervalTimers.get(taskId);
    if (intervalTimer) {
      clearInterval(intervalTimer);
      const interval = (task.options as IntervalTaskOptions).interval;
      const newTimer = setInterval(async () => {
        await this.executeTask(taskId);
      }, interval);
      this.intervalTimers.set(taskId, newTimer);
    }

    task.status = "pending";
    this.emit("task_enabled", { taskId });
  }

  disableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const cronTask = this.cronTasks.get(taskId);
    if (cronTask) cronTask.stop();

    const intervalTimer = this.intervalTimers.get(taskId);
    if (intervalTimer) clearInterval(intervalTimer);

    task.status = "cancelled";
    this.emit("task_disabled", { taskId });
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const cronTask = this.cronTasks.get(taskId);
    if (cronTask) {
      cronTask.stop();
      this.cronTasks.delete(taskId);
    }

    const intervalTimer = this.intervalTimers.get(taskId);
    if (intervalTimer) {
      clearInterval(intervalTimer);
      this.intervalTimers.delete(taskId);
    }

    const timeoutTimer = this.timeoutTimers.get(taskId);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      this.timeoutTimers.delete(taskId);
    }

    task.status = "cancelled";
    this.emit("task_cancelled", { taskId });
  }

  deleteTask(taskId: string): void {
    this.cancelTask(taskId);
    this.tasks.delete(taskId);
    this.taskHandlers.delete(taskId);
    this.emit("task_deleted", { taskId });
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  getPendingTasks(): Task[] {
    return this.getTasksByStatus("pending");
  }

  getRunningTasks(): Task[] {
    return Array.from(this.runningTasks)
      .map((id) => this.tasks.get(id)!)
      .filter(Boolean);
  }

  private updateNextRunTime(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const options = task.options as ScheduledTaskOptions | IntervalTaskOptions;
    if ("cron" in options) {
      task.nextRunAt = cron.validate(options.cron) ? Date.now() + 60000 : undefined;
    } else if ("interval" in options) {
      task.nextRunAt = Date.now() + options.interval;
    }
  }

  destroy(): void {
    for (const taskId of this.tasks.keys()) {
      this.cancelTask(taskId);
    }
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();
    this.tasks.clear();
    this.taskHandlers.clear();
    this.runningTasks.clear();
    this.emit("destroyed");
  }
}

export function createTaskScheduler(): TaskScheduler {
  return new TaskScheduler();
}

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

export function getNextCronRun(_expression: string, _timezone?: string): Date | null {
  // Simplified estimate; full implementation would parse the cron expression
  return new Date(Date.now() + 60000);
}

export const CronPatterns = {
  everyMinute: "* * * * *",
  every5Minutes: "*/5 * * * *",
  every15Minutes: "*/15 * * * *",
  every30Minutes: "*/30 * * * *",
  hourly: "0 * * * *",
  every6Hours: "0 */6 * * *",
  daily: "0 0 * * *",
  daily8am: "0 8 * * *",
  daily6pm: "0 18 * * *",
  weeklyMonday: "0 9 * * 1",
  monthlyFirst: "0 0 1 * *",
  yearly: "0 0 1 1 *",
};
