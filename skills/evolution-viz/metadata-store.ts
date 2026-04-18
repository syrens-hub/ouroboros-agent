import Database from "better-sqlite3";
import { existsSync, mkdirSync, appendFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface EvolutionRecord {
  id: string;
  commitHash: string;
  trigger: string;
  costUsd: number;
  reviewerModels: string[];
  userDecision: "approved" | "rejected" | "auto";
  riskLevel: number;
  status: "pending" | "running" | "completed" | "rolled_back";
  createdAt: number;
}

const OuroborosDir = join(process.cwd(), ".ouroboros");
const DbDir = process.env.VITEST
  ? join(OuroborosDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`)
  : OuroborosDir;
const DbPath = join(DbDir, "evolution.db");
const JsonlPath = join(OuroborosDir, "evolution-log.jsonl");

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  if (!existsSync(DbDir)) mkdirSync(DbDir, { recursive: true });
  dbInstance = new Database(DbPath);
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS evolution_log (
      id TEXT PRIMARY KEY,
      commitHash TEXT NOT NULL,
      trigger TEXT NOT NULL,
      costUsd REAL NOT NULL DEFAULT 0,
      reviewerModels TEXT NOT NULL DEFAULT '[]',
      userDecision TEXT NOT NULL DEFAULT 'auto',
      riskLevel INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evolution_commit ON evolution_log(commitHash);
    CREATE INDEX IF NOT EXISTS idx_evolution_created ON evolution_log(createdAt);
  `);
  return dbInstance;
}

export function resetMetadataDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  try {
    if (existsSync(DbPath)) {
      unlinkSync(DbPath);
    }
  } catch {
    // ignore
  }
}

export function logEvolution(
  record: Omit<EvolutionRecord, "id" | "createdAt"> & { createdAt?: number }
): EvolutionRecord {
  const db = getDb();
  const id = randomUUID();
  const createdAt = record.createdAt ?? Date.now();
  const full: EvolutionRecord = { ...record, id, createdAt };

  const stmt = db.prepare(`
    INSERT INTO evolution_log (id, commitHash, trigger, costUsd, reviewerModels, userDecision, riskLevel, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    full.id,
    full.commitHash,
    full.trigger,
    full.costUsd,
    JSON.stringify(full.reviewerModels),
    full.userDecision,
    full.riskLevel,
    full.status,
    full.createdAt
  );

  // Append-only JSONL
  try {
    appendFileSync(JsonlPath, JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // Best-effort JSONL write
  }

  return full;
}

export function getEvolutionLog(): EvolutionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, commitHash, trigger, costUsd, reviewerModels, userDecision, riskLevel, status, createdAt
       FROM evolution_log ORDER BY createdAt DESC`
    )
    .all() as Array<{
      id: string;
      commitHash: string;
      trigger: string;
      costUsd: number;
      reviewerModels: string;
      userDecision: string;
      riskLevel: number;
      status: string;
      createdAt: number;
    }>;

  return rows.map((r) => ({
    ...r,
    reviewerModels: safeParseJson(r.reviewerModels),
    userDecision: r.userDecision as EvolutionRecord["userDecision"],
    status: r.status as EvolutionRecord["status"],
  }));
}

export function getEvolutionByCommit(hash: string): EvolutionRecord | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, commitHash, trigger, costUsd, reviewerModels, userDecision, riskLevel, status, createdAt
       FROM evolution_log WHERE commitHash = ? ORDER BY createdAt DESC LIMIT 1`
    )
    .get(hash) as
    | {
        id: string;
        commitHash: string;
        trigger: string;
        costUsd: number;
        reviewerModels: string;
        userDecision: string;
        riskLevel: number;
        status: string;
        createdAt: number;
      }
    | undefined;

  if (!row) return undefined;
  return {
    ...row,
    reviewerModels: safeParseJson(row.reviewerModels),
    userDecision: row.userDecision as EvolutionRecord["userDecision"],
    status: row.status as EvolutionRecord["status"],
  };
}

function safeParseJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
