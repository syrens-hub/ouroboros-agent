/**
 * Task Prioritizer
 * ================
 * Priority queue logic extracted from task-scheduler.
 * Manages task dependencies, eligibility, and priority ordering.
 */

import type { Task, TaskStatus } from "./task-scheduler-types.ts";

export interface TaskPrioritizerOptions {
  maxConcurrent?: number;
}

export class TaskPrioritizer {
  private tasks: Map<string, Task>;
  private runningTasks: Set<string>;
  private readonly maxConcurrent: number;

  constructor(tasks: Map<string, Task>, options?: TaskPrioritizerOptions) {
    this.tasks = tasks;
    this.runningTasks = new Set();
    this.maxConcurrent = options?.maxConcurrent || 10;
  }

  /**
   * Sync internal task map (called by scheduler when tasks change)
   */
  syncTasks(tasks: Map<string, Task>): void {
    this.tasks = tasks;
  }

  /**
   * Check if all dependencies for a task are met
   */
  checkDependencies(dependencies: string[]): boolean {
    for (const depId of dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask) continue;
      if (depTask.status === "running") return false;
      if (depTask.status === "failed") return false;
    }
    return true;
  }

  /**
   * Check if a specific task can run (not already running, dependencies met)
   */
  canRun(taskId: string): boolean {
    if (this.runningTasks.has(taskId)) return false;
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== "pending") return false;
    if (task.options.dependencies?.length) {
      return this.checkDependencies(task.options.dependencies);
    }
    return true;
  }

  /**
   * Get tasks that are eligible to run now
   */
  getRunnableTasks(): Task[] {
    if (this.runningTasks.size >= this.maxConcurrent) return [];

    return Array.from(this.tasks.values())
      .filter((task) => {
        if (task.status !== "pending") return false;
        if (this.runningTasks.has(task.id)) return false;
        if (task.options.dependencies?.length) {
          return this.checkDependencies(task.options.dependencies);
        }
        return true;
      })
      .sort((a, b) => {
        // Priority: cron > interval > delayed > one-time
        // Then by nextRunAt
        const typeOrder: Record<string, number> = { cron: 0, interval: 1, delayed: 2, "one-time": 3 };
        const aOrder = typeOrder[a.type || "delayed"] ?? 2;
        const bOrder = typeOrder[b.type || "delayed"] ?? 2;
        if (aOrder !== bOrder) return aOrder - bOrder;

        // Earlier nextRunAt first
        const aNext = a.nextRunAt || 0;
        const bNext = b.nextRunAt || 0;
        return aNext - bNext;
      });
  }

  /**
   * Mark a task as running
   */
  markRunning(taskId: string): void {
    this.runningTasks.add(taskId);
  }

  /**
   * Mark a task as no longer running
   */
  markDone(taskId: string): void {
    this.runningTasks.delete(taskId);
  }

  /**
   * Check if a task is currently running
   */
  isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /**
   * Get count of currently running tasks
   */
  getRunningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * Get all currently running task IDs
   */
  getRunningTaskIds(): string[] {
    return Array.from(this.runningTasks);
  }

  /**
   * Get tasks filtered by status
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  /**
   * Get pending tasks
   */
  getPendingTasks(): Task[] {
    return this.getTasksByStatus("pending");
  }

  /**
   * Get running tasks
   */
  getRunningTasks(): Task[] {
    return Array.from(this.runningTasks)
      .map((id) => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}
