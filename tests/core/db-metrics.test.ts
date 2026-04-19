import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDbQuery,
  recordDbTransaction,
  dbQueryCounter,
  dbQueryDurationHistogram,
  dbTransactionCounter,
} from "../../core/db-metrics.ts";

describe("DB Metrics", () => {
  beforeEach(() => {
    dbQueryCounter.clear();
    dbQueryDurationHistogram.clear();
    dbTransactionCounter.clear();
  });

  it("increments query counter for sqlite", () => {
    recordDbQuery(0.01, "sqlite");
    expect(dbQueryCounter.get('db_queries_total{backend="sqlite"}')).toBe(1);
    recordDbQuery(0.02, "sqlite");
    expect(dbQueryCounter.get('db_queries_total{backend="sqlite"}')).toBe(2);
  });

  it("increments query counter for postgres", () => {
    recordDbQuery(0.05, "postgres");
    expect(dbQueryCounter.get('db_queries_total{backend="postgres"}')).toBe(1);
  });

  it("records histogram buckets correctly", () => {
    recordDbQuery(0.03, "sqlite");
    // 0.03 <= 0.005? no
    // 0.03 <= 0.01? no
    // 0.03 <= 0.025? no
    // 0.03 <= 0.05? yes
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="0.005",backend="sqlite"}')).toBeUndefined();
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="0.05",backend="sqlite"}')).toBe(1);
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="+Inf",backend="sqlite"}')).toBe(1);
  });

  it("records histogram for slow query", () => {
    recordDbQuery(15.0, "postgres");
    // All finite buckets should be 0 (or undefined), only +Inf should be 1
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="10",backend="postgres"}')).toBeUndefined();
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="+Inf",backend="postgres"}')).toBe(1);
  });

  it("records multiple queries with cumulative histogram", () => {
    recordDbQuery(0.001, "sqlite");
    recordDbQuery(0.02, "sqlite");
    recordDbQuery(0.1, "sqlite");

    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="0.005",backend="sqlite"}')).toBe(1);
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="0.025",backend="sqlite"}')).toBe(2);
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="0.1",backend="sqlite"}')).toBe(3);
    expect(dbQueryDurationHistogram.get('db_query_duration_seconds_bucket{le="+Inf",backend="sqlite"}')).toBe(3);
  });

  it("increments transaction counter for sqlite", () => {
    recordDbTransaction("sqlite");
    expect(dbTransactionCounter.get('db_transactions_total{backend="sqlite"}')).toBe(1);
    recordDbTransaction("sqlite");
    expect(dbTransactionCounter.get('db_transactions_total{backend="sqlite"}')).toBe(2);
  });

  it("increments transaction counter for postgres", () => {
    recordDbTransaction("postgres");
    expect(dbTransactionCounter.get('db_transactions_total{backend="postgres"}')).toBe(1);
  });
});
