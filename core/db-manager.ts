/**
 * Database Manager
 * ================
 * Connection singleton, file locking (SQLite), and schema migrations.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { safeFailOpen, safeFailOpenAsync, safeIgnore } from "./safe-utils.ts";
import type { DbAdapter } from "./db-adapter.ts";
import { PgDbAdapter, isPgAvailable } from "./db-pg.ts";
import { recordDbQuery, recordDbTransaction } from "./db-metrics.ts";

function getDbDir(): string {
  let baseDir: string;
  if (appConfig.database.backend === "sqlite") {
    // In tests, respect appConfig.db.dir override for SQLite path calculation.
    // Many tests set appConfig.db.dir to a temp directory but forget to update
    // appConfig.database.sqlite.path (which is derived from env vars).
    if (process.env.VITEST && appConfig.db.dir !== ".ouroboros") {
      baseDir = appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
    } else {
      const configuredPath = appConfig.database.sqlite.path;
      baseDir = configuredPath.startsWith("/")
        ? dirname(configuredPath)
        : join(process.cwd(), dirname(configuredPath));
    }
  } else {
    baseDir = appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
  }
  // Auto-isolate SQLite databases per Vitest worker to prevent lock conflicts
  // during parallel test execution. Only applies when using the default path.
  if (process.env.VITEST && appConfig.db.dir === ".ouroboros") {
    // Use VITEST_POOL_ID for true thread isolation in Vitest threads pool.
    // process.pid is shared across threads, causing SQLite lock conflicts and segfaults.
    return join(baseDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`);
  }
  return baseDir;
}

function getDbPath(): string {
  if (appConfig.database.backend === "sqlite") {
    return join(getDbDir(), basename(appConfig.database.sqlite.path));
  }
  return join(getDbDir(), "session.db");
}

function getLockFilePath(): string {
  return join(getDbDir(), "session.lock");
}

function wrapSqliteMetrics(adapter: DbAdapter): DbAdapter {
  const origExec = adapter.exec.bind(adapter);
  adapter.exec = (sql: string) => {
    const start = performance.now();
    try {
      return origExec(sql);
    } finally {
      recordDbQuery((performance.now() - start) / 1000, "sqlite");
    }
  };

  const origPragma = adapter.pragma.bind(adapter);
  adapter.pragma = <T = unknown>(pragma: string): T | Promise<T> => {
    const start = performance.now();
    try {
      return origPragma(pragma) as T | Promise<T>;
    } finally {
      recordDbQuery((performance.now() - start) / 1000, "sqlite");
    }
  };

  const origPrepare = adapter.prepare.bind(adapter);
  adapter.prepare = (sql: string) => {
    const stmt = origPrepare(sql);
    const wrap = <F extends (...args: unknown[]) => unknown>(fn: F): F => {
      return ((...args: unknown[]) => {
        const start = performance.now();
        try {
          return fn(...args);
        } finally {
          recordDbQuery((performance.now() - start) / 1000, "sqlite");
        }
      }) as F;
    };
    return {
      run: wrap(stmt.run.bind(stmt)),
      get: wrap(stmt.get.bind(stmt)),
      all: wrap(stmt.all.bind(stmt)),
    };
  };

  const origTransaction = adapter.transaction.bind(adapter);
  adapter.transaction = <T>(fn: () => T | Promise<T>): (() => T | Promise<T>) => {
    const tx = origTransaction(fn);
    return () => {
      const start = performance.now();
      try {
        return tx();
      } finally {
        recordDbQuery((performance.now() - start) / 1000, "sqlite");
        recordDbTransaction("sqlite");
      }
    };
  };

  return adapter;
}

function isProcessAlive(pid: number): boolean {
  return safeFailOpen(() => {
    process.kill(pid, 0);
    return true;
  }, `isProcessAlive(${pid})`, false);
}

let exitHandlerRegistered = false;

function acquireDbLock(): void {
  const lockPath = getLockFilePath();
  const currentPid = process.pid;
  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, "utf-8").trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && pid !== currentPid && isProcessAlive(pid)) {
        throw new Error(
          `Database is already locked by process ${pid}. ` +
            `Ouroboros Agent does not support running multiple instances against the same SQLite database. ` +
            `If you're sure no other instance is running, delete ${lockPath} manually.`
        );
      }
      // Same PID is allowed to re-acquire (e.g., after resetDbSingleton in tests)
    } catch (e) {
      if (e instanceof Error && e.message.includes("Database is already locked")) throw e;
    }
  }
  writeFileSync(lockPath, String(currentPid), { encoding: "utf-8", flag: "w" });
  if (!exitHandlerRegistered) {
    exitHandlerRegistered = true;
    process.once("exit", () => {
      safeIgnore(() => unlinkSync(lockPath), "releaseDbLock on exit");
    });
  }
}

let dbInstance: DbAdapter | null = null;
export let dbInitPromise: Promise<void> | null = null;

export function resetDbSingleton(): void {
  if (dbInstance) {
    safeIgnore(() => {
      const closeResult = dbInstance!.close();
      if (closeResult && typeof (closeResult as Promise<void>).then === "function") {
        // async close in progress; we won't await it here
      }
    }, "resetDbSingleton close");
    dbInstance = null;
  }
  dbInitPromise = null;
  dbInitInProgress = false;
  safeIgnore(() => {
    const lockPath = getLockFilePath();
    if (existsSync(lockPath)) {
      const content = readFileSync(lockPath, "utf-8").trim();
      if (content === String(process.pid)) {
        unlinkSync(lockPath);
      }
    }
  }, "resetDbSingleton release lock");
}

/**
 * True when a synchronous caller hits getDb() while initSchema() is running
 * (PostgreSQL path).  Callers MUST use getDbAsync() instead.
 */
let dbInitInProgress = false;

export function getDb(): DbAdapter {
  if (!dbInstance) {
    if (dbInitInProgress) {
      throw new Error(
        "[db-manager] Concurrent initialization detected in getDb(). " +
          "Database init is in progress (PostgreSQL schema migration). " +
          "Use getDbAsync() instead so callers properly await the init promise."
      );
    }
    if (appConfig.database.backend === "postgres") {
      const pgUrl = appConfig.database.connectionString || appConfig.db.postgresUrl;
      if (!pgUrl) {
        throw new Error("USE_POSTGRES is enabled but DATABASE_URL is not set.");
      }
      if (!isPgAvailable()) {
        throw new Error("PostgreSQL driver is not installed. Run: npm install pg");
      }
      dbInitInProgress = true;
      dbInstance = new PgDbAdapter(pgUrl, { poolSize: appConfig.database.poolSize });
      dbInitPromise = initSchema(dbInstance)
        .catch((e) => {
          logger.error("PostgreSQL migration failed", { error: String(e) });
          throw e;
        })
        .finally(() => {
          dbInitInProgress = false;
        });
      logger.info("Using PostgreSQL backend", { poolSize: appConfig.database.poolSize });
    } else {
      const dir = getDbDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      acquireDbLock();
      const dbPath = getDbPath();
      const db = new Database(dbPath) as unknown as DbAdapter;
      try {
        if (appConfig.database.sqlite.wal) {
          db.pragma("journal_mode = WAL");
        }
        db.pragma("synchronous = NORMAL");
        db.pragma("cache_size = -64000");
        db.pragma("foreign_keys = ON");
        runMigrationsSync(db);
        const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
        const integrityResult = integrity[0]?.integrity_check ?? "ok";
        if (integrityResult !== "ok") {
          logger.error("Database integrity check failed", { result: integrityResult });
          throw new Error(`Database integrity check failed: ${integrityResult}`);
        }
        dbInstance = wrapSqliteMetrics(db);
        logger.info("Using SQLite backend", { path: dbPath, wal: appConfig.database.sqlite.wal });
      } catch (e) {
        safeIgnore(() => db.close(), "db cleanup close after init error");
        throw e;
      }
    }
  }
  return dbInstance;
}

/**
 * Async-safe database accessor for the PostgreSQL path.
 *
 * When using PostgreSQL, schema initialization is async (Umzug migrations).
 * This function ensures callers await `dbInitPromise` before using the
 * adapter, preventing use-before-init races in concurrent call sites.
 *
 * For the SQLite path the returned Promise resolves immediately with the
 * already-initialized adapter.
 */
export async function getDbAsync(): Promise<DbAdapter> {
  if (!dbInstance) {
    // Fallback: synchronous init is only possible on the SQLite path.
    // If we reach here on the PG path something went wrong upstream.
    getDb();
  }
  if (dbInitPromise) {
    await dbInitPromise;
  }
  return dbInstance!;
}

import { Umzug } from "umzug";
import { migrations } from "./migrations/index.ts";
import { DbMigrationStorage, SyncDbMigrationStorage } from "./migrations/storage.ts";

async function hasLegacyMigrationsTable(db: DbAdapter, isPostgres: boolean): Promise<boolean> {
  return safeFailOpenAsync(async () => {
    if (isPostgres) {
      const rows = (await db.prepare(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'migrations'
      `).all()) as { table_name: string }[];
      return rows.length > 0;
    } else {
      const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'`).all() as { name: string }[];
      return rows.length > 0;
    }
  }, "hasLegacyMigrationsTable", false);
}

async function hasUmzugMigrationsTable(db: DbAdapter, isPostgres: boolean): Promise<boolean> {
  return safeFailOpenAsync(async () => {
    if (isPostgres) {
      const rows = (await db.prepare(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'umzug_migrations'
      `).all()) as { table_name: string }[];
      return rows.length > 0;
    } else {
      const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='umzug_migrations'`).all() as { name: string }[];
      return rows.length > 0;
    }
  }, "hasUmzugMigrationsTable", false);
}

async function seedUmzugFromLegacy(db: DbAdapter, isPostgres: boolean): Promise<void> {
  const storage = new DbMigrationStorage(db, isPostgres);
  for (const m of migrations) {
    await storage.logMigration({ name: m.name });
  }
}

function hasLegacyMigrationsTableSync(db: DbAdapter): boolean {
  return safeFailOpen(() => {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'`).all() as { name: string }[];
    return rows.length > 0;
  }, "hasLegacyMigrationsTableSync", false);
}

function hasUmzugMigrationsTableSync(db: DbAdapter): boolean {
  return safeFailOpen(() => {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='umzug_migrations'`).all() as { name: string }[];
    return rows.length > 0;
  }, "hasUmzugMigrationsTableSync", false);
}

function seedUmzugFromLegacySync(db: DbAdapter): void {
  const storage = new SyncDbMigrationStorage(db);
  for (const m of migrations) {
    storage.logMigration({ name: m.name });
  }
}

function runMigrationsSync(db: DbAdapter): void {
  // Serialize concurrent migrations via SQLite exclusive lock
  db.exec("BEGIN IMMEDIATE");
  try {
    const hasLegacy = hasLegacyMigrationsTableSync(db);
    const hasUmzug = hasUmzugMigrationsTableSync(db);
    if (hasLegacy && !hasUmzug) {
      seedUmzugFromLegacySync(db);
    }

    const storage = new SyncDbMigrationStorage(db);
    const ctx = { db, isPostgres: false };
    const executed = new Set(storage.executed());
    for (const m of migrations) {
      if (executed.has(m.name)) continue;
      // up is async but resolves immediately for SQLite since db.exec is sync
      const p = m.up({ name: m.name, context: ctx });
      if (p && typeof (p as Promise<void>).then === "function") {
        // In case any migration legitimately awaits, we can't block here.
        // For current migrations this is a no-op since they resolve instantly.
      }
      storage.logMigration({ name: m.name });
    }
  } finally {
    db.exec("COMMIT");
  }
}

export async function initSchema(db: DbAdapter) {
  const isPostgres = appConfig.database.backend === "postgres";
  const hasLegacy = await hasLegacyMigrationsTable(db, isPostgres);
  const hasUmzug = await hasUmzugMigrationsTable(db, isPostgres);
  if (hasLegacy && !hasUmzug) {
    await seedUmzugFromLegacy(db, isPostgres);
  }

  if (!isPostgres) {
    runMigrationsSync(db);
    return;
  }

  const umzug = new Umzug({
    migrations,
    context: { db, isPostgres },
    storage: new DbMigrationStorage(db, isPostgres),
    logger: undefined,
  });

  await umzug.up();
}

export async function explainQueryPlan(db: DbAdapter, sql: string, params: unknown[]): Promise<unknown[]> {
  if (appConfig.database.backend === "postgres") {
    return (await db.prepare(`EXPLAIN ${sql}`).all(...params)) as unknown[];
  }
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)) as unknown[];
}
