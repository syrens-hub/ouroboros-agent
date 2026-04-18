/**
 * Ouroboros Task Scheduler Factory
 * ================================
 * Factory functions and cron pattern constants.
 */

import cron from "node-cron";
import { TaskScheduler } from "./task-scheduler.ts";
import { SQLiteTaskQueue, RedisTaskQueue } from "./task-queue.ts";
import type { TaskScheduler as ITaskScheduler } from "./task-scheduler.ts";

export function createTaskScheduler(): TaskScheduler {
  return new TaskScheduler();
}

export async function createPersistentTaskScheduler(opts?: { redisUrl?: string }): Promise<ITaskScheduler> {
  const redisUrl = opts?.redisUrl || process.env.REDIS_URL;
  const queue = redisUrl ? new RedisTaskQueue(redisUrl) : new SQLiteTaskQueue();
  const scheduler = new TaskScheduler({ queue });
  await scheduler.restoreTasks();
  return scheduler;
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
