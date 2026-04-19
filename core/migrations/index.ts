import type { MigrationFn } from "umzug";
import type { DbAdapter } from "../db-adapter.ts";

type Ctx = { db: DbAdapter; isPostgres: boolean };

const m001: { name: string; up: MigrationFn<Ctx> } = {
  name: "001_initial_schema",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m002: { name: string; up: MigrationFn<Ctx> } = {
  name: "002_modifications_fingerprint",
  async up({ context }) {
    const sql = context.isPostgres
      ? `ALTER TABLE modifications ADD COLUMN IF NOT EXISTS fingerprint TEXT;`
      : `ALTER TABLE modifications ADD COLUMN fingerprint TEXT;`;
    await context.db.exec(sql);
  },
};

const m003: { name: string; up: MigrationFn<Ctx> } = {
  name: "003_sessions_deleted_at",
  async up({ context }) {
    const sql = context.isPostgres
      ? `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at BIGINT;`
      : `ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;`;
    await context.db.exec(sql);
  },
};

const m004: { name: string; up: MigrationFn<Ctx> } = {
  name: "004_self_healing_and_personality",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m005: { name: string; up: MigrationFn<Ctx> } = {
  name: "005_memory_recalls",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m006: { name: string; up: MigrationFn<Ctx> } = {
  name: "006_kb_documents_and_chunks",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m007: { name: string; up: MigrationFn<Ctx> } = {
  name: "007_memory_layers",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m008: { name: string; up: MigrationFn<Ctx> } = {
  name: "008_worker_tasks",
  async up({ context }) {
    const sqlite = `
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
    `;

    const pg = `
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
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m009: { name: string; up: MigrationFn<Ctx> } = {
  name: "009_token_usage",
  async up({ context }) {
    const sqlite = `
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_time ON token_usage(created_at);
    `;

    const pg = `
      CREATE TABLE IF NOT EXISTS token_usage (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_time ON token_usage(created_at);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m010: { name: string; up: MigrationFn<Ctx> } = {
  name: "010_worker_tasks_priority",
  async up({ context }) {
    const sqlite = `
      ALTER TABLE worker_tasks ADD COLUMN priority INTEGER DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_priority ON worker_tasks(priority);
    `;

    const pg = `
      ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_priority ON worker_tasks(priority);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m011: { name: string; up: MigrationFn<Ctx> } = {
  name: "011_messages_search_vector",
  async up({ context }) {
    if (!context.isPostgres) return;
    await context.db.exec(`
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
    `);
  },
};

const m012: { name: string; up: MigrationFn<Ctx> } = {
  name: "012_trace_events",
  async up({ context }) {
    const sqlite = `
      CREATE TABLE IF NOT EXISTS trace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        input TEXT,
        output TEXT,
        latency_ms INTEGER,
        tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_trace_events_session ON trace_events(session_id, turn);
    `;

    const pg = `
      CREATE TABLE IF NOT EXISTS trace_events (
        id SERIAL PRIMARY KEY,
        trace_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn INTEGER NOT NULL,
        timestamp BIGINT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        input TEXT,
        output TEXT,
        latency_ms INTEGER,
        tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_trace_events_session ON trace_events(session_id, turn);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m013: { name: string; up: MigrationFn<Ctx> } = {
  name: "013_skill_registry_security",
  async up({ context }) {
    const sqlite = `
      ALTER TABLE skill_registry ADD COLUMN security_scan TEXT;
      ALTER TABLE skill_registry ADD COLUMN trust_level TEXT DEFAULT 'agent-created';
    `;
    const pg = `
      ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS security_scan TEXT;
      ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS trust_level TEXT DEFAULT 'agent-created';
    `;
    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m014: { name: string; up: MigrationFn<Ctx> } = {
  name: "014_api_audit_log",
  async up({ context }) {
    const sqlite = `
      CREATE TABLE IF NOT EXISTS api_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        request_id TEXT,
        client_ip TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER,
        duration_ms INTEGER,
        user_agent TEXT,
        token_prefix TEXT,
        origin TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_audit_timestamp ON api_audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_api_audit_ip ON api_audit_log(client_ip);
      CREATE INDEX IF NOT EXISTS idx_api_audit_path ON api_audit_log(path);
    `;

    const pg = `
      CREATE TABLE IF NOT EXISTS api_audit_log (
        id SERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        request_id TEXT,
        client_ip TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER,
        duration_ms INTEGER,
        user_agent TEXT,
        token_prefix TEXT,
        origin TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_audit_timestamp ON api_audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_api_audit_ip ON api_audit_log(client_ip);
      CREATE INDEX IF NOT EXISTS idx_api_audit_path ON api_audit_log(path);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m015: { name: string; up: MigrationFn<Ctx> } = {
  name: "015_semantic_cache",
  async up({ context }) {
    const sqlite = `
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        query_embedding BLOB NOT NULL,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        hit_count INTEGER DEFAULT 0,
        ttl_ms INTEGER DEFAULT 86400000
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_cache_model ON semantic_cache(model);
    `;

    const pg = `
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        query_embedding BYTEA NOT NULL,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        hit_count INTEGER DEFAULT 0,
        ttl_ms INTEGER DEFAULT 86400000
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_cache_model ON semantic_cache(model);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

const m016: { name: string; up: MigrationFn<Ctx> } = {
  name: "016_ab_tests",
  async up({ context }) {
    const sqlite = `
      CREATE TABLE IF NOT EXISTS ab_tests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        control_version TEXT NOT NULL,
        treatment_version TEXT NOT NULL,
        traffic_split REAL NOT NULL DEFAULT 0.1,
        status TEXT NOT NULL DEFAULT 'draft',
        started_at INTEGER,
        ended_at INTEGER,
        target_module TEXT,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
      CREATE INDEX IF NOT EXISTS idx_ab_tests_target_module ON ab_tests(target_module);
    `;

    const pg = `
      CREATE TABLE IF NOT EXISTS ab_tests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        control_version TEXT NOT NULL,
        treatment_version TEXT NOT NULL,
        traffic_split REAL NOT NULL DEFAULT 0.1,
        status TEXT NOT NULL DEFAULT 'draft',
        started_at BIGINT,
        ended_at BIGINT,
        target_module TEXT,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
      CREATE INDEX IF NOT EXISTS idx_ab_tests_target_module ON ab_tests(target_module);
    `;

    await context.db.exec(context.isPostgres ? pg : sqlite);
  },
};

export const migrations = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015, m016];
