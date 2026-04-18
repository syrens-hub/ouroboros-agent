/**
 * Evolution Version Manager
 * =========================
 * Global evolution versioning — tracks system-wide changes with semver-style tags,
 * parent-child lineage, and rollback support.
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { logger } from "../../core/logger.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

export interface EvolutionVersion {
  id: string;
  versionTag: string;
  parentVersionId: string | null;
  filesChanged: string[];
  riskScore: number;
  approvalStatus: string;
  testStatus: string;
  description: string;
  createdAt: number;
  appliedAt: number | null;
  diffs?: Record<string, string>;
}

export interface CreateVersionOpts {
  filesChanged: string[];
  riskScore: number;
  approvalStatus: string;
  testStatus?: string;
  description: string;
  parentVersionId?: string;
  diffs?: Record<string, string>;
}

function genId(): string {
  return `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function serializeFiles(files: string[]): string {
  try {
    return JSON.stringify(files);
  } catch {
    return "[]";
  }
}

function parseFiles(raw: string): string[] {
  return safeJsonParse<string[]>(raw, "version files") ?? [];
}

function readPackageVersion(): string {
  const pkgPath = resolve(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) return "0.0.0";
  const pkg = safeJsonParse<{ version?: string }>(readFileSync(pkgPath, "utf-8"), "package json");
  return pkg?.version ?? "0.0.0";
}

function incrementPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return "0.0.1";
  const patch = parseInt(parts[2], 10);
  if (Number.isNaN(patch)) return "0.0.1";
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}

export function initEvolutionVersionTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_versions (
      id TEXT PRIMARY KEY,
      version_tag TEXT NOT NULL UNIQUE,
      parent_version_id TEXT,
      files_changed TEXT NOT NULL,
      risk_score INTEGER,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      test_status TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      applied_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_evolution_versions_tag ON evolution_versions(version_tag);
    CREATE INDEX IF NOT EXISTS idx_evolution_versions_created ON evolution_versions(created_at DESC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_diffs (
      version_id TEXT PRIMARY KEY,
      diffs TEXT NOT NULL
    );
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initEvolutionVersionTables(db);
}

export class EvolutionVersionManager {
  private baseVersion: string;

  constructor(baseVersion?: string) {
    this.baseVersion = baseVersion ?? readPackageVersion();
  }

  createVersion(opts: CreateVersionOpts): EvolutionVersion {
    ensureInitialized();

    const db = getDb();
    const latest = this._getLatestVersion();
    const versionTag = latest ? incrementPatch(latest.versionTag) : incrementPatch(this.baseVersion);

    const version: EvolutionVersion = {
      id: genId(),
      versionTag,
      parentVersionId: opts.parentVersionId ?? latest?.id ?? null,
      filesChanged: opts.filesChanged,
      riskScore: opts.riskScore,
      approvalStatus: opts.approvalStatus,
      testStatus: opts.testStatus ?? "unknown",
      description: opts.description,
      createdAt: Date.now(),
      appliedAt: null,
      diffs: opts.diffs,
    };

    // Retry on unique constraint collision (rapid sequential creates)
    let attempts = 0;
    while (attempts < 5) {
      try {
        db.prepare(
          `INSERT INTO evolution_versions (id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          version.id,
          version.versionTag,
          version.parentVersionId,
          serializeFiles(version.filesChanged),
          version.riskScore,
          version.approvalStatus,
          version.testStatus,
          version.description,
          version.createdAt,
          version.appliedAt
        );
        break;
      } catch (e: unknown) {
        const msg = String(e);
        if (msg.includes("UNIQUE") && msg.includes("version_tag")) {
          attempts++;
          version.versionTag = incrementPatch(version.versionTag);
          continue;
        }
        throw e;
      }
    }

    // Persist diffs if provided
    if (opts.diffs) {
      db.prepare(
        `INSERT INTO evolution_diffs (version_id, diffs) VALUES (?, ?)
         ON CONFLICT(version_id) DO UPDATE SET diffs = excluded.diffs`
      ).run(version.id, JSON.stringify(opts.diffs));
    }

    logger.info("Evolution version created", { versionTag, id: version.id, files: opts.filesChanged.length });
    return version;
  }

  getVersion(id: string): EvolutionVersion | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at
         FROM evolution_versions WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    const version = this._rowToVersion(row);
    // Restore diffs
    const diffRow = db.prepare(`SELECT diffs FROM evolution_diffs WHERE version_id = ?`).get(id) as { diffs?: string } | undefined;
    if (diffRow?.diffs) {
      version.diffs = safeJsonParse<Record<string, string>>(diffRow.diffs, "version diffs");
    }
    return version;
  }

  getVersionByTag(tag: string): EvolutionVersion | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at
         FROM evolution_versions WHERE version_tag = ?`
      )
      .get(tag) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this._rowToVersion(row);
  }

  listVersions(limit = 50): EvolutionVersion[] {
    ensureInitialized();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at
         FROM evolution_versions ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => this._rowToVersion(r));
  }

  getCurrentVersion(): EvolutionVersion | undefined {
    ensureInitialized();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, version_tag, parent_version_id, files_changed, risk_score, approval_status, test_status, description, created_at, applied_at
         FROM evolution_versions ORDER BY created_at DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this._rowToVersion(row);
  }

  markApplied(id: string): boolean {
    ensureInitialized();
    const db = getDb();
    const result = db.prepare(
      `UPDATE evolution_versions SET applied_at = ?, approval_status = 'applied' WHERE id = ?`
    ).run(Date.now(), id) as { changes: number };

    if (result.changes > 0) {
      logger.info("Evolution version marked as applied", { id });
    }
    return result.changes > 0;
  }

  updateTestStatus(id: string, testStatus: string): boolean {
    ensureInitialized();
    const db = getDb();
    const result = db.prepare(
      `UPDATE evolution_versions SET test_status = ? WHERE id = ?`
    ).run(testStatus, id) as { changes: number };
    return result.changes > 0;
  }

  /** Rollback support: returns the version to roll back to (parent). */
  getRollbackTarget(id: string): EvolutionVersion | undefined {
    ensureInitialized();
    const version = this.getVersion(id);
    if (!version?.parentVersionId) return undefined;
    return this.getVersion(version.parentVersionId);
  }

  /** Reconstruct version lineage from a given version back to root. */
  getLineage(id: string): EvolutionVersion[] {
    ensureInitialized();
    const lineage: EvolutionVersion[] = [];
    let current = this.getVersion(id);
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      lineage.push(current);
      visited.add(current.id);
      if (!current.parentVersionId) break;
      current = this.getVersion(current.parentVersionId);
    }

    return lineage;
  }

  private _getLatestVersion(): { id: string; versionTag: string } | undefined {
    const db = getDb();
    const row = db
      .prepare(`SELECT id, version_tag FROM evolution_versions ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get() as { id: string; version_tag: string } | undefined;
    if (!row) return undefined;
    return { id: row.id, versionTag: row.version_tag };
  }

  private _rowToVersion(row: Record<string, unknown>): EvolutionVersion {
    return {
      id: String(row.id),
      versionTag: String(row.version_tag),
      parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
      filesChanged: parseFiles(String(row.files_changed)),
      riskScore: Number(row.risk_score),
      approvalStatus: String(row.approval_status),
      testStatus: String(row.test_status ?? "unknown"),
      description: String(row.description ?? ""),
      createdAt: Number(row.created_at),
      appliedAt: row.applied_at ? Number(row.applied_at) : null,
    };
  }
}

export const evolutionVersionManager = new EvolutionVersionManager();
