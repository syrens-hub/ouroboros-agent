/**
 * Database Manager
 * ================
 * Connection singleton, file locking (SQLite), and schema migrations.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";
import type { DbAdapter } from "./db-adapter.ts";
import { PgDbAdapter, isPgAvailable } from "./db-pg.ts";

function getDbDir(): string {
  return appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
}

function getDbPath(): string {
  return join(getDbDir(), "session.db");
}

function getLockFilePath(): string {
  return join(getDbDir(), "session.lock");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore
      }
    });
  }
}

let dbInstance: DbAdapter | null = null;

export function resetDbSingleton(): void {
  if (dbInstance) {
    try {
      const closeResult = dbInstance.close();
      if (closeResult && typeof (closeResult as Promise<void>).then === "function") {
        // async close in progress; we won't await it here
      }
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  try {
    const lockPath = getLockFilePath();
    if (existsSync(lockPath)) {
      const content = readFileSync(lockPath, "utf-8").trim();
      if (content === String(process.pid)) {
        unlinkSync(lockPath);
      }
    }
  } catch {
    // ignore
  }
}

export function getDb(): DbAdapter {
  if (!dbInstance) {
    if (appConfig.db.usePostgres) {
      if (!appConfig.db.postgresUrl) {
        throw new Error("USE_POSTGRES is enabled but DATABASE_URL is not set.");
      }
      if (!isPgAvailable()) {
        throw new Error("PostgreSQL driver is not installed. Run: npm install pg");
      }
      dbInstance = new PgDbAdapter(appConfig.db.postgresUrl);
      initSchema(dbInstance);
      logger.info("Using PostgreSQL backend");
    } else {
      const dir = getDbDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      acquireDbLock();
      const db = new Database(getDbPath()) as unknown as DbAdapter;
      try {
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        runSqliteMigrations(db);
        const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
        const integrityResult = integrity[0]?.integrity_check ?? "ok";
        if (integrityResult !== "ok") {
          logger.error("Database integrity check failed", { result: integrityResult });
          throw new Error(`Database integrity check failed: ${integrityResult}`);
        }
        dbInstance = db;
      } catch (e) {
        try { db.close(); } catch { /* ignore close errors during cleanup */ }
        throw e;
      }
    }
  }
  return dbInstance;
}

const SQLITE_MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT,
        title TEXT,
        model TEXT,
        provider TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (unixepoch()*1000),
        updated_at INTEGER DEFAULT (unixepoch()*1000),
        message_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0,
        turn_count INTEGER DEFAULT 0,
        estimated_cost_usd REAL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        name TEXT,
        tool_calls TEXT,
        timestamp INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content)
        VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      END;

      CREATE TABLE IF NOT EXISTS trajectories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn INTEGER,
        entries TEXT NOT NULL,
        outcome TEXT,
        summary TEXT,
        compressed INTEGER DEFAULT 0,
        timestamp INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_trajectories_session ON trajectories(session_id);

      CREATE TABLE IF NOT EXISTS skill_registry (
        name TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        frontmatter TEXT NOT NULL,
        auto_load INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()*1000),
        updated_at INTEGER DEFAULT (unixepoch()*1000),
        usage_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS modifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        type TEXT NOT NULL,
        description TEXT,
        rationale TEXT,
        estimated_risk TEXT,
        decision TEXT,
        executed INTEGER,
        timestamp INTEGER DEFAULT (unixepoch()*1000)
      );
    `,
  },
  {
    id: 2,
    sql: `ALTER TABLE modifications ADD COLUMN fingerprint TEXT;`,
  },
  {
    id: 3,
    sql: `ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;`,
  },
  {
    id: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp INTEGER DEFAULT (unixepoch()*1000),
        messages TEXT NOT NULL,
        memory_state TEXT NOT NULL,
        tool_states TEXT NOT NULL,
        config TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);

      CREATE TABLE IF NOT EXISTS rollback_points (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        description TEXT,
        timestamp INTEGER DEFAULT (unixepoch()*1000),
        parent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS repair_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        severity TEXT,
        error_message TEXT,
        context TEXT,
        success INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        solution TEXT,
        rollback_performed INTEGER DEFAULT 0,
        timestamp INTEGER DEFAULT (unixepoch()*1000)
      );

      CREATE TABLE IF NOT EXISTS personality_anchors (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        category TEXT,
        importance REAL DEFAULT 0.5,
        created_at INTEGER DEFAULT (unixepoch()*1000),
        reinforcement_count INTEGER DEFAULT 1,
        last_accessed_at INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_personality_anchors_session ON personality_anchors(session_id);

      CREATE TABLE IF NOT EXISTS dreaming_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        context TEXT,
        type TEXT,
        timestamp INTEGER DEFAULT (unixepoch()*1000),
        access_count INTEGER DEFAULT 0,
        last_access INTEGER DEFAULT (unixepoch()*1000),
        query_diversity INTEGER DEFAULT 0,
        relevance REAL DEFAULT 0,
        consolidation REAL DEFAULT 0,
        score REAL,
        phase TEXT DEFAULT 'light'
      );
      CREATE INDEX IF NOT EXISTS idx_dreaming_entries_session ON dreaming_entries(session_id);
    `,
  },
  {
    id: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS personality_anchors (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        category TEXT,
        importance REAL DEFAULT 0.5,
        created_at INTEGER DEFAULT (unixepoch()*1000),
        reinforcement_count INTEGER DEFAULT 1,
        last_accessed_at INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_personality_anchors_session ON personality_anchors(session_id);

      CREATE TABLE IF NOT EXISTS dreaming_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        context TEXT,
        type TEXT,
        timestamp INTEGER DEFAULT (unixepoch()*1000),
        access_count INTEGER DEFAULT 0,
        last_access INTEGER DEFAULT (unixepoch()*1000),
        query_diversity INTEGER DEFAULT 0,
        relevance REAL DEFAULT 0,
        consolidation REAL DEFAULT 0,
        score REAL,
        phase TEXT DEFAULT 'light'
      );
      CREATE INDEX IF NOT EXISTS idx_dreaming_entries_session ON dreaming_entries(session_id);
    `,
  },
  {
    id: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_recalls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        query TEXT NOT NULL,
        source TEXT,
        result_count INTEGER,
        top_score REAL,
        timestamp INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_recalls_session ON memory_recalls(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_recalls_time ON memory_recalls(timestamp);
    `,
  },
  {
    id: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        format TEXT NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE kb_chunks ADD COLUMN promotion_score REAL DEFAULT 0;
      ALTER TABLE memory_recalls ADD COLUMN details TEXT;
    `,
  },
  {
    id: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        layer TEXT NOT NULL,
        source_path TEXT,
        content TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER DEFAULT (unixepoch()*1000),
        updated_at INTEGER DEFAULT (unixepoch()*1000),
        score REAL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_memory_layers_session ON memory_layers(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_layers_layer ON memory_layers(layer);
    `,
  },
  {
    id: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS worker_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_session_id TEXT NOT NULL,
        worker_session_id TEXT NOT NULL,
        task_name TEXT,
        task_description TEXT,
        allowed_tools TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        error TEXT,
        created_at INTEGER DEFAULT (unixepoch()*1000),
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_status ON worker_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_parent ON worker_tasks(parent_session_id);
    `,
  },
  {
    id: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_time ON token_usage(created_at);
    `,
  },
  {
    id: 11,
    sql: `
      ALTER TABLE worker_tasks ADD COLUMN priority INTEGER DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_priority ON worker_tasks(priority);
    `,
  },
];

const PG_MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT,
        title TEXT,
        model TEXT,
        provider TEXT,
        status TEXT DEFAULT 'active',
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        message_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0,
        turn_count INTEGER DEFAULT 0,
        estimated_cost_usd REAL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        name TEXT,
        tool_calls TEXT,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;
      CREATE INDEX IF NOT EXISTS idx_messages_fts ON messages USING GIN (search_vector);

      CREATE OR REPLACE FUNCTION messages_fts_update()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS messages_ai ON messages;
      CREATE TRIGGER messages_ai
      BEFORE INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_fts_update();

      DROP TRIGGER IF EXISTS messages_au ON messages;
      CREATE TRIGGER messages_au
      BEFORE UPDATE ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_fts_update();

      CREATE TABLE IF NOT EXISTS trajectories (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn INTEGER,
        entries TEXT NOT NULL,
        outcome TEXT,
        summary TEXT,
        compressed INTEGER DEFAULT 0,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_trajectories_session ON trajectories(session_id);

      CREATE TABLE IF NOT EXISTS skill_registry (
        name TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        frontmatter TEXT NOT NULL,
        auto_load INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        usage_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS modifications (
        id SERIAL PRIMARY KEY,
        session_id TEXT,
        type TEXT NOT NULL,
        description TEXT,
        rationale TEXT,
        estimated_risk TEXT,
        decision TEXT,
        executed INTEGER,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
    `,
  },
  {
    id: 2,
    sql: `ALTER TABLE modifications ADD COLUMN IF NOT EXISTS fingerprint TEXT;`,
  },
  {
    id: 3,
    sql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at BIGINT;`,
  },
  {
    id: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        messages TEXT NOT NULL,
        memory_state TEXT NOT NULL,
        tool_states TEXT NOT NULL,
        config TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);

      CREATE TABLE IF NOT EXISTS rollback_points (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        description TEXT,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        parent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS repair_history (
        id SERIAL PRIMARY KEY,
        category TEXT,
        severity TEXT,
        error_message TEXT,
        context TEXT,
        success INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        solution TEXT,
        rollback_performed INTEGER DEFAULT 0,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );

      CREATE TABLE IF NOT EXISTS personality_anchors (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        category TEXT,
        importance REAL DEFAULT 0.5,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        reinforcement_count INTEGER DEFAULT 1,
        last_accessed_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_personality_anchors_session ON personality_anchors(session_id);

      CREATE TABLE IF NOT EXISTS dreaming_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        context TEXT,
        type TEXT,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        access_count INTEGER DEFAULT 0,
        last_access BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        query_diversity INTEGER DEFAULT 0,
        relevance REAL DEFAULT 0,
        consolidation REAL DEFAULT 0,
        score REAL,
        phase TEXT DEFAULT 'light'
      );
      CREATE INDEX IF NOT EXISTS idx_dreaming_entries_session ON dreaming_entries(session_id);
    `,
  },
  {
    id: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS personality_anchors (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        category TEXT,
        importance REAL DEFAULT 0.5,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        reinforcement_count INTEGER DEFAULT 1,
        last_accessed_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_personality_anchors_session ON personality_anchors(session_id);

      CREATE TABLE IF NOT EXISTS dreaming_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        context TEXT,
        type TEXT,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        access_count INTEGER DEFAULT 0,
        last_access BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        query_diversity INTEGER DEFAULT 0,
        relevance REAL DEFAULT 0,
        consolidation REAL DEFAULT 0,
        score REAL,
        phase TEXT DEFAULT 'light'
      );
      CREATE INDEX IF NOT EXISTS idx_dreaming_entries_session ON dreaming_entries(session_id);
    `,
  },
  {
    id: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_recalls (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        query TEXT NOT NULL,
        source TEXT,
        result_count INTEGER,
        top_score REAL,
        timestamp BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_memory_recalls_session ON memory_recalls(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_recalls_time ON memory_recalls(timestamp);
    `,
  },
  {
    id: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        format TEXT NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        chunk_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        created_at BIGINT NOT NULL
      );
      ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS promotion_score REAL DEFAULT 0;
      ALTER TABLE memory_recalls ADD COLUMN IF NOT EXISTS details TEXT;
    `,
  },
  {
    id: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_layers (
        id SERIAL PRIMARY KEY,
        session_id TEXT,
        layer TEXT NOT NULL,
        source_path TEXT,
        content TEXT NOT NULL,
        summary TEXT,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        score REAL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_memory_layers_session ON memory_layers(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_layers_layer ON memory_layers(layer);
    `,
  },
  {
    id: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS worker_tasks (
        id SERIAL PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        worker_session_id TEXT NOT NULL,
        task_name TEXT,
        task_description TEXT,
        allowed_tools TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        error TEXT,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
        started_at BIGINT,
        completed_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_status ON worker_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_parent ON worker_tasks(parent_session_id);
    `,
  },
  {
    id: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS token_usage (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_time ON token_usage(created_at);
    `,
  },
  {
    id: 11,
    sql: `
      ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_priority ON worker_tasks(priority);
    `,
  },
];

function runSqliteMigrations(db: DbAdapter) {
  const migrationsTableSql = `CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    applied_at INTEGER DEFAULT (unixepoch()*1000)
  );`;
  db.exec(migrationsTableSql);
  const appliedRows = db.prepare("SELECT id FROM migrations").all() as { id: number }[];
  const applied = new Set(appliedRows.map((r) => r.id));
  for (const m of SQLITE_MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT OR IGNORE INTO migrations (id) VALUES (?)").run(m.id);
    });
    try {
      run();
    } catch (e) {
      const msg = String(e).toLowerCase();
      if (msg.includes("duplicate column") || msg.includes("already exists") || msg.includes("column already exists")) {
        db.prepare("INSERT OR IGNORE INTO migrations (id) VALUES (?)").run(m.id);
      } else {
        throw e;
      }
    }
  }
}

async function runPostgresMigrations(db: DbAdapter) {
  const migrationsTableSql = `CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    applied_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
  );`;
  await db.exec(migrationsTableSql);
  const appliedRows = await db.prepare("SELECT id FROM migrations").all();
  const applied = new Set((appliedRows as { id: number }[]).map((r) => r.id));
  for (const m of PG_MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const run = db.transaction(async () => {
      await db.exec(m.sql);
      await db.prepare("INSERT INTO migrations (id) VALUES ($1) ON CONFLICT DO NOTHING").run(m.id);
    });
    try {
      await run();
    } catch (e) {
      const msg = String(e).toLowerCase();
      if (msg.includes("duplicate column") || msg.includes("already exists") || msg.includes("column already exists")) {
        await db.prepare("INSERT INTO migrations (id) VALUES ($1) ON CONFLICT DO NOTHING").run(m.id);
      } else {
        throw e;
      }
    }
  }
}

async function runMigrations(db: DbAdapter, isPostgres: boolean) {
  if (isPostgres) {
    await runPostgresMigrations(db);
  } else {
    runSqliteMigrations(db);
  }
}

export async function initSchema(db: DbAdapter) {
  await runMigrations(db, appConfig.db.usePostgres);
}

export async function explainQueryPlan(db: DbAdapter, sql: string, params: unknown[]): Promise<unknown[]> {
  if (appConfig.db.usePostgres) {
    return (await db.prepare(`EXPLAIN ${sql}`).all(...params)) as unknown[];
  }
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)) as unknown[];
}
