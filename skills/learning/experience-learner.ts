import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { safeJsonParse } from "../../core/safe-utils.ts";

export interface ExperienceRecord {
  id: string;
  sessionId: string;
  taskType: string;
  input: unknown;
  outcome: string;
  embedding: number[];
  timestamp: number;
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec;
  return vec.map((v) => v / magnitude);
}

// Lightweight fallback embedding: character trigram frequency vector (256 dims)
function charTrigramEmbedding(text: string): number[] {
  const vec = new Array(256).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length - 2; i++) {
    const tri = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < tri.length; j++) {
      hash = (hash * 31 + tri.charCodeAt(j)) % 256;
    }
    vec[hash] += 1;
  }
  return normalize(vec);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export class ExperienceLearner {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(process.cwd(), ".ouroboros", "learning.db");
    const dir = join(path, "..");
    mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_experiences (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        input_json TEXT NOT NULL,
        outcome TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_learning_experiences_session ON learning_experiences(session_id);
      CREATE INDEX IF NOT EXISTS idx_learning_experiences_task_type ON learning_experiences(task_type);
    `);
  }

  recordExperience(sessionId: string, taskType: string, input: unknown, outcome: string): ExperienceRecord {
    const id = randomUUID();
    const timestamp = Date.now();
    const embedding = charTrigramEmbedding(JSON.stringify({ input, outcome, taskType }));
    const stmt = this.db.prepare(`
      INSERT INTO learning_experiences (id, session_id, task_type, input_json, outcome, embedding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, sessionId, taskType, JSON.stringify(input), outcome, JSON.stringify(embedding), timestamp);
    return { id, sessionId, taskType, input, outcome, embedding, timestamp };
  }

  retrieveSimilarExperiences(sessionId: string, query: string, topK = 3): ExperienceRecord[] {
    const queryVec = charTrigramEmbedding(query);
    const rows = this.db
      .prepare("SELECT * FROM learning_experiences WHERE session_id = ?")
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      task_type: string;
      input_json: string;
      outcome: string;
      embedding_json: string;
      created_at: number;
    }>;

    const scored = rows.map((row) => {
      const embedding = safeJsonParse<number[]>(row.embedding_json, "experience embedding") ?? [];
      const score = cosineSimilarity(queryVec, embedding);
      return {
        record: {
          id: row.id,
          sessionId: row.session_id,
          taskType: row.task_type,
          input: safeJsonParse(row.input_json, "experience input"),
          outcome: row.outcome,
          embedding,
          timestamp: row.created_at,
        } as ExperienceRecord,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.record);
  }

  close(): void {
    this.db.close();
  }
}
