/**
 * BatchProcessor
 * ==============
 * Buffers individual items into batches and processes them via a provided
 * batch function, supporting concurrency limits and adaptive batch sizing.
 */

export type BatchProcessorConfig = {
  batchSize?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  adaptive?: boolean;
};

export type BatchProcessorStats = {
  totalProcessed: number;
  totalBatches: number;
  avgBatchSize: number;
  avgProcessingTime: number;
  queueSize: number;
};

type QueueItem<T, R> = {
  item: T;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
};

export class BatchProcessor<T, R> {
  name?: string;
  private processor: (items: T[]) => Promise<R[]>;
  private baseBatchSize: number;
  private currentBatchSize: number;
  private timeoutMs: number;
  private maxConcurrency: number;
  private adaptive: boolean;

  private queue: QueueItem<T, R>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeCount = 0;
  private waitingBatches: QueueItem<T, R>[][] = [];
  private destroyed = false;

  private totalProcessed = 0;
  private totalBatches = 0;
  private totalProcessingTime = 0;
  private recentTimes: number[] = [];

  constructor(
    processor: (items: T[]) => Promise<R[]>,
    config?: BatchProcessorConfig,
  );
  constructor(
    name: string,
    processor: (items: T[]) => Promise<R[]>,
    config?: BatchProcessorConfig,
  );
  constructor(
    arg1: string | ((items: T[]) => Promise<R[]>),
    arg2: ((items: T[]) => Promise<R[]>) | BatchProcessorConfig = {},
    arg3: BatchProcessorConfig = {},
  ) {
    let processor: (items: T[]) => Promise<R[]>;
    let config: BatchProcessorConfig;
    if (typeof arg1 === "string") {
      this.name = arg1;
      processor = arg2 as (items: T[]) => Promise<R[]>;
      config = arg3;
    } else {
      processor = arg1;
      config = arg2 as BatchProcessorConfig;
    }
    this.processor = processor;
    this.baseBatchSize = Math.max(1, config.batchSize ?? 10);
    this.currentBatchSize = this.baseBatchSize;
    this.timeoutMs = Math.max(0, config.timeoutMs ?? 100);
    this.maxConcurrency = Math.max(1, config.maxConcurrency ?? 1);
    this.adaptive = config.adaptive ?? false;
  }

  add(item: T): Promise<R> {
    if (this.destroyed) {
      return Promise.reject(new Error("BatchProcessor has been destroyed"));
    }
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.maybeStartTimer();
      this.checkFlush();
    });
  }

  submit(item: T): Promise<R> {
    return this.add(item);
  }

  addMany(items: T[]): Promise<R[]> {
    if (this.destroyed) {
      return Promise.reject(new Error("BatchProcessor has been destroyed"));
    }
    return Promise.all(items.map((item) => this.add(item)));
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getStats(): BatchProcessorStats {
    const queueSize = this.queue.length;
    return {
      totalProcessed: this.totalProcessed,
      totalBatches: this.totalBatches,
      avgBatchSize:
        this.totalBatches > 0 ? this.totalProcessed / this.totalBatches : 0,
      avgProcessingTime:
        this.totalBatches > 0
          ? this.totalProcessingTime / this.totalBatches
          : 0,
      queueSize,
    };
  }

  flush(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error("BatchProcessor has been destroyed"));
    }
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    this.clearTimer();
    const batch = this.queue.splice(0);
    this.scheduleBatch(batch);
    return Promise.resolve();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    const error = new Error("BatchProcessor has been destroyed");
    for (const queued of this.queue) {
      queued.reject(error);
    }
    this.queue = [];
    for (const batch of this.waitingBatches) {
      for (const queued of batch) {
        queued.reject(error);
      }
    }
    this.waitingBatches = [];
  }

  private maybeStartTimer(): void {
    if (this.timer !== null || this.timeoutMs === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.queue.length > 0) {
        const batch = this.queue.splice(0);
        this.scheduleBatch(batch);
      }
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private checkFlush(): void {
    while (this.queue.length >= this.currentBatchSize) {
      this.clearTimer();
      const batch = this.queue.splice(0, this.currentBatchSize);
      this.scheduleBatch(batch);
    }
  }

  private scheduleBatch(batch: QueueItem<T, R>[]): void {
    if (this.activeCount >= this.maxConcurrency) {
      this.waitingBatches.push(batch);
      return;
    }
    void this.runBatch(batch);
  }

  private async runBatch(batch: QueueItem<T, R>[]): Promise<void> {
    this.activeCount++;
    const start = Date.now();
    try {
      const items = batch.map((q) => q.item);
      const results = await this.processor(items);
      const duration = Date.now() - start;

      this.totalProcessed += batch.length;
      this.totalBatches++;
      this.totalProcessingTime += duration;

      if (this.adaptive) {
        this.recentTimes.push(duration);
        if (this.recentTimes.length > 10) {
          this.recentTimes.shift();
        }
        this.adjustBatchSize();
      }

      for (let i = 0; i < batch.length; i++) {
        batch[i].resolve(results[i]);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const queued of batch) {
        queued.reject(error);
      }
    } finally {
      this.activeCount--;
      while (
        this.waitingBatches.length > 0 &&
        this.activeCount < this.maxConcurrency
      ) {
        const next = this.waitingBatches.shift()!;
        this.runBatch(next).catch((e) => {
          console.error(`Batch execution failed: ${e}`);
        });
      }
    }
  }

  private adjustBatchSize(): void {
    if (this.recentTimes.length === 0) return;
    const avg =
      this.recentTimes.reduce((a, b) => a + b, 0) / this.recentTimes.length;

    const maxAdaptive = Math.min(128, this.baseBatchSize * 2);

    if (avg > this.timeoutMs * 0.8) {
      this.currentBatchSize = Math.max(
        1,
        Math.floor(this.currentBatchSize * 0.7),
      );
    } else if (avg < this.timeoutMs * 0.3) {
      this.currentBatchSize = Math.min(
        maxAdaptive,
        Math.ceil(this.currentBatchSize * 1.2),
      );
    }
  }
}
