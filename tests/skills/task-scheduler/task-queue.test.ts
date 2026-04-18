import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SQLiteTaskQueue, type PersistedTask } from "../../../skills/task-scheduler/task-queue.ts";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const TEST_DB = join(process.cwd(), ".ouroboros", `test-task-queue-${Date.now()}.db`);

describe("SQLiteTaskQueue", () => {
  let queue: SQLiteTaskQueue;

  beforeEach(() => {
    queue = new SQLiteTaskQueue(TEST_DB);
  });

  afterEach(async () => {
    await queue.stop();
    try {
      if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    } catch {
      // ignore
    }
  });

  it("adds and retrieves tasks", async () => {
    const task: PersistedTask = {
      id: "t1",
      name: "test-task",
      type: "one-time",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: "{}",
    };
    await queue.add(task);
    const tasks = await queue.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
  });

  it("updates a task", async () => {
    const task: PersistedTask = {
      id: "t2",
      name: "task",
      type: "one-time",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: "{}",
    };
    await queue.add(task);
    await queue.update({ ...task, status: "completed", runCount: 1 });
    const tasks = await queue.getTasks();
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].runCount).toBe(1);
  });

  it("removes a task", async () => {
    const task: PersistedTask = {
      id: "t3",
      name: "task",
      type: "one-time",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: "{}",
    };
    await queue.add(task);
    await queue.remove("t3");
    const tasks = await queue.getTasks();
    expect(tasks).toHaveLength(0);
  });

  it("getStats returns correct counts", async () => {
    const now = Date.now();
    await queue.add({ id: "p1", name: "p", type: "one-time", status: "pending", runCount: 0, errorCount: 0, options: "{}", nextRunAt: now - 1000 });
    await queue.add({ id: "p2", name: "p", type: "one-time", status: "pending", runCount: 0, errorCount: 0, options: "{}", nextRunAt: now + 60000 });
    await queue.add({ id: "f1", name: "f", type: "one-time", status: "failed", runCount: 0, errorCount: 1, options: "{}", lastError: "oops" });
    const stats = await queue.getStats();
    expect(stats.pending).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.delayed).toBe(1); // only p2 is pending with nextRunAt > now
  });

  it("starts and stops interval polling", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.start(handler);
    await queue.stop();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("RedisTaskQueue", () => {
  const mocks = vi.hoisted(() => {
    const redisMock = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    const queueMock = {
      add: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) } as any),
      getJobs: vi.fn().mockResolvedValue([]),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 1, delayed: 2, completed: 3, failed: 4, active: 5 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const workerMock = {
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    return { redisMock, queueMock, workerMock };
  });

  vi.mock("ioredis", () => ({
    default: vi.fn(() => mocks.redisMock),
    Redis: vi.fn(() => mocks.redisMock),
  }));

  vi.mock("bullmq", () => ({
    Queue: vi.fn(() => mocks.queueMock),
    Worker: vi.fn(() => mocks.workerMock),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisMock.set.mockResolvedValue("OK");
    mocks.redisMock.del.mockResolvedValue(1);
    mocks.redisMock.get.mockResolvedValue(null);
    mocks.redisMock.quit.mockResolvedValue("OK");
    mocks.queueMock.add.mockResolvedValue(undefined);
    mocks.queueMock.getJob.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
    mocks.queueMock.getJobs.mockResolvedValue([]);
    mocks.queueMock.getJobCounts.mockResolvedValue({ waiting: 1, delayed: 2, completed: 3, failed: 4, active: 5 });
    mocks.queueMock.close.mockResolvedValue(undefined);
    mocks.workerMock.close.mockResolvedValue(undefined);
    mocks.workerMock.on.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a one-time delayed task", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const task: PersistedTask = {
      id: "r1",
      name: "delayed-task",
      type: "delayed",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: "{}",
      nextRunAt: Date.now() + 60000,
    };
    await queue.add(task);
    expect(mocks.redisMock.set).toHaveBeenCalled();
    expect(mocks.queueMock.add).toHaveBeenCalledWith(
      "delayed-task",
      { taskId: "r1" },
      expect.objectContaining({ delay: expect.any(Number), jobId: "r1" })
    );
    await queue.stop();
  });

  it("adds a cron task", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const task: PersistedTask = {
      id: "r2",
      name: "cron-task",
      type: "cron",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: JSON.stringify({ cron: "0 0 * * *", timezone: "UTC" }),
    };
    await queue.add(task);
    expect(mocks.queueMock.add).toHaveBeenCalledWith(
      "cron-task",
      { taskId: "r2" },
      expect.objectContaining({
        jobId: "r2",
        repeat: { pattern: "0 0 * * *", tz: "UTC" },
      })
    );
    await queue.stop();
  });

  it("adds an interval task", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const task: PersistedTask = {
      id: "r3",
      name: "interval-task",
      type: "interval",
      status: "pending",
      runCount: 0,
      errorCount: 0,
      options: JSON.stringify({ interval: 5000 }),
    };
    await queue.add(task);
    expect(mocks.queueMock.add).toHaveBeenCalledWith(
      "interval-task",
      { taskId: "r3" },
      expect.objectContaining({
        jobId: "r3",
        repeat: { every: 5000 },
      })
    );
    await queue.stop();
  });

  it("updates a task in redis", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const task: PersistedTask = {
      id: "r4",
      name: "update-task",
      type: "one-time",
      status: "completed",
      runCount: 1,
      errorCount: 0,
      options: "{}",
    };
    await queue.update(task);
    expect(mocks.redisMock.set).toHaveBeenCalledWith("ouroboros:task:r4", JSON.stringify(task));
    await queue.stop();
  });

  it("removes a task from redis and queue", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    await queue.remove("r5");
    expect(mocks.redisMock.del).toHaveBeenCalledWith("ouroboros:task:r5");
    expect(mocks.queueMock.getJob).toHaveBeenCalledWith("r5");
    await queue.stop();
  });

  it("getStats returns aggregated counts", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const stats = await queue.getStats();
    expect(stats.pending).toBe(8); // waiting + delayed + active
    expect(stats.failed).toBe(4);
    expect(stats.delayed).toBe(2);
    await queue.stop();
  });

  it("getTasks falls back to jobToPersistedTask when redis cache misses", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    mocks.queueMock.getJobs.mockResolvedValue([
      { id: "j1", name: "job1", data: { taskId: "j1" }, opts: {}, attemptsMade: 2, failedReason: "error", processedOn: 1000, delay: 5000 },
    ]);
    const tasks = await queue.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("j1");
    expect(tasks[0].runCount).toBe(2);
    expect(tasks[0].lastError).toBe("error");
    await queue.stop();
  });

  it("starts a worker and stops gracefully", async () => {
    const { RedisTaskQueue } = await import("../../../skills/task-scheduler/task-queue.ts");
    const queue = new RedisTaskQueue("redis://localhost");
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.start(handler);
    expect(mocks.workerMock.on).toHaveBeenCalledWith("error", expect.any(Function));
    await queue.stop();
    expect(mocks.workerMock.close).toHaveBeenCalled();
    expect(mocks.queueMock.close).toHaveBeenCalled();
    expect(mocks.redisMock.quit).toHaveBeenCalled();
  });
});
