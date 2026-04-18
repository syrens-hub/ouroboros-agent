import { performance } from "perf_hooks";
import { appConfig } from "../../core/config.ts";
import { logger } from "../../core/logger.ts";

export async function timedQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const threshold = appConfig.db.slowQueryThresholdMs;
  if (!threshold || threshold <= 0) {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = Math.round(performance.now() - start);
    if (duration >= threshold) {
      logger.warn("Slow query detected", { label, durationMs: duration, threshold });
    }
  }
}
