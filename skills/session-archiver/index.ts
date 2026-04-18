/**
 * Session Archiver
 * ================
 * Tiers old sessions into hot/warm/cold storage and compresses them.
 *
 * Hot  (30d):  recent sessions, fully queryable
 * Warm (90d):  compressed to .gz, listed but not loaded by default
 * Cold (180d): compressed to .tar.gz, listed only in stats
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { getSession, getMessages, getTrajectories } from "../../core/session-db.ts";
import { logger } from "../../core/logger.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ArchiverConfig {
  hot_ttl_days: number;    // default 30
  warm_ttl_days: number;    // default 90
  cold_ttl_days: number;    // default 180
  archive_path: string;     // base archive directory
}

const DEFAULT_ARCHIVER_CONFIG: ArchiverConfig = {
  hot_ttl_days: 30,
  warm_ttl_days: 90,
  cold_ttl_days: 180,
  archive_path: "./.ouroboros/archive",
};

export interface ArchiverStats extends Record<string, unknown> {
  totalSessions: number;
  hotSessions: number;
  warmSessions: number;
  coldSessions: number;
  archivedCount: number;
  cleanedCount: number;
  archiveSizeBytes: number;
  lastRunAt: number;
}

export type SessionTier = "hot" | "warm" | "cold" | "unknown";

export interface ArchivedSession {
  sessionId: string;
  tier: SessionTier;
  archiveFile?: string;
  sizeBytes?: number;
  modifiedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const msPerDay = 24 * 60 * 60 * 1000;

function _daysAgo(days: number): number {
  return Date.now() - days * msPerDay;
}

function getTierAge(createdAt: number, cfg: ArchiverConfig): SessionTier {
  const age = Date.now() - createdAt;
  if (age <= cfg.hot_ttl_days * msPerDay) return "hot";
  if (age <= cfg.warm_ttl_days * msPerDay) return "warm";
  if (age <= cfg.cold_ttl_days * msPerDay) return "cold";
  return "unknown";
}

function archiveFileName(sessionId: string, tier: SessionTier): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = tier === "cold" ? ".tar.gz" : ".gz.json";
  return `${safe}${ext}`;
}

async function compressFile(srcPath: string, destPath: string): Promise<void> {
  const gzip = createGzip();
  const src = createReadStream(srcPath);
  const dest = createWriteStream(destPath);
  await pipeline(src, gzip, dest);
}

// ---------------------------------------------------------------------------
// Session Archiver
// ---------------------------------------------------------------------------

export interface SessionArchiver {
  run(): Promise<ArchiverStats>;
  querySessions(tier?: SessionTier): Promise<ArchivedSession[]>;
  getStats(): ArchiverStats;
}

export function createSessionArchiver(cfg?: Partial<ArchiverConfig>): SessionArchiver {
  const config: ArchiverConfig = { ...DEFAULT_ARCHIVER_CONFIG, ...cfg };

  let lastStats: ArchiverStats = {
    totalSessions: 0,
    hotSessions: 0,
    warmSessions: 0,
    coldSessions: 0,
    archivedCount: 0,
    cleanedCount: 0,
    archiveSizeBytes: 0,
    lastRunAt: Date.now(),
  };

  const archiveDir = config.archive_path;
  const warmDir = join(archiveDir, "warm");
  const coldDir = join(archiveDir, "cold");

  function ensureDirs() {
    mkdirSync(warmDir, { recursive: true });
    mkdirSync(coldDir, { recursive: true });
  }

  function sessionAgeFromPath(sessionId: string): number {
    // session id format: session_<timestamp>
    const ts = sessionId.replace("session_", "");
    return isNaN(parseInt(ts, 10)) ? 0 : parseInt(ts, 10);
  }

  async function archiveSession(
    sessionId: string,
    tier: "warm" | "cold"
  ): Promise<{ archiveFile: string; sizeBytes: number } | null> {
    try {
      const sessionRes = await getSession(sessionId);
      if (!sessionRes.success || !sessionRes.data) return null;

      const msgsRes = await getMessages(sessionId);
      const trajRes = await getTrajectories(sessionId);

      const payload = JSON.stringify({
        session: sessionRes.data,
        messages: msgsRes.success ? msgsRes.data : [],
        trajectories: trajRes.success ? trajRes.data : [],
        archivedAt: Date.now(),
        tier,
      });

      const tmpPath = join(archiveDir, `${sessionId}.tmp.json`);
      const fileName = archiveFileName(sessionId, tier);
      const destDir = tier === "warm" ? warmDir : coldDir;
      const destPath = join(destDir, fileName);

      writeFileSync(tmpPath, payload, "utf-8");
      await compressFile(tmpPath, destPath);
      unlinkSync(tmpPath);

      const stat = statSync(destPath);
      return { archiveFile: destPath, sizeBytes: stat.size };
    } catch (e) {
      logger.warn("Failed to archive session", { sessionId, tier, error: String(e) });
      return null;
    }
  }

  async function deleteSessionFiles(sessionId: string): Promise<boolean> {
    // This relies on session-db being the source of truth.
    // We just try to remove from warm/cold if present.
    try {
      for (const dir of [warmDir, coldDir]) {
        const entries = existsSync(dir) ? readdirSync(dir) : [];
        for (const entry of entries) {
          if (entry.startsWith(sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"))) {
            unlinkSync(join(dir, entry));
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    async run(): Promise<ArchiverStats> {
      ensureDirs();

      let hot = 0, warm = 0, cold = 0;
      let archivedCount = 0, cleanedCount = 0;
      let totalSize = 0;

      // Walk the warm and cold archive directories to count them
      for (const dir of [warmDir, coldDir]) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (!statSync(full).isFile()) continue;
          const size = statSync(full).size;
          totalSize += size;
          if (entry.endsWith(".tar.gz")) cold++;
          else warm++;
        }
      }

      // Walk .ouroboros for active sessions to determine hot count and promote
      const ouraDir = join(process.cwd(), ".ouroboros");
      const sessionsDir = join(ouraDir, "sessions");
      if (existsSync(sessionsDir)) {
        for (const entry of readdirSync(sessionsDir)) {
          const sessionId = entry.replace(/\.json$/, "");
          const age = sessionAgeFromPath(sessionId);
          if (!age) continue;

          const tier = getTierAge(age, config);
          if (tier === "hot") {
            hot++;
          } else if (tier === "warm") {
            const result = await archiveSession(sessionId, "warm");
            if (result) {
              archivedCount++;
              totalSize += result.sizeBytes;
              warm++;
            }
            // Clean up original if archival succeeded
            await deleteSessionFiles(sessionId);
          } else if (tier === "cold") {
            const result = await archiveSession(sessionId, "cold");
            if (result) {
              archivedCount++;
              totalSize += result.sizeBytes;
              cold++;
            }
            await deleteSessionFiles(sessionId);
            cleanedCount++;
          }
        }
      }

      lastStats = {
        totalSessions: hot + warm + cold,
        hotSessions: hot,
        warmSessions: warm,
        coldSessions: cold,
        archivedCount,
        cleanedCount,
        archiveSizeBytes: totalSize,
        lastRunAt: Date.now(),
      };

      logger.info("Session archiver run complete", lastStats);
      return lastStats;
    },

    async querySessions(tier?: SessionTier): Promise<ArchivedSession[]> {
      const results: ArchivedSession[] = [];

      if (!tier || tier === "hot") {
        const sessionsDir = join(process.cwd(), ".ouroboros", "sessions");
        if (existsSync(sessionsDir)) {
          for (const entry of readdirSync(sessionsDir)) {
            if (!entry.endsWith(".json")) continue;
            const sessionId = entry.replace(/\.json$/, "");
            const age = sessionAgeFromPath(sessionId);
            const st = statSync(join(sessionsDir, entry));
            results.push({ sessionId, tier: getTierAge(age, config), modifiedAt: st.mtimeMs });
          }
        }
      }

      const walkDir = (dir: string, t: SessionTier) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (!statSync(full).isFile()) continue;
          const st = statSync(full);
          // extract sessionId from filename
          const sessionId = entry.replace(/\\.tar\\.gz$|\.gz\\.json$/, "").replace(/_/g, "_");
          results.push({ sessionId, tier: t, archiveFile: full, sizeBytes: st.size, modifiedAt: st.mtimeMs });
        }
      };

      if (!tier || tier === "warm") walkDir(warmDir, "warm");
      if (!tier || tier === "cold") walkDir(coldDir, "cold");

      return results;
    },

    getStats(): ArchiverStats {
      return { ...lastStats };
    },
  };
}
