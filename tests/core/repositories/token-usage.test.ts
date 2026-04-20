import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  insertTokenUsage,
  getSessionTokenUsage,
  getGlobalTokenUsage,
  pruneTokenUsage,
  getTokenUsageTimeSeries,
} from "../../../core/repositories/token-usage.ts";

describe("token-usage repository", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      estimated_tokens INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );`);
    db.exec("DELETE FROM token_usage;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("inserts and retrieves token usage", () => {
    const result = insertTokenUsage("s1", 100);
    expect(result.success).toBe(true);
    expect(getSessionTokenUsage("s1")).toBeGreaterThan(0);
  });

  it("returns global usage", () => {
    insertTokenUsage("s1", 100);
    insertTokenUsage("s2", 200);
    const total = getGlobalTokenUsage();
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it("prunes old records", () => {
    insertTokenUsage("s1", 100);
    const result = pruneTokenUsage(Date.now() + 1000);
    expect(result.success).toBe(true);
    expect((result as { success: true; deleted: number }).deleted).toBeGreaterThanOrEqual(0);
  });

  it("returns time series", () => {
    insertTokenUsage("s1", 100);
    const result = getTokenUsageTimeSeries("s1", "hour");
    expect(result.success).toBe(true);
    expect((result as { success: true; data: unknown[] }).data.length).toBeGreaterThanOrEqual(0);
  });
});
