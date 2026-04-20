/**
 * Evolution Rollback
 * ==================
 * Automatic rollback to the last stable version when an evolution
 * causes startup failures or core functionality breakage.
 *
 * Flow:
 *   1. executeEvolution applies diffs → creates .ouroboros/evolution-pending.json
 *   2. Server starts successfully → clears the marker
 *   3. Server restarts and marker still exists → triggers rollback
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { logger } from "../logger.ts";

const PENDING_MARKER = join(process.cwd(), ".ouroboros", "evolution-pending.json");
const ROLLBACK_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

interface PendingMarker {
  backupDir: string;
  appliedAt: number;
  versionId: string;
}

export function createPendingMarker(backupDir: string, versionId: string): void {
  const marker: PendingMarker = {
    backupDir,
    appliedAt: Date.now(),
    versionId,
  };
  writeFileSync(PENDING_MARKER, JSON.stringify(marker, null, 2), "utf-8");
  logger.info("Evolution pending marker created", { versionId, backupDir });
}

export function clearPendingMarker(): void {
  if (existsSync(PENDING_MARKER)) {
    unlinkSync(PENDING_MARKER);
    logger.info("Evolution pending marker cleared");
  }
}

export function hasPendingMarker(): boolean {
  return existsSync(PENDING_MARKER);
}

/**
 * Check for a pending evolution marker and rollback if necessary.
 * Returns true if a rollback was performed.
 */
export async function checkAndRollback(): Promise<boolean> {
  if (!existsSync(PENDING_MARKER)) return false;

  let marker: PendingMarker;
  try {
    marker = JSON.parse(readFileSync(PENDING_MARKER, "utf-8")) as PendingMarker;
  } catch (e) {
    logger.error("Failed to parse evolution pending marker", { error: String(e) });
    unlinkSync(PENDING_MARKER);
    return false;
  }

  const ageMs = Date.now() - marker.appliedAt;
  if (ageMs < ROLLBACK_GRACE_PERIOD_MS) {
    logger.warn("Evolution pending marker found but within grace period, skipping rollback", {
      ageMs,
      versionId: marker.versionId,
    });
    return false;
  }

  logger.warn("Evolution caused startup failure — initiating rollback", {
    versionId: marker.versionId,
    backupDir: marker.backupDir,
    ageMs,
  });

  try {
    // Dynamic import to avoid circular deps with self-modify
    const selfModify = await import("../../skills/self-modify/index.ts");
    selfModify.restoreBackup(marker.versionId, marker.backupDir);
    logger.info("Rollback completed successfully", { versionId: marker.versionId });
  } catch (e) {
    logger.error("Rollback failed", { versionId: marker.versionId, error: String(e) });
    // Even if rollback fails, clear the marker to avoid infinite loops
  } finally {
    unlinkSync(PENDING_MARKER);
  }

  return true;
}
