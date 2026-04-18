/**
 * Task Scheduler Internal Helpers
 * ==================================
 * Internal utilities extracted from task-scheduler.ts.
 * These are scheduler-specific but separated for code organization.
 */

import cron from "node-cron";
import { safeJsonParse } from "../../core/safe-utils.ts";
import type {
  Task,
  TaskOptions,
  PersistedTask,
  ScheduledTaskOptions,
  IntervalTaskOptions,
} from "./task-scheduler-types.ts";

/** Interface for cron-scheduled task handles */
export interface CronScheduledTask {
  start(): void;
  stop(): void;
  destroy(): void;
}

/** Generate a unique task ID */
export function generateTaskId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a base task object */
export function createBaseTask(
  taskId: string,
  name: string | undefined,
  type: Task["type"],
  options: TaskOptions
): Task {
  return {
    id: taskId,
    name: name || taskId,
    type,
    status: "pending",
    createdAt: Date.now(),
    runCount: 0,
    errorCount: 0,
    options,
  };
}

/** Update nextRunAt based on task type */
export function updateNextRunTime(task: Task): void {
  const options = task.options as ScheduledTaskOptions | IntervalTaskOptions;
  if ("cron" in options) {
    task.nextRunAt = cron.validate(options.cron) ? Date.now() + 60000 : undefined;
  } else if ("interval" in options) {
    task.nextRunAt = Date.now() + options.interval;
  }
}

/** Convert Task to PersistedTask */
export function taskToPersistedTask(task: Task): PersistedTask {
  return {
    id: task.id,
    name: task.name,
    type: task.type || "delayed",
    status: task.status,
    runCount: task.runCount,
    errorCount: task.errorCount,
    lastError: task.lastError,
    lastRunAt: task.lastRunAt,
    nextRunAt: task.nextRunAt,
    options: JSON.stringify(task.options),
  };
}

/** Parse persisted options JSON */
export function parseOptions(optionsJson: string): TaskOptions {
  return safeJsonParse<TaskOptions>(optionsJson, "task options") ?? {};
}

/** Restore a Task from PersistedTask */
export function restoreTask(persisted: PersistedTask): Task {
  return {
    id: persisted.id,
    name: persisted.name,
    type: persisted.type,
    status: persisted.status,
    createdAt: Date.now(),
    lastRunAt: persisted.lastRunAt,
    nextRunAt: persisted.nextRunAt,
    runCount: persisted.runCount,
    errorCount: persisted.errorCount,
    lastError: persisted.lastError,
    options: parseOptions(persisted.options),
  };
}
