import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton, dbInitPromise, explainQueryPlan } from "../../core/db-manager.ts";
import { appConfig } from "../../core/config.ts";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const originalUsePostgres = appConfig.db.usePostgres;
const originalPostgresUrl = appConfig.db.postgresUrl;

describe("DB Manager", () => {
  beforeEach(() => {
    appConfig.db.usePostgres = originalUsePostgres;
    appConfig.db.postgresUrl = originalPostgresUrl;
    resetDbSingleton();
  });

  afterEach(() => {
    appConfig.db.usePostgres = originalUsePostgres;
    appConfig.db.postgresUrl = originalPostgresUrl;
    resetDbSingleton();
  });

  it("getDb returns a DbAdapter with required methods", () => {
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.exec).toBe("function");
  });

  it("getDb returns the same instance on repeated calls", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("resetDbSingleton resets the instance so a new one is created", () => {
    const db1 = getDb();
    resetDbSingleton();
    const db2 = getDb();
    expect(db2).toBeDefined();
    // The underlying DB object should be different after reset
    expect(db1).not.toBe(db2);
  });

  it("dbInitPromise is null for SQLite backend", () => {
    getDb();
    expect(dbInitPromise).toBeNull();
  });

  it("can execute a simple query after initialization", () => {
    const db = getDb();
    const row = db.prepare("SELECT 1 as n").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("resetDbSingleton removes the lock file for the current process", () => {
    getDb();
    const baseDir = appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
    const dir = process.env.VITEST && appConfig.db.dir === ".ouroboros" ? join(baseDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`) : baseDir;
    const lockPath = join(dir, "session.lock");
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));
    resetDbSingleton();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("throws when USE_POSTGRES is true but postgresUrl is missing", () => {
    appConfig.db.usePostgres = true;
    appConfig.db.postgresUrl = "";
    resetDbSingleton();
    expect(() => getDb()).toThrow("USE_POSTGRES is enabled but DATABASE_URL is not set");
  });

  it("throws when USE_POSTGRES is true but postgresUrl is missing", () => {
    appConfig.db.usePostgres = true;
    appConfig.db.postgresUrl = "";
    resetDbSingleton();
    expect(() => getDb()).toThrow("USE_POSTGRES is enabled but DATABASE_URL is not set");
  });

  it("explainQueryPlan returns rows for SQLite", async () => {
    const db = getDb();
    const testId = `explain_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run(testId, "T");
    const plan = await explainQueryPlan(db, "SELECT * FROM sessions WHERE id = ?", [testId]);
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });
});
