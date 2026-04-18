/**
 * Ouroboros Task Scheduler Types
 * ==============================
 * Shared types for task scheduling. Imported by task-scheduler.ts,
 * task-prioritizer.ts, and task-workers.ts.
 */

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
  type: "cron" | "delayed" | "interval" | "one-time";
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

export interface CronScheduledTask {
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface PersistedTask {
  id: string;
  name: string;
  type: "cron" | "delayed" | "interval" | "one-time";
  status: TaskStatus;
  runCount: number;
  errorCount: number;
  lastError?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  options: string;
}

export interface CronPatterns {
  everyMinute: string;
  every5Minutes: string;
  every15Minutes: string;
  every30Minutes: string;
  hourly: string;
  every6Hours: string;
  daily: string;
  daily8am: string;
  daily6pm: string;
  weeklyMonday: string;
  monthlyFirst: string;
  yearly: string;
}
