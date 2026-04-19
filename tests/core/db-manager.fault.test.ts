import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDb, getDbAsync, resetDbSingleton } from "../../core/db-manager.ts";
import { appConfig } from "../../core/config.ts";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const originalUsePostgres = appConfig.db.usePostgres;
const originalPostgresUrl = appConfig.db.postgresUrl;

let execThrowPattern: string | null = null;
const pragmaOverride = new Map<string, unknown>();
let pgAdapterThrow: Error | null = null;

vi.mock("better-sqlite3", async () => {
  const actual = await vi.importActual<typeof import("better-sqlite3")>("better-sqlite3");
  return {
    default: class MockDatabase extends (actual as any).default {
      pragma(cmd: string) {
        const override = pragmaOverride.get(cmd);
        if (override !== undefined) {
          return override;
        }
        return super.pragma(cmd);
      }
      exec(sql: string) {
        if (execThrowPattern && sql.includes(execThrowPattern)) {
          throw new Error(`Injected exec failure for: ${sql}`);
        }
        return super.exec(sql);
      }
    },
  };
});

vi.mock("../../core/db-pg.ts", () => ({
  PgDbAdapter: class MockPgDbAdapter {
    constructor() {
      if (pgAdapterThrow) throw pgAdapterThrow;
    }
  },
  isPgAvailable: () => true,
}));

describe("db-manager fault injection", () => {
  beforeEach(() => {
    resetDbSingleton();
    vi.restoreAllMocks();
    appConfig.db.usePostgres = originalUsePostgres;
    appConfig.db.postgresUrl = originalPostgresUrl;
    execThrowPattern = null;
    pragmaOverride.clear();
    pgAdapterThrow = null;
  });

  it("DB 锁冲突（SQLite）: throws when another process holds session.lock", () => {
    const baseDir = appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
    const dir = process.env.VITEST && appConfig.db.dir === ".ouroboros"
      ? join(baseDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`)
      : baseDir;
    const lockPath = join(dir, "session.lock");

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, "99999", "utf-8");

    vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (pid === 99999 && signal === 0) return true;
      const err = new Error("ESRCH") as Error & { code: string };
      err.code = "ESRCH";
      throw err;
    });

    expect(() => getDb()).toThrow("Database is already locked");

    if (existsSync(lockPath)) unlinkSync(lockPath);
  });

  it("迁移执行失败: closes db connection when exec fails during migration", async () => {
    execThrowPattern = "BEGIN IMMEDIATE";

    const { default: Database } = await import("better-sqlite3");
    const closeSpy = vi.spyOn(Database.prototype, "close");

    expect(() => getDb()).toThrow();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("完整性检查失败: throws when integrity_check returns non-ok", () => {
    pragmaOverride.set("integrity_check", [{ integrity_check: "corrupt" }]);

    expect(() => getDb()).toThrow("Database integrity check failed");
  });

  it("PostgreSQL 连接池超时/断开: propagates PgDbAdapter constructor error through getDbAsync", async () => {
    appConfig.db.usePostgres = true;
    appConfig.db.postgresUrl = "postgres://localhost";
    pgAdapterThrow = new Error("PostgreSQL connection pool failed");

    await expect(getDbAsync()).rejects.toThrow("PostgreSQL connection pool failed");
  });

  it("并发初始化竞态: concurrent getDbAsync calls return the same instance", async () => {
    const [db1, db2] = await Promise.all([getDbAsync(), getDbAsync()]);
    expect(db1).toBe(db2);
  });
});
