import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appConfig } from "../../../core/config.ts";
import { createBackup, listBackups, restoreBackup, maybeAutoBackup } from "../../../skills/backup/index.ts";
import { createSession, getSession, resetDbSingleton } from "../../../core/session-db.ts";

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), "ouroboros-backup-"));
const TEST_DB_PATH = join(TEST_DB_DIR, "session.db");

describe("Backup", () => {
  beforeEach(() => {
    appConfig.db.dir = TEST_DB_DIR;
    process.env.DATABASE_PATH = TEST_DB_PATH;
    resetDbSingleton();
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    resetDbSingleton();
    delete process.env.DATABASE_PATH;
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("lists backups as empty when none exist", () => {
    const backups = listBackups();
    expect(backups.length).toBe(0);
  });

  it("creates a backup file", async () => {
    await createSession("b1", {});
    const result = await createBackup();
    expect(result.success).toBe(true);
    expect(result.filename).toBeDefined();
    const backups = listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].filename).toBe(result.filename);
  });

  it("rejects invalid filenames with path traversal", () => {
    const result = restoreBackup("../../../etc/passwd");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid filename");
  });

  it("restores a backup", async () => {
    await createSession("restore_test", { title: "Before" });
    const backup = await createBackup();
    expect(backup.success).toBe(true);

    // mutate db
    resetDbSingleton();
    await createSession("new", {});

    // restore
    const restore = restoreBackup(backup.filename!);
    expect(restore.success).toBe(true);

    resetDbSingleton();
    const session = await getSession("restore_test");
    expect(session.success).toBe(true);
    if (!session.success) throw new Error("expected success");
    expect(session.data).toBeDefined();
    expect((session.data as { title: string }).title).toBe("Before");
  });

  it("maybeAutoBackup creates backup when none exist", async () => {
    expect(listBackups().length).toBe(0);
    await maybeAutoBackup();
    expect(listBackups().length).toBe(1);
  });

  it("prunes old backups beyond max", async () => {
    for (let i = 0; i < 12; i++) {
      await createBackup();
      await new Promise((r) => setTimeout(r, 10));
    }
    const backups = listBackups();
    expect(backups.length).toBeLessThanOrEqual(10);
  });
});
