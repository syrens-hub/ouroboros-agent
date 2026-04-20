import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  getMemoryRecalls24h,
  getMemoryRecallStats,
} from "../../../core/repositories/memory-recalls.ts";

describe("memory-recalls repository", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS memory_recalls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      query TEXT NOT NULL,
      source TEXT,
      result_count INTEGER,
      top_score REAL,
      timestamp INTEGER DEFAULT (unixepoch()*1000)
    );`);
    db.exec("DELETE FROM memory_recalls;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  function seedRecall(sessionId: string, query: string, resultCount: number, topScore: number): void {
    const db = getDb();
    db.prepare(
      "INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(sessionId, query, "source", resultCount, topScore, Date.now());
  }

  it("returns zero when no recalls", async () => {
    const recalls = await getMemoryRecalls24h();
    expect(recalls.success).toBe(true);
    if (recalls.success) expect(recalls.data).toBe(0);
  });

  it("counts recalls from last 24h", async () => {
    seedRecall("s1", "q1", 3, 0.8);
    seedRecall("s2", "q2", 5, 0.9);
    const recalls = await getMemoryRecalls24h();
    expect(recalls.success).toBe(true);
    if (recalls.success) expect(recalls.data).toBe(2);
  });

  it("returns stats", async () => {
    seedRecall("s1", "q1", 3, 0.8);
    seedRecall("s1", "q2", 5, 0.9);
    const stats = await getMemoryRecallStats();
    expect(stats.success).toBe(true);
    if (stats.success) {
      expect(stats.data.totalRecalls).toBe(2);
      expect(stats.data.topSessions.length).toBeGreaterThanOrEqual(1);
    }
  });
});
