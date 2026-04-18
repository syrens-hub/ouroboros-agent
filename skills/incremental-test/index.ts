/**
 * Incremental Test Runner
 * =======================
 * Maps changed files to relevant test files and supports both
 * incremental (targeted) and full test runs.
 *
 * File -> Test mapping rules:
 *   core/<name>.ts        -> tests/core/<name>.test.ts
 *   skills/<skill>/*.ts   -> tests/skills/<skill>/*.test.ts
 *   web/src/...           -> tests/web/.../*.test.ts
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { logger } from "../../core/logger.ts";
import { basename, dirname, extname } from "path";

export type TestRunMode = "full" | "incremental";
export type TestRunStatus = "passed" | "failed" | "partial" | "unknown";

export interface TestRunResult {
  runId: string;
  mode: TestRunMode;
  targetTests: string[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  status: TestRunStatus;
  timestamp: number;
  logs?: string;
}

export interface TestRunRequest {
  changedFiles: string[];
  mode: TestRunMode;
}

function genId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initTestRunTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      target_tests TEXT NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      logs TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_test_runs_timestamp ON test_runs(timestamp DESC);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initTestRunTables(db);
}

function serializeTests(tests: string[]): string {
  try {
    return JSON.stringify(tests);
  } catch {
    return "[]";
  }
}

function parseTests(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/** Map a single changed file to its likely test file(s). */
export function mapFileToTests(changedFile: string): string[] {
  const normalized = changedFile.replace(/\\/g, "/");
  const ext = extname(normalized);

  // Only map TypeScript / JavaScript source files
  if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    return [];
  }

  const base = basename(normalized, ext);
  const dir = dirname(normalized);

  // core/ -> tests/core/
  if (normalized.startsWith("core/")) {
    return [`tests/core/${base}.test${ext}`];
  }

  // skills/<skill>/... -> tests/skills/<skill>/...
  const skillMatch = normalized.match(/^skills\/([^/]+)/);
  if (skillMatch) {
    const skillName = skillMatch[1];
    // If the changed file is the skill's index.ts, map to tests/skills/<skill>/<skill>.test.ts
    // or tests/skills/<skill>/index.test.ts
    if (base === "index") {
      return [
        `tests/skills/${skillName}/${skillName}.test.ts`,
        `tests/skills/${skillName}/index.test.ts`,
      ];
    }
    return [`tests/skills/${skillName}/${base}.test.ts`];
  }

  // web/src/... -> tests/web/...
  if (normalized.startsWith("web/src/")) {
    const rel = normalized.slice("web/src/".length);
    const relDir = dirname(rel);
    const relBase = basename(rel, ext);
    if (relDir === ".") {
      return [`tests/web/${relBase}.test.ts`];
    }
    return [`tests/web/${relDir}/${relBase}.test.ts`];
  }

  return [];
}

/** Map multiple changed files to a deduplicated set of test files. */
export function mapFilesToTests(changedFiles: string[]): string[] {
  const tests = new Set<string>();
  for (const file of changedFiles) {
    for (const t of mapFileToTests(file)) {
      tests.add(t);
    }
  }
  return Array.from(tests);
}

export class IncrementalTestRunner {
  private testCommand: string;

  constructor(opts?: { testCommand?: string }) {
    this.testCommand = opts?.testCommand ?? "npx vitest run";
  }

  /**
   * Run tests for the given changed files (incremental) or all tests (full).
   * In a real environment this would spawn vitest. Here we record the
   * intent and return a structured result; callers may override _execute.
   */
  async run(req: TestRunRequest): Promise<TestRunResult> {
    ensureInitialized();
    const start = Date.now();

    const targetTests =
      req.mode === "full"
        ? ["tests/"]
        : mapFilesToTests(req.changedFiles);

    if (req.mode === "incremental" && targetTests.length === 0) {
      logger.info("No test mapping found for changed files", { files: req.changedFiles });
      const result: TestRunResult = {
        runId: genId(),
        mode: "incremental",
        targetTests: [],
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
        status: "unknown",
        timestamp: Date.now(),
      };
      this._persist(result);
      return result;
    }

    // Execute tests (pluggable -- tests can mock this)
    const execResult = await this._execute(targetTests, req.mode);

    const result: TestRunResult = {
      runId: genId(),
      mode: req.mode,
      targetTests,
      passed: execResult.passed,
      failed: execResult.failed,
      skipped: execResult.skipped,
      durationMs: Date.now() - start,
      status: execResult.failed > 0 ? "failed" : execResult.passed > 0 ? "passed" : "unknown",
      timestamp: Date.now(),
      logs: execResult.logs,
    };

    this._persist(result);
    logger.info("Test run completed", {
      runId: result.runId,
      mode: result.mode,
      passed: result.passed,
      failed: result.failed,
      durationMs: result.durationMs,
    });

    return result;
  }

  /** Pluggable test executor. Override in tests or prod. */
  protected async _execute(
    targetTests: string[],
    _mode: TestRunMode
  ): Promise<{ passed: number; failed: number; skipped: number; logs?: string }> {
    // Default implementation is a no-op/dry-run.
    // Production can override with real vitest spawn.
    return { passed: 0, failed: 0, skipped: 0, logs: "dry-run" };
  }

  getResult(runId: string): TestRunResult | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, mode, target_tests, passed, failed, skipped, duration_ms, status, logs, timestamp
         FROM test_runs WHERE id = ?`
      )
      .get(runId) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this._rowToResult(row);
  }

  getLastResult(): TestRunResult | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, mode, target_tests, passed, failed, skipped, duration_ms, status, logs, timestamp
         FROM test_runs ORDER BY timestamp DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this._rowToResult(row);
  }

  listResults(limit = 50): TestRunResult[] {
    ensureInitialized();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, mode, target_tests, passed, failed, skipped, duration_ms, status, logs, timestamp
         FROM test_runs ORDER BY timestamp DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => this._rowToResult(r));
  }

  private _persist(result: TestRunResult): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO test_runs (id, mode, target_tests, passed, failed, skipped, duration_ms, status, logs, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      result.runId,
      result.mode,
      serializeTests(result.targetTests),
      result.passed,
      result.failed,
      result.skipped,
      result.durationMs,
      result.status,
      result.logs ?? null,
      result.timestamp
    );
  }

  private _rowToResult(row: Record<string, unknown>): TestRunResult {
    return {
      runId: String(row.id),
      mode: String(row.mode) as TestRunMode,
      targetTests: parseTests(String(row.target_tests)),
      passed: Number(row.passed),
      failed: Number(row.failed),
      skipped: Number(row.skipped),
      durationMs: Number(row.duration_ms),
      status: String(row.status) as TestRunStatus,
      logs: row.logs ? String(row.logs) : undefined,
      timestamp: Number(row.timestamp),
    };
  }
}

export const incrementalTestRunner = new IncrementalTestRunner();
