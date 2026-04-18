import Database from "better-sqlite3";
import { join } from "path";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { appConfig } from "../../core/config.ts";

export interface PersistedTask {
  id: string;
  name: string;
  type: "cron" | "delayed" | "interval" | "one-time";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  runCount: number;
  errorCount: number;
  lastError?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  options: string;
}

export interface TaskQueue {
  add(task: PersistedTask): Promise<void>;
  update(task: PersistedTask): Promise<void>;
  remove(taskId: string): Promise<void>;
  getTasks(): Promise<PersistedTask[]>;
  getStats(): Promise<{ pending: number; failed: number; delayed: number }>;
  start(handler: (taskId: string) => Promise<void>): void;
  stop(): Promise<void>;
}

export class SQLiteTaskQueue implements TaskQueue {
  private db: Database.Database;
  private interval?: ReturnType<typeof setInterval>;

  constructor(dbPath?: string) {
    const finalPath =
      dbPath ||
      join(
        appConfig.db.dir.startsWith("/")
          ? appConfig.db.dir
          : join(process.cwd(), appConfig.db.dir),
        "task-queue.db"
      );
    this.db = new Database(finalPath);
    this.init();
  }

  private init(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -64000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks_queue (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        run_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_run_at INTEGER,
        next_run_at INTEGER,
        options TEXT NOT NULL
      )
    `);
  }

  async add(task: PersistedTask): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tasks_queue (id, name, type, status, run_count, error_count, last_error, last_run_at, next_run_at, options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.name,
        task.type,
        task.status,
        task.runCount,
        task.errorCount,
        task.lastError ?? null,
        task.lastRunAt ?? null,
        task.nextRunAt ?? null,
        task.options
      );
  }

  async update(task: PersistedTask): Promise<void> {
    this.db
      .prepare(
        `UPDATE tasks_queue SET
          name = ?, type = ?, status = ?, run_count = ?, error_count = ?,
          last_error = ?, last_run_at = ?, next_run_at = ?, options = ?
        WHERE id = ?`
      )
      .run(
        task.name,
        task.type,
        task.status,
        task.runCount,
        task.errorCount,
        task.lastError ?? null,
        task.lastRunAt ?? null,
        task.nextRunAt ?? null,
        task.options,
        task.id
      );
  }

  async remove(taskId: string): Promise<void> {
    this.db.prepare(`DELETE FROM tasks_queue WHERE id = ?`).run(taskId);
  }

  async getTasks(): Promise<PersistedTask[]> {
    const rows = this.db.prepare(`SELECT * FROM tasks_queue`).all() as Array<{
      id: string;
      name: string;
      type: string;
      status: string;
      run_count: number;
      error_count: number;
      last_error: string | null;
      last_run_at: number | null;
      next_run_at: number | null;
      options: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as PersistedTask["type"],
      status: row.status as PersistedTask["status"],
      runCount: row.run_count,
      errorCount: row.error_count,
      lastError: row.last_error ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      nextRunAt: row.next_run_at ?? undefined,
      options: row.options,
    }));
  }

  async getStats(): Promise<{ pending: number; failed: number; delayed: number }> {
    const pendingRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM tasks_queue WHERE status = 'pending'`)
      .get() as { count: number };
    const failedRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM tasks_queue WHERE status = 'failed'`)
      .get() as { count: number };
    const delayedRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM tasks_queue WHERE status = 'pending' AND next_run_at > ?`)
      .get(Date.now()) as { count: number };
    return { pending: pendingRow.count, failed: failedRow.count, delayed: delayedRow.count };
  }

  start(handler: (taskId: string) => Promise<void>): void {
    this.interval = setInterval(() => {
      const now = Date.now();
      const rows = this.db
        .prepare(
          `SELECT id FROM tasks_queue WHERE status = 'pending' AND next_run_at IS NOT NULL AND next_run_at <= ?`
        )
        .all(now) as Array<{ id: string }>;
      for (const row of rows) {
        handler(row.id).catch((err) => {
          console.error(`[task-queue] SQLite poll handler error for task ${row.id}:`, err);
        });
      }
    }, 5000);
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}

export class RedisTaskQueue implements TaskQueue {
  private queue: Queue;
  private worker?: Worker;
  private redis: Redis;
  private readonly queueName: string;

  constructor(redisUrl: string, queueName = "ouroboros-tasks") {
    this.queueName = queueName;
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(queueName, { connection: this.redis });
  }

  private taskKey(taskId: string): string {
    return `ouroboros:task:${taskId}`;
  }

  async add(task: PersistedTask): Promise<void> {
    await this.redis.set(this.taskKey(task.id), JSON.stringify(task));

    const opts: Record<string, unknown> = { jobId: task.id };
    const parsedOptions = JSON.parse(task.options || "{}") as Record<string, unknown>;

    if (task.type === "cron") {
      if (parsedOptions.cron) {
        opts.repeat = { pattern: String(parsedOptions.cron), tz: parsedOptions.timezone as string | undefined };
      }
    } else if (task.type === "interval") {
      if (parsedOptions.interval) {
        opts.repeat = { every: Number(parsedOptions.interval) };
      }
    } else if (task.nextRunAt && task.nextRunAt > Date.now()) {
      opts.delay = task.nextRunAt - Date.now();
    }

    try {
      await this.queue.add(task.name, { taskId: task.id }, opts);
    } catch (err) {
      // Ignore duplicate or other add errors
      console.error(`[RedisTaskQueue] queue.add error:`, err);
    }
  }

  async update(task: PersistedTask): Promise<void> {
    await this.redis.set(this.taskKey(task.id), JSON.stringify(task));
  }

  async remove(taskId: string): Promise<void> {
    await this.redis.del(this.taskKey(taskId));
    const job = await this.queue.getJob(taskId);
    if (job) {
      await job.remove();
    }
  }

  async getTasks(): Promise<PersistedTask[]> {
    const jobs = await this.queue.getJobs(["waiting", "delayed", "completed", "failed"]);
    const tasks: PersistedTask[] = [];
    for (const job of jobs) {
      const stored = await this.redis.get(this.taskKey(job.id || ""));
      if (stored) {
        tasks.push(JSON.parse(stored) as PersistedTask);
      } else {
        tasks.push(this.jobToPersistedTask(job));
      }
    }
    return tasks;
  }

  async getStats(): Promise<{ pending: number; failed: number; delayed: number }> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "delayed",
      "completed",
      "failed",
      "active"
    );
    return {
      pending: (counts.waiting || 0) + (counts.delayed || 0) + (counts.active || 0),
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }

  start(handler: (taskId: string) => Promise<void>): void {
    this.worker = new Worker(
      this.queueName,
      async (job: Job) => {
        await handler(job.data.taskId as string);
      },
      { connection: this.redis }
    );
    this.worker.on("error", (err) => {
      console.error("[task-queue] Redis worker error:", err);
    });
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = undefined;
    }
    await this.queue.close();
    await this.redis.quit();
  }

  private jobToPersistedTask(job: Job): PersistedTask {
    const data = (job.data || {}) as Record<string, unknown>;
    const storedTask = (data.task || {}) as Partial<PersistedTask>;
    let type: PersistedTask["type"] = "delayed";
    const repeat = job.opts.repeat as Record<string, unknown> | undefined;
    if (repeat) {
      if (repeat.pattern || repeat.cron) type = "cron";
      else if (repeat.every) type = "interval";
    }
    return {
      id: String(job.id || storedTask.id || ""),
      name: storedTask.name || job.name,
      type: storedTask.type || type,
      status: storedTask.status || "pending",
      runCount: storedTask.runCount ?? job.attemptsMade ?? 0,
      errorCount: storedTask.errorCount ?? 0,
      lastError: storedTask.lastError || job.failedReason || undefined,
      lastRunAt: storedTask.lastRunAt || (job.processedOn ? job.processedOn : undefined),
      nextRunAt: storedTask.nextRunAt || (job.delay ? Date.now() + job.delay : undefined),
      options: storedTask.options || "{}",
    };
  }
}
