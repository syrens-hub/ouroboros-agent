/**
 * Database Backup & Restore
 * ===========================
 * Automated SQLite backups with WAL checkpointing.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, rmSync } from "fs";
import { join, basename, dirname } from "path";
import { appConfig } from "../../core/config.ts";
import { getDb, resetDbSingleton } from "../../core/session-db.ts";
import { logger } from "../../core/logger.ts";
import { safeIgnore } from "../../core/safe-utils.ts";

function getDbDir(): string {
  // Mirror db-manager.ts path resolution exactly
  if (appConfig.database.backend === "sqlite") {
    const configuredPath = appConfig.database.sqlite.path;
    const baseDir = configuredPath.startsWith("/")
      ? dirname(configuredPath)
      : join(process.cwd(), dirname(configuredPath));
    // Auto-isolate SQLite databases per Vitest worker
    if (process.env.VITEST && appConfig.db.dir === ".ouroboros") {
      return join(baseDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`);
    }
    return baseDir;
  }
  return appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir);
}

function getDbPath(): string {
  if (appConfig.database.backend === "sqlite") {
    return join(getDbDir(), basename(appConfig.database.sqlite.path));
  }
  return join(getDbDir(), "session.db");
}

function getBackupDir(): string {
  return join(getDbDir(), "backups");
}

const MAX_DB_BACKUPS = appConfig.cleanup.maxDbBackups;

function ensureBackupDir() {
  const dir = getBackupDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listBackups(): { filename: string; sizeBytes: number; createdAt: number }[] {
  ensureBackupDir();
  const dir = getBackupDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { filename: f, sizeBytes: st.size, createdAt: st.mtime.getTime() };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  return files;
}

export function createFileBackup(filePath: string): { success: boolean; backupPath?: string; error?: string } {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: "File does not exist" };
    }
    const timestamp = Date.now();
    const backupPath = filePath + ".bak." + timestamp;
    copyFileSync(filePath, backupPath);
    return { success: true, backupPath };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function createBackup(): Promise<{ success: boolean; filename?: string; path?: string; error?: string }> {
  ensureBackupDir();
  try {
    const db = getDb();
    // Checkpoint WAL into main database for a consistent snapshot (SQLite only)
    const pragmaResult = db.pragma("wal_checkpoint(TRUNCATE)");
    if (pragmaResult && typeof (pragmaResult as Promise<unknown>).then === "function") {
      await (pragmaResult as Promise<unknown>);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `session-${timestamp}.db`;
    const backupPath = join(getBackupDir(), filename);
    copyFileSync(getDbPath(), backupPath);
    pruneOldBackups();
    logger.info("Database backup created", { filename, path: backupPath });
    return { success: true, filename, path: backupPath };
  } catch (e) {
    logger.error("Database backup failed", { error: String(e) });
    return { success: false, error: String(e) };
  }
}

function pruneOldBackups() {
  const files = listBackups();
  if (files.length > MAX_DB_BACKUPS) {
    for (const f of files.slice(MAX_DB_BACKUPS)) {
      safeIgnore(() => {
        unlinkSync(join(getBackupDir(), f.filename));
        logger.info("Pruned old DB backup", { filename: f.filename });
      }, "pruneOldBackups");
    }
  }
}

function getEvolutionBackupDir(): string {
  return join(getDbDir(), "backups");
}

/** Prune evolution backups (evo-* directories) by count and age. */
export function pruneEvolutionBackups(): { pruned: number; errors: string[] } {
  const dir = getEvolutionBackupDir();
  const maxCount = appConfig.cleanup.maxEvolutionBackups;
  const retentionMs = appConfig.cleanup.retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const errors: string[] = [];
  let pruned = 0;

  if (!existsSync(dir)) return { pruned, errors };

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("evo-"))
    .map((e) => {
      const st = statSync(join(dir, e.name));
      return { name: e.name, mtime: st.mtime.getTime() };
    })
    .sort((a, b) => b.mtime - a.mtime);

  // Age-based pruning
  for (const entry of entries) {
    if (entry.mtime < cutoff) {
      safeIgnore(() => {
        const entryPath = join(dir, entry.name);
        // Recursively remove directory
        rmSync(entryPath, { recursive: true, force: true });
        pruned++;
        logger.info("Pruned old evolution backup", { name: entry.name, ageDays: Math.round((Date.now() - entry.mtime) / 86400000) });
      }, `pruneEvolutionBackups:${entry.name}`);
    }
  }

  // Count-based pruning (after age pruning, if still over limit)
  const remaining = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("evo-"))
    .map((e) => {
      const st = statSync(join(dir, e.name));
      return { name: e.name, mtime: st.mtime.getTime() };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (remaining.length > maxCount) {
    for (const entry of remaining.slice(maxCount)) {
      safeIgnore(() => {
        rmSync(join(dir, entry.name), { recursive: true, force: true });
        pruned++;
        logger.info("Pruned excess evolution backup", { name: entry.name });
      }, `pruneEvolutionBackups:${entry.name}`);
    }
  }

  return { pruned, errors };
}

export function restoreBackup(filename: string): { success: boolean; error?: string } {
  const safeFilename = basename(filename);
  if (safeFilename !== filename || safeFilename.includes("..") || safeFilename.includes("/") || safeFilename.includes("\\")) {
    return { success: false, error: "Invalid filename" };
  }
  const backupPath = join(getBackupDir(), safeFilename);
  if (!existsSync(backupPath)) {
    return { success: false, error: "Backup not found" };
  }
  try {
    resetDbSingleton();
    const dbPath = getDbPath();
    const tmpPath = dbPath + ".restore.tmp";
    copyFileSync(backupPath, tmpPath);
    renameSync(tmpPath, dbPath);
    logger.info("Database restored from backup", { filename });
    return { success: true };
  } catch (e) {
    logger.error("Database restore failed", { error: String(e) });
    return { success: false, error: String(e) };
  }
}

export async function maybeAutoBackup(): Promise<void> {
  ensureBackupDir();
  const files = listBackups();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (files.length === 0 || Date.now() - files[0].createdAt > oneDayMs) {
    await createBackup();
  }
}
