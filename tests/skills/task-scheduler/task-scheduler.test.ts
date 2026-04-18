import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TaskScheduler,
  createTaskScheduler,
  isValidCron,
  CronPatterns,
} from "../../../skills/task-scheduler/index.ts";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = createTaskScheduler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler.destroy();
    vi.useRealTimers();
  });

  it("registers and executes a delayed task", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.registerDelayedTask(handler, { delay: 5000 });

    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("registers and executes an interval task", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.registerIntervalTask(handler, { interval: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("cancels a task", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const taskId = scheduler.registerDelayedTask(handler, { delay: 5000 });

    scheduler.cancelTask(taskId);
    await vi.advanceTimersByTimeAsync(5000);

    expect(handler).not.toHaveBeenCalled();
  });

  it("retries failed tasks", async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue(undefined);
    scheduler.registerDelayedTask(handler, { delay: 1000, maxRetries: 1, retryDelay: 2000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("skips task when dependencies are not met", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const depId = scheduler.registerDelayedTask(vi.fn().mockRejectedValue(new Error("dep fail")), {
      delay: 1000,
    });

    const taskId = scheduler.registerDelayedTask(handler, { delay: 1000, dependencies: [depId] });

    await vi.advanceTimersByTimeAsync(1000);

    const task = scheduler.getTask(taskId);
    expect(task?.status).toBe("pending"); // skipped due to deps not met
  });

  it("enforces timeout", async () => {
    const handler = vi.fn().mockImplementation(async () => {
      return new Promise((resolve) => setTimeout(resolve, 10000));
    });

    scheduler.registerDelayedTask(handler, { delay: 1000, timeout: 500 });

    await vi.advanceTimersByTimeAsync(1500);

    // Task should have failed after timeout
  });

  it("emits events", async () => {
    const completed = vi.fn();
    scheduler.on("task_completed", completed);

    const handler = vi.fn().mockResolvedValue("result");
    scheduler.registerDelayedTask(handler, { delay: 1000 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(completed).toHaveBeenCalledOnce();
    const arg = completed.mock.calls[0][0];
    expect(arg.success).toBe(true);
    expect(arg.taskId).toBeDefined();
  });

  it("returns task lists by status", async () => {
    scheduler.registerDelayedTask(vi.fn(), { delay: 10000, id: "t1" });
    scheduler.registerDelayedTask(vi.fn().mockRejectedValue(new Error("fail")), {
      delay: 1000,
      maxRetries: 0,
      id: "t2",
    });

    await vi.advanceTimersByTimeAsync(1000);

    const pending = scheduler.getPendingTasks();
    const failed = scheduler.getTasksByStatus("failed");

    expect(pending.some((t) => t.id === "t1")).toBe(true);
    expect(failed.some((t) => t.id === "t2")).toBe(true);
  });
});

describe("Cron helpers", () => {
  it("validates correct cron expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true);
    expect(isValidCron("0 0 * * *")).toBe(true);
  });

  it("rejects invalid cron expressions", () => {
    expect(isValidCron("not-a-cron")).toBe(false);
  });

  it("provides common cron patterns", () => {
    expect(CronPatterns.every5Minutes).toBe("*/5 * * * *");
    expect(CronPatterns.daily).toBe("0 0 * * *");
  });
});
