/**
 * A/B Test Framework
 * ==================
 * Traffic-split validation for self-modifying evolutions.
 * All operations are safe-fail-open: on any error they fall back to
 * control-group behaviour so that normal requests are never blocked.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db-manager.ts";
import { safeFailOpen, safeJsonParse } from "./safe-utils.ts";
import { logger } from "./logger.ts";

export interface ABTestMetrics {
  controlRequests: number;
  treatmentRequests: number;
  controlErrors: number;
  treatmentErrors: number;
  controlLatencyMs: number;
  treatmentLatencyMs: number;
}

export interface ABTest {
  id: string;
  name: string;
  description?: string;
  controlVersion: string;
  treatmentVersion: string;
  trafficSplit: number;
  status: "draft" | "running" | "paused" | "completed" | "rolled_back";
  startedAt?: number;
  endedAt?: number;
  metrics: ABTestMetrics;
  targetModule?: string;
}

export interface ABTestFramework {
  createTest(config: Omit<ABTest, "id" | "status" | "metrics">): ABTest;
  startTest(id: string): void;
  pauseTest(id: string): void;
  completeTest(id: string, winner: "control" | "treatment"): void;
  rollbackTest(id: string): void;
  assignVariant(testId: string, userId?: string): "control" | "treatment";
  recordMetric(testId: string, variant: "control" | "treatment", metric: Partial<ABTestMetrics>): void;
  getTest(id: string): ABTest | undefined;
  listTests(): ABTest[];
}

/** Deterministic djb2 hash for stable user→variant assignment. */
export function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

function defaultMetrics(): ABTestMetrics {
  return {
    controlRequests: 0,
    treatmentRequests: 0,
    controlErrors: 0,
    treatmentErrors: 0,
    controlLatencyMs: 0,
    treatmentLatencyMs: 0,
  };
}

function rowToABTest(row: Record<string, unknown>): ABTest {
  const metrics = safeJsonParse<ABTestMetrics>(
    String(row.metrics_json ?? "{}"),
    "ab-test:rowToABTest",
    defaultMetrics()
  );
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    controlVersion: String(row.control_version),
    treatmentVersion: String(row.treatment_version),
    trafficSplit: Number(row.traffic_split),
    status: String(row.status) as ABTest["status"],
    startedAt: row.started_at ? Number(row.started_at) : undefined,
    endedAt: row.ended_at ? Number(row.ended_at) : undefined,
    targetModule: row.target_module ? String(row.target_module) : undefined,
    metrics,
  };
}

export class DbABTestFramework implements ABTestFramework {
  createTest(config: Omit<ABTest, "id" | "status" | "metrics">): ABTest {
    return safeFailOpen(() => {
      const db = getDb();
      const id = uuidv4();
      const test: ABTest = {
        ...config,
        id,
        status: "draft",
        metrics: defaultMetrics(),
      };
      db
        .prepare(
          `INSERT INTO ab_tests (
            id, name, description, control_version, treatment_version,
            traffic_split, status, started_at, ended_at, target_module,
            metrics_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          test.id,
          test.name,
          test.description ?? null,
          test.controlVersion,
          test.treatmentVersion,
          test.trafficSplit,
          test.status,
          test.startedAt ?? null,
          test.endedAt ?? null,
          test.targetModule ?? null,
          JSON.stringify(test.metrics),
          Date.now()
        );
      logger.info("AB test created", { id: test.id, name: test.name, trafficSplit: test.trafficSplit });
      return test;
    }, "DbABTestFramework.createTest", {
      ...config,
      id: `fallback-${Date.now()}`,
      status: "draft",
      metrics: defaultMetrics(),
    } as ABTest);
  }

  startTest(id: string): void {
    safeFailOpen(() => {
      const db = getDb();
      const now = Date.now();
      db.prepare("UPDATE ab_tests SET status = 'running', started_at = ? WHERE id = ?").run(now, id);
      logger.info("AB test started", { id });
    }, "DbABTestFramework.startTest", undefined);
  }

  pauseTest(id: string): void {
    safeFailOpen(() => {
      const db = getDb();
      db.prepare("UPDATE ab_tests SET status = 'paused' WHERE id = ?").run(id);
      logger.info("AB test paused", { id });
    }, "DbABTestFramework.pauseTest", undefined);
  }

  completeTest(id: string, _winner: "control" | "treatment"): void {
    safeFailOpen(() => {
      const db = getDb();
      const now = Date.now();
      db.prepare("UPDATE ab_tests SET status = 'completed', ended_at = ? WHERE id = ?").run(now, id);
      logger.info("AB test completed", { id, winner: _winner });
    }, "DbABTestFramework.completeTest", undefined);
  }

  rollbackTest(id: string): void {
    safeFailOpen(() => {
      const db = getDb();
      const now = Date.now();
      db.prepare("UPDATE ab_tests SET status = 'rolled_back', ended_at = ? WHERE id = ?").run(now, id);
      logger.info("AB test rolled back", { id });
    }, "DbABTestFramework.rollbackTest", undefined);
  }

  assignVariant(testId: string, userId?: string): "control" | "treatment" {
    return safeFailOpen(() => {
      const test = this.getTest(testId);
      if (!test || test.status !== "running") {
        return "control";
      }
      if (userId) {
        const hash = djb2Hash(`${userId}||${testId}`);
        const percentile = hash % 100;
        return percentile < test.trafficSplit * 100 ? "treatment" : "control";
      }
      return Math.random() < test.trafficSplit ? "treatment" : "control";
    }, "DbABTestFramework.assignVariant", "control");
  }

  recordMetric(
    testId: string,
    variant: "control" | "treatment",
    metric: Partial<ABTestMetrics>
  ): void {
    safeFailOpen(() => {
      const test = this.getTest(testId);
      if (!test) return;

      const m = { ...test.metrics };
      if (variant === "control") {
        if (metric.controlRequests !== undefined) m.controlRequests += metric.controlRequests;
        if (metric.controlErrors !== undefined) m.controlErrors += metric.controlErrors;
        if (metric.controlLatencyMs !== undefined) {
          const addedRequests = metric.controlRequests ?? 1;
          const oldRequests = m.controlRequests - addedRequests;
          const total = m.controlLatencyMs * Math.max(0, oldRequests) + metric.controlLatencyMs;
          m.controlLatencyMs = total / Math.max(1, m.controlRequests);
        }
      } else {
        if (metric.treatmentRequests !== undefined) m.treatmentRequests += metric.treatmentRequests;
        if (metric.treatmentErrors !== undefined) m.treatmentErrors += metric.treatmentErrors;
        if (metric.treatmentLatencyMs !== undefined) {
          const addedRequests = metric.treatmentRequests ?? 1;
          const oldRequests = m.treatmentRequests - addedRequests;
          const total = m.treatmentLatencyMs * Math.max(0, oldRequests) + metric.treatmentLatencyMs;
          m.treatmentLatencyMs = total / Math.max(1, m.treatmentRequests);
        }
      }

      const db = getDb();
      db.prepare("UPDATE ab_tests SET metrics_json = ? WHERE id = ?").run(JSON.stringify(m), testId);
    }, "DbABTestFramework.recordMetric", undefined);
  }

  getTest(id: string): ABTest | undefined {
    return safeFailOpen(() => {
      const db = getDb();
      const row = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? rowToABTest(row) : undefined;
    }, "DbABTestFramework.getTest", undefined);
  }

  listTests(): ABTest[] {
    return safeFailOpen(() => {
      const db = getDb();
      const rows = db.prepare("SELECT * FROM ab_tests ORDER BY created_at DESC").all() as
        Record<string, unknown>[];
      return rows.map(rowToABTest);
    }, "DbABTestFramework.listTests", []);
  }
}

export function createDbABTestFramework(): ABTestFramework {
  return new DbABTestFramework();
}
