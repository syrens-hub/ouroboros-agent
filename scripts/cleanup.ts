#!/usr/bin/env node
/**
 * Ouroboros Runtime Cleanup
 * ==========================
 * Manually prune old backups, checkpoints, and temporary files
 * from the .ouroboros directory to prevent disk bloat.
 *
 * Usage:
 *   npx tsx scripts/cleanup.ts [--dry-run]
 */

import { existsSync, readdirSync, statSync, rmSync } from "fs";
import { join, resolve } from "path";
import { appConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { pruneEvolutionBackups } from "../skills/backup/index.ts";
import { pruneOldCheckpoints } from "../skills/checkpoint/index.ts";

const PROJECT_ROOT = resolve(process.cwd());
const OUROBOROS_DIR = resolve(PROJECT_ROOT, appConfig.db.dir);

const DRY_RUN = process.argv.includes("--dry-run");

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getDirSize(dir: string): number {
  let size = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          size += statSync(full).size;
        }
      }
    } catch {
      // ignore unreadable
    }
  }
  return size;
}

function deleteIfOld(dir: string, prefix: string, maxAgeMs: number): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { count, bytes };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    const full = join(dir, entry.name);
    const st = statSync(full);
    const age = Date.now() - st.mtime.getTime();
    if (age > maxAgeMs) {
      const entrySize = st.isDirectory() ? getDirSize(full) : st.size;
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would delete: ${full} (${formatBytes(entrySize)}, ${Math.round(age / 86400000)}d old)`);
      } else {
        rmSync(full, { recursive: true, force: true });
        logger.info("Cleaned up runtime artifact", { path: full, size: entrySize, ageDays: Math.round(age / 86400000) });
      }
      count++;
      bytes += entrySize;
    }
  }
  return { count, bytes };
}

async function main() {
  console.log(`Ouroboros Cleanup  (mode: ${DRY_RUN ? "dry-run" : "live"})`);
  console.log(`Target directory: ${OUROBOROS_DIR}\n`);

  let totalDeleted = 0;
  let totalBytes = 0;

  // 1. Evolution backups (evo-*)
  const evoResult = pruneEvolutionBackups();
  if (evoResult.pruned > 0) {
    console.log(`Pruned evolution backups: ${evoResult.pruned}`);
    totalDeleted += evoResult.pruned;
  }

  // 2. Checkpoints
  const cpResult = pruneOldCheckpoints();
  if (cpResult.pruned > 0) {
    console.log(`Pruned checkpoints: ${cpResult.pruned}`);
    totalDeleted += cpResult.pruned;
  }

  // 3. Temporary canary test mutations
  const canaryDir = join(OUROBOROS_DIR, "test-canary-mutations");
  if (existsSync(canaryDir)) {
    const canaryResult = deleteIfOld(canaryDir, "", 7 * 24 * 60 * 60 * 1000);
    if (canaryResult.count > 0) {
      console.log(`Cleaned canary mutations: ${canaryResult.count} files (${formatBytes(canaryResult.bytes)})`);
      totalDeleted += canaryResult.count;
      totalBytes += canaryResult.bytes;
    }
  }

  // 4. Old loop snapshots
  const snapshotResult = deleteIfOld(OUROBOROS_DIR, "loop-snapshot-", 7 * 24 * 60 * 60 * 1000);
  if (snapshotResult.count > 0) {
    console.log(`Cleaned loop snapshots: ${snapshotResult.count} files (${formatBytes(snapshotResult.bytes)})`);
    totalDeleted += snapshotResult.count;
    totalBytes += snapshotResult.bytes;
  }

  // 5. Old log files
  const logResult = deleteIfOld(OUROBOROS_DIR, "", 30 * 24 * 60 * 60 * 1000);
  if (logResult.count > 0) {
    console.log(`Cleaned old logs/artifacts: ${logResult.count} files (${formatBytes(logResult.bytes)})`);
    totalDeleted += logResult.count;
    totalBytes += logResult.bytes;
  }

  console.log(`\nSummary: ${totalDeleted} items processed, ${formatBytes(totalBytes)} freed.`);
  if (DRY_RUN) {
    console.log("This was a dry run. No files were actually deleted.");
  }
}

main().catch((e) => {
  console.error("Cleanup failed:", e);
  process.exit(1);
});
