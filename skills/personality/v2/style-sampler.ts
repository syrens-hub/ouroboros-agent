import { randomUUID } from "crypto";
import { getDb } from "../../../core/db-manager.ts";
import type { DbAdapter } from "../../../core/db-adapter.ts";

export interface StyleSample {
  id: string;
  message: string;
  rating: number;
  sessionId: string | null;
  createdAt: number;
}

export function initStyleSamplerTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS style_samples (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      rating INTEGER NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_style_samples_rating ON style_samples(rating);
    CREATE INDEX IF NOT EXISTS idx_style_samples_created ON style_samples(created_at);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initStyleSamplerTables(db);
}

export function recordStyleSample(message: string, rating: number): void {
  ensureInitialized();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO style_samples (id, message, rating, session_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, message, rating, null, now);
}

export function getStyleSamples(limit = 10): StyleSample[] {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, message, rating, session_id, created_at
     FROM style_samples
     ORDER BY rating DESC, created_at DESC
     LIMIT ?`
  ).all(limit) as unknown[];
  return rows.map(rowToStyleSample);
}

export function formatStylePrompt(): string {
  const samples = getStyleSamples(5);
  if (samples.length === 0) {
    return "";
  }
  const examples = samples.map((s, i) => `${i + 1}. ${s.message}`).join("\n");
  return `Examples of my style:\n${examples}`;
}

function rowToStyleSample(row: unknown): StyleSample {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    message: String(r.message),
    rating: Number(r.rating),
    sessionId: r.session_id ? String(r.session_id) : null,
    createdAt: Number(r.created_at),
  };
}
