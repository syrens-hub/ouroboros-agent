import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BatchProcessor } from "../../core/batch-processor.ts";

describe("BatchProcessor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes batch by size", async () => {
    const processor = vi.fn().mockResolvedValue([2, 4, 6]);
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 3,
      timeoutMs: 1000,
    });

    const results = await bp.addMany([1, 2, 3]);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);

    const stats = bp.getStats();
    expect(stats.totalProcessed).toBe(3);
    expect(stats.totalBatches).toBe(1);
    expect(stats.avgBatchSize).toBe(3);
    expect(stats.queueSize).toBe(0);
  });

  it("flushes batch by timeout", async () => {
    const processor = vi.fn().mockResolvedValue([42]);
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 100,
    });

    const p = bp.add(1);
    expect(processor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toEqual([1]);

    const result = await p;
    expect(result).toBe(42);
  });

  it("throttles by maxConcurrency", async () => {
    const processor = vi.fn().mockImplementation(async (items: number[]) => {
      return new Promise<number[]>((resolve) => setTimeout(() => resolve(items.map((x) => x * 2)), 100));
    });
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 2,
      timeoutMs: 1000,
      maxConcurrency: 1,
    });

    const resultsPromise = bp.addMany([1, 2, 3, 4]);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(processor.mock.calls[1][0]).toEqual([3, 4]);

    await vi.advanceTimersByTimeAsync(100);
    const results = await resultsPromise;
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it("adaptive sizing reduces batch size when processing is slow", async () => {
    const processor = vi.fn().mockImplementation(async (items: number[]) => {
      return new Promise<number[]>((resolve) => setTimeout(() => resolve(items.map((x) => x * 2)), 90));
    });
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 100,
      maxConcurrency: 1,
      adaptive: true,
    });

    const firstBatch = bp.addMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toHaveLength(10);

    await vi.advanceTimersByTimeAsync(90);
    await firstBatch;

    const secondBatch = bp.addMany([11, 12, 13, 14, 15, 16, 17]);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(processor.mock.calls[1][0]).toHaveLength(7);

    await vi.advanceTimersByTimeAsync(90);
    await secondBatch;
  });

  it("adaptive sizing increases batch size when processing is fast", async () => {
    const processor = vi.fn().mockImplementation(async (items: number[]) => {
      return new Promise<number[]>((resolve) => setTimeout(() => resolve(items.map((x) => x * 2)), 10));
    });
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 100,
      maxConcurrency: 1,
      adaptive: true,
    });

    const firstBatch = bp.addMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toHaveLength(10);

    await vi.advanceTimersByTimeAsync(10);
    await firstBatch;

    const secondBatch = bp.addMany(Array.from({ length: 12 }, (_, i) => i + 11));
    expect(processor).toHaveBeenCalledTimes(2);
    expect(processor.mock.calls[1][0]).toHaveLength(12);

    await vi.advanceTimersByTimeAsync(10);
    await secondBatch;
  });

  it("flush processes pending items immediately", async () => {
    const processor = vi.fn().mockResolvedValue([42]);
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 1000,
    });

    const p = bp.add(1);
    expect(processor).not.toHaveBeenCalled();

    await bp.flush();
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toEqual([1]);

    const result = await p;
    expect(result).toBe(42);
  });

  it("destroy rejects pending queue items and waiting batches", async () => {
    const processor = vi.fn().mockImplementation(async (items: number[]) => {
      return new Promise<number[]>((resolve) => setTimeout(() => resolve(items.map((x) => x * 2)), 100));
    });
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 2,
      timeoutMs: 1000,
      maxConcurrency: 1,
    });

    const p1 = bp.addMany([1, 2, 3, 4]);
    expect(bp.getQueueSize()).toBe(0);

    bp.destroy();

    await expect(p1).rejects.toThrow("BatchProcessor has been destroyed");
    expect(bp.getQueueSize()).toBe(0);
  });

  it("destroy rejects items still in queue", async () => {
    const processor = vi.fn().mockResolvedValue([42]);
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 1000,
    });

    const p = bp.add(1);
    expect(bp.getQueueSize()).toBe(1);

    bp.destroy();

    await expect(p).rejects.toThrow("BatchProcessor has been destroyed");
    expect(bp.getQueueSize()).toBe(0);
  });

  it("add rejects after destroy", async () => {
    const processor = vi.fn().mockResolvedValue([42]);
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 10,
      timeoutMs: 1000,
    });

    bp.destroy();

    await expect(bp.add(1)).rejects.toThrow("BatchProcessor has been destroyed");
    await expect(bp.addMany([1, 2])).rejects.toThrow("BatchProcessor has been destroyed");
    await expect(bp.flush()).rejects.toThrow("BatchProcessor has been destroyed");
  });

  it("tracks stats correctly across multiple batches", async () => {
    const processor = vi.fn().mockImplementation(async (items: number[]) => {
      return new Promise<number[]>((resolve) => setTimeout(() => resolve(items.map((x) => x * 2)), 20));
    });
    const bp = new BatchProcessor<number, number>(processor, {
      batchSize: 2,
      timeoutMs: 1000,
      maxConcurrency: 2,
    });

    const p = bp.addMany([1, 2, 3, 4]);
    await vi.advanceTimersByTimeAsync(20);
    await p;

    const stats = bp.getStats();
    expect(stats.totalProcessed).toBe(4);
    expect(stats.totalBatches).toBe(2);
    expect(stats.avgBatchSize).toBe(2);
    expect(stats.avgProcessingTime).toBeGreaterThanOrEqual(0);
  });
});
