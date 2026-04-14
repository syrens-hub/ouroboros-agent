import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";

export interface AdaptiveConfig {
  temperature: number;
  maxTokens: number;
  pruningStrategy: string;
  contextBudget: number;
}

export class AdaptiveOptimizer {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(process.cwd(), ".ouroboros", "adaptive.db");
    const dir = join(path, "..");
    mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS adaptive_configs (
        session_id TEXT NOT NULL,
        temperature REAL NOT NULL,
        max_tokens INTEGER NOT NULL,
        pruning_strategy TEXT NOT NULL,
        context_budget INTEGER NOT NULL,
        success_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, temperature, max_tokens, pruning_strategy, context_budget)
      );
      CREATE INDEX IF NOT EXISTS idx_adaptive_configs_session ON adaptive_configs(session_id);
    `);
  }

  recordResult(sessionId: string, config: AdaptiveConfig, success: boolean): void {
    const stmt = this.db.prepare(`
      INSERT INTO adaptive_configs (
        session_id, temperature, max_tokens, pruning_strategy, context_budget,
        success_count, total_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, temperature, max_tokens, pruning_strategy, context_budget)
      DO UPDATE SET
        success_count = success_count + excluded.success_count,
        total_count = total_count + excluded.total_count,
        updated_at = excluded.updated_at
    `);
    const updatedAt = Date.now();
    stmt.run(
      sessionId,
      config.temperature,
      config.maxTokens,
      config.pruningStrategy,
      config.contextBudget,
      success ? 1 : 0,
      1,
      updatedAt
    );
  }

  suggestConfig(sessionId: string): AdaptiveConfig | null {
    const rows = this.db.prepare(`
      SELECT temperature, max_tokens, pruning_strategy, context_budget,
             success_count, total_count
      FROM adaptive_configs
      WHERE session_id = ? AND total_count >= 3
      ORDER BY CAST(success_count AS REAL) / total_count DESC, total_count DESC
    `).all(sessionId) as Array<{
      temperature: number;
      max_tokens: number;
      pruning_strategy: string;
      context_budget: number;
      success_count: number;
      total_count: number;
    }>;

    // Epsilon-greedy: 10% random exploration
    if (Math.random() < 0.1) {
      const allRows = this.db.prepare(`
        SELECT temperature, max_tokens, pruning_strategy, context_budget
        FROM adaptive_configs
        WHERE session_id = ?
      `).all(sessionId) as Array<{
        temperature: number;
        max_tokens: number;
        pruning_strategy: string;
        context_budget: number;
      }>;
      if (allRows.length > 0) {
        const random = allRows[Math.floor(Math.random() * allRows.length)];
        return {
          temperature: random.temperature,
          maxTokens: random.max_tokens,
          pruningStrategy: random.pruning_strategy,
          contextBudget: random.context_budget,
        };
      }
      return null;
    }

    if (rows.length === 0) return null;
    const best = rows[0];
    return {
      temperature: best.temperature,
      maxTokens: best.max_tokens,
      pruningStrategy: best.pruning_strategy,
      contextBudget: best.context_budget,
    };
  }

  close(): void {
    this.db.close();
  }
}
