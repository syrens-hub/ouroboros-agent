/**
 * Database Metrics Collector
 * ==========================
 * Driver-agnostic query/transaction counters and histograms
 * consumed by web/routes/lib/metrics.ts for /api/metrics.
 */

const MAX_METRIC_KEYS = 100;

function safeSet(map: Map<string, number>, key: string, value: number): void {
  if (map.size >= MAX_METRIC_KEYS && !map.has(key)) {
    // Defensive cap: don't record new keys to prevent unbounded growth
    // if future code adds dynamic labels (query patterns, etc.).
    return;
  }
  map.set(key, value);
}

export const dbQueryCounter = new Map<string, number>();
export const dbQueryDurationHistogram = new Map<string, number>();
export const dbTransactionCounter = new Map<string, number>();

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function recordDbQuery(durationSec: number, backend: "sqlite" | "postgres") {
  const counterKey = `db_queries_total{backend="${backend}"}`;
  safeSet(dbQueryCounter, counterKey, (dbQueryCounter.get(counterKey) || 0) + 1);

  for (const bucket of durationBuckets) {
    const key = `db_query_duration_seconds_bucket{le="${bucket}",backend="${backend}"}`;
    if (durationSec <= bucket) {
      safeSet(dbQueryDurationHistogram, key, (dbQueryDurationHistogram.get(key) || 0) + 1);
    }
  }
  const infKey = `db_query_duration_seconds_bucket{le="+Inf",backend="${backend}"}`;
  safeSet(dbQueryDurationHistogram, infKey, (dbQueryDurationHistogram.get(infKey) || 0) + 1);
}

export function recordDbTransaction(backend: "sqlite" | "postgres") {
  const key = `db_transactions_total{backend="${backend}"}`;
  safeSet(dbTransactionCounter, key, (dbTransactionCounter.get(key) || 0) + 1);
}
