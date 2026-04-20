/**
 * Disk Monitor
 * ============
 * Tracks disk usage and emits alerts when thresholds are breached.
 */

import { statfsSync } from "fs";
import { logger } from "./logger.ts";
import { sendAlert } from "./alerting.ts";

const DISK_ALERT_THRESHOLD_PERCENT = Number(process.env.DISK_ALERT_THRESHOLD || 90);
const DISK_CHECK_INTERVAL_MS = Number(process.env.DISK_CHECK_INTERVAL_MS || 5 * 60 * 1000);

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export function getDiskUsage(path = process.cwd()): DiskUsage {
  const stats = statfsSync(path);
  const totalBytes = stats.bsize * stats.blocks;
  const freeBytes = stats.bsize * stats.bavail;
  const usedBytes = totalBytes - freeBytes;
  return {
    path,
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
  };
}

let diskCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startDiskMonitor(): void {
  if (diskCheckTimer) return;

  // Immediate first check
  checkDisk();

  diskCheckTimer = setInterval(() => {
    checkDisk();
  }, DISK_CHECK_INTERVAL_MS);
}

export function stopDiskMonitor(): void {
  if (diskCheckTimer) {
    clearInterval(diskCheckTimer);
    diskCheckTimer = null;
  }
}

function checkDisk(): void {
  try {
    const usage = getDiskUsage();
    if (usage.usedPercent >= DISK_ALERT_THRESHOLD_PERCENT) {
      logger.warn("Disk usage exceeded threshold", {
        usedPercent: usage.usedPercent,
        threshold: DISK_ALERT_THRESHOLD_PERCENT,
        freeGB: (usage.freeBytes / 1e9).toFixed(2),
      });
      sendAlert({
        level: "warning",
        title: "磁盘空间告警",
        message: `磁盘使用率 ${usage.usedPercent}% 超过阈值 ${DISK_ALERT_THRESHOLD_PERCENT}%（剩余 ${(usage.freeBytes / 1e9).toFixed(2)} GB）`,
        meta: { path: usage.path, usedPercent: usage.usedPercent, freeBytes: usage.freeBytes },
      }).catch(() => {});
    }
  } catch (e) {
    logger.error("Disk check failed", { error: String(e) });
  }
}
