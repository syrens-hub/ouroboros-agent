/**
 * Ouroboros Task Scheduler
 * =========================
 * Ported from OpenClaw ClaudeFusion.
 *
 * Supports Cron, delayed, interval, and one-time tasks with dependencies,
 * retries, and timeout control.
 *
 * Architecture:
 * - TaskScheduler: main orchestrator (this file)
 * - TaskQueue: persistence layer (task-queue.ts)
 * - TaskPrioritizer: priority queue logic (task-prioritizer.ts)
 * - TaskWorkers: worker pool management (task-workers.ts)
 * - TaskSchedulerInternal: internal helpers (task-scheduler-internal.ts)
 */

// Re-export types from task-scheduler-types for backward compatibility
export type {
  TaskStatus,
  TaskOptions,
  ScheduledTaskOptions,
  DelayedTaskOptions,
  IntervalTaskOptions,
  Task,
  TaskResult,
  PersistedTask,
  CronScheduledTask,
} from "./task-scheduler-types.ts";

export {
  createTaskScheduler,
  createPersistentTaskScheduler,
  isValidCron,
  getNextCronRun,
  CronPatterns,
} from "./task-scheduler-factory.ts";

export { TaskScheduler } from "./task-scheduler-class.ts";
