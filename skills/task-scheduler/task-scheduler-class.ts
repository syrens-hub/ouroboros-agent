/**
 * Ouroboros Task Scheduler — Core Class
 * ======================================
 * Extracted to break circular dependency with task-scheduler-factory.
 */

import { EventEmitter } from "events";
import cron from "node-cron";
import { TaskQueue } from "./task-queue.ts";
import { TaskPrioritizer } from "./task-prioritizer.ts";
import { TaskWorkers } from "./task-workers.ts";
import {
  generateTaskId,
  createBaseTask,
  updateNextRunTime,
  taskToPersistedTask,
  restoreTask,
} from "./task-scheduler-internal.ts";
import type {
  Task,
  TaskStatus,
  ScheduledTaskOptions,
  DelayedTaskOptions,
  IntervalTaskOptions,
  TaskResult,
  CronScheduledTask,
} from "./task-scheduler-types.ts";

export class TaskScheduler extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private cronTasks: Map<string, CronScheduledTask> = new Map();
  private intervalTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private taskHandlers: Map<string, (task: Task) => Promise<unknown>> = new Map();
  private queue?: TaskQueue;
  private prioritizer: TaskPrioritizer;
  private workers: TaskWorkers;

  constructor(opts?: { queue?: TaskQueue }) {
    super();
    this.setMaxListeners(100);
    this.prioritizer = new TaskPrioritizer(this.tasks);
    this.workers = new TaskWorkers({ prioritizer: this.prioritizer });
    this.queue = opts?.queue;
  }

  registerCronTask(handler: (task: Task) => Promise<unknown>, options: ScheduledTaskOptions): string {
    const taskId = options.id || generateTaskId("cron");
    const task = createBaseTask(taskId, options.name, "cron", options);
    task.status = options.enabled !== false ? "pending" : "cancelled";
    this.registerTask(taskId, task, handler);
    if (!this.queue && cron.validate(options.cron)) {
      const st = cron.schedule(options.cron, async () => { await this.executeTask(taskId); },
        { timezone: options.timezone, name: options.name }) as CronScheduledTask;
      if (options.enabled === false) st.stop();
      this.cronTasks.set(taskId, st);
    }
    this.emit("task_registered", task);
    return taskId;
  }

  registerDelayedTask(handler: (task: Task) => Promise<unknown>, options: DelayedTaskOptions): string {
    const taskId = options.id || generateTaskId("delay");
    const task = createBaseTask(taskId, options.name, "delayed", options);
    task.nextRunAt = Date.now() + options.delay;
    this.registerTask(taskId, task, handler);
    if (!this.queue) this.timeoutTimers.set(taskId, setTimeout(async () => { await this.executeTask(taskId); }, options.delay));
    this.emit("task_registered", task);
    return taskId;
  }

  registerIntervalTask(handler: (task: Task) => Promise<unknown>, options: IntervalTaskOptions): string {
    const taskId = options.id || generateTaskId("interval");
    const task = createBaseTask(taskId, options.name, "interval", options);
    task.status = options.enabled !== false ? "pending" : "cancelled";
    this.registerTask(taskId, task, handler);
    updateNextRunTime(task);
    if (!this.queue) {
      const timer = setInterval(async () => { await this.executeTask(taskId); }, options.interval);
      if (options.enabled === false) clearInterval(timer);
      this.intervalTimers.set(taskId, timer);
    }
    this.emit("task_registered", task);
    return taskId;
  }

  registerOneTimeTask(handler: (task: Task) => Promise<unknown>, options: DelayedTaskOptions): string {
    const taskId = options.id || generateTaskId("one-time");
    const task = createBaseTask(taskId, options.name, "one-time", { ...options, maxRetries: options.maxRetries || 1 });
    const delay = (task.options as DelayedTaskOptions).delay || 0;
    task.nextRunAt = Date.now() + delay;
    this.registerTask(taskId, task, handler);
    if (!this.queue) this.timeoutTimers.set(taskId, setTimeout(async () => { await this.executeTask(taskId); }, delay));
    this.emit("task_registered", task);
    return taskId;
  }

  private registerTask(taskId: string, task: Task, handler: (task: Task) => Promise<unknown>): void {
    this.tasks.set(taskId, task);
    this.prioritizer.syncTasks(this.tasks);
    this.taskHandlers.set(taskId, handler);
    this.workers.registerHandler(taskId, handler);
    if (this.queue) this.queue.add(taskToPersistedTask(task)).catch(() => {});
  }

  private async executeTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.options.dependencies?.length && !this.prioritizer.checkDependencies(task.options.dependencies)) {
      this.emit("task_skipped", { taskId, reason: "Dependencies not met" });
      return { taskId, success: false, error: "Dependencies not met", duration: 0, runAt: Date.now() };
    }
    if (this.prioritizer.isRunning(taskId)) {
      this.emit("task_skipped", { taskId, reason: "Already running" });
      return { taskId, success: false, error: "Task already running", duration: 0, runAt: Date.now() };
    }
    if (this.queue) await this.queue.update(taskToPersistedTask(task)).catch(() => {});

    const result = await this.workers.executeTask(taskId, task, (event, data) => this.emit(event, data));
    updateNextRunTime(task);
    if (this.queue) {
      const ct = this.tasks.get(taskId);
      if (ct) await this.queue.update(taskToPersistedTask(ct)).catch(() => {});
    }
    return result;
  }

  async triggerTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return this.executeTask(taskId);
  }

  enableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (this.queue) {
      task.status = "pending";
      this.queue.update(taskToPersistedTask(task)).catch(() => {});
    } else {
      this.cronTasks.get(taskId)?.start();
      const it = this.intervalTimers.get(taskId);
      if (it) {
        clearInterval(it);
        this.intervalTimers.set(taskId, setInterval(async () => { await this.executeTask(taskId); }, (task.options as IntervalTaskOptions).interval));
      }
      task.status = "pending";
    }
    this.emit("task_enabled", { taskId });
  }

  disableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (this.queue) {
      task.status = "cancelled";
      this.queue.update(taskToPersistedTask(task)).catch(() => {});
    } else {
      this.cronTasks.get(taskId)?.stop();
      const it = this.intervalTimers.get(taskId);
      if (it) clearInterval(it);
      task.status = "cancelled";
    }
    this.emit("task_disabled", { taskId });
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (this.queue) this.queue.remove(taskId).catch(() => {});
    const ct = this.cronTasks.get(taskId);
    if (ct) { ct.stop(); this.cronTasks.delete(taskId); }
    const it = this.intervalTimers.get(taskId);
    if (it) { clearInterval(it); this.intervalTimers.delete(taskId); }
    const tt = this.timeoutTimers.get(taskId);
    if (tt) { clearTimeout(tt); this.timeoutTimers.delete(taskId); }
    this.workers.cancelRetry(taskId);
    task.status = "cancelled";
    this.emit("task_cancelled", { taskId });
  }

  deleteTask(taskId: string): void {
    if (this.queue) this.queue.remove(taskId).catch(() => {});
    this.cancelTask(taskId);
    this.tasks.delete(taskId);
    this.taskHandlers.delete(taskId);
    this.workers.removeHandler(taskId);
    this.prioritizer.syncTasks(this.tasks);
    this.emit("task_deleted", { taskId });
  }

  getTask(taskId: string): Task | undefined { return this.tasks.get(taskId); }
  getAllTasks(): Task[] { return this.prioritizer.getAllTasks(); }
  getTasksByStatus(status: TaskStatus): Task[] { return this.prioritizer.getTasksByStatus(status); }
  getPendingTasks(): Task[] { return this.prioritizer.getPendingTasks(); }
  getRunningTasks(): Task[] { return this.prioritizer.getRunningTasks(); }

  async restoreTasks(): Promise<void> {
    if (!this.queue) return;
    for (const persisted of await this.queue.getTasks()) {
      this.tasks.set(persisted.id, restoreTask(persisted));
    }
    this.prioritizer.syncTasks(this.tasks);
    this.queue.start(async (taskId) => { await this.triggerTask(taskId); });
  }

  async getQueueStats(): Promise<{ pending: number; failed: number; delayed: number } | null> {
    return this.queue?.getStats() ?? null;
  }

  destroy(): void {
    for (const taskId of this.tasks.keys()) this.cancelTask(taskId);
    for (const timer of this.timeoutTimers.values()) clearTimeout(timer);
    this.timeoutTimers.clear();
    this.workers.destroy();
    this.tasks.clear();
    this.taskHandlers.clear();
    this.emit("destroyed");
  }
}
