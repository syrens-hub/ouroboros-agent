/**
 * Evolution Sync v9.2
 * ====================
 * Cross-instance knowledge sharing for Ouroboros agents.
 *
 * Exports successful evolution patterns as reusable templates,
 * imports lessons from other instances, and provides a sync protocol
 * over HTTP or filesystem.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { logger } from "../../core/logger.ts";

const PROJECT_ROOT = resolve(process.cwd());
const DEFAULT_SYNC_DIR = join(PROJECT_ROOT, ".ouroboros", "evolution-sync");

// =============================================================================
// Types
// =============================================================================

export interface EvolutionTemplate {
  id: string;
  name: string;
  description: string;
  filesChanged: string[];
  diffPattern: string; // generic diff or regex pattern
  sourceInstance: string;
  successRate: number;
  totalApplications: number;
  tags: string[];
  createdAt: number;
}

export interface SyncManifest {
  instanceId: string;
  exportedAt: number;
  templates: EvolutionTemplate[];
}

// =============================================================================
// Export
// =============================================================================

export function exportSuccessfulEvolutions(instanceId = "default", minSuccessRate = 0.8): SyncManifest {
  const db = getDb();
  const templates: EvolutionTemplate[] = [];

  try {
    const rows = db.prepare(
      `SELECT v.description, v.files_changed, v.version_tag,
              COUNT(*) as total,
              SUM(CASE WHEN v.test_status != 'failed' AND v.approval_status != 'rolled_back' THEN 1 ELSE 0 END) as successes
       FROM evolution_versions v
       GROUP BY v.description
       HAVING successes * 1.0 / total >= ?
       ORDER BY total DESC LIMIT 20`
    ).all(minSuccessRate) as Record<string, unknown>[];

    for (const r of rows) {
      const total = Number(r.total ?? 1);
      const successes = Number(r.successes ?? 0);
      const files = String(r.files_changed ?? "[]");
      templates.push({
        id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: String(r.description ?? "untitled").slice(0, 50),
        description: String(r.description ?? ""),
        filesChanged: JSON.parse(files) as string[],
        diffPattern: "",
        sourceInstance: instanceId,
        successRate: successes / total,
        totalApplications: total,
        tags: ["exported", "successful"],
        createdAt: Date.now(),
      });
    }
  } catch (e) {
    logger.warn("Failed to query successful evolutions for export", { error: String(e) });
  }

  return {
    instanceId,
    exportedAt: Date.now(),
    templates,
  };
}

export function writeSyncManifest(manifest: SyncManifest, dir = DEFAULT_SYNC_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `manifest-${manifest.instanceId}-${manifest.exportedAt}.json`);
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  logger.info("Evolution sync manifest written", { path, templates: manifest.templates.length });
  return path;
}

// =============================================================================
// Import
// =============================================================================

export function readSyncManifest(path: string): SyncManifest | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as SyncManifest;
  } catch {
    return null;
  }
}

export function importTemplates(manifest: SyncManifest, tagPrefix = "imported"): number {
  const db = getDb();
  let imported = 0;

  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      files_changed TEXT,
      source_instance TEXT,
      success_rate REAL,
      total_applications INTEGER,
      tags TEXT,
      created_at INTEGER
    );
  `);

  for (const tpl of manifest.templates) {
    try {
      db.prepare(
        `INSERT OR REPLACE INTO evolution_templates (id, name, description, files_changed, source_instance, success_rate, total_applications, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        tpl.id,
        tpl.name,
        tpl.description,
        JSON.stringify(tpl.filesChanged),
        manifest.instanceId,
        tpl.successRate,
        tpl.totalApplications,
        JSON.stringify([...tpl.tags, tagPrefix]),
        Date.now()
      );
      imported++;
    } catch {
      // skip duplicates
    }
  }

  logger.info("Evolution templates imported", { count: imported, from: manifest.instanceId });
  return imported;
}

export function listImportedTemplates(limit = 50): EvolutionTemplate[] {
  const db = getDb();
  try {
    const rows = db.prepare(
      `SELECT id, name, description, files_changed, source_instance, success_rate, total_applications, tags, created_at
       FROM evolution_templates ORDER BY created_at DESC LIMIT ?`
    ).all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description ?? ""),
      filesChanged: JSON.parse(String(r.files_changed ?? "[]")) as string[],
      diffPattern: "",
      sourceInstance: String(r.source_instance),
      successRate: Number(r.success_rate),
      totalApplications: Number(r.total_applications),
      tags: JSON.parse(String(r.tags ?? "[]")) as string[],
      createdAt: Number(r.created_at),
    }));
  } catch {
    return [];
  }
}

// =============================================================================
// HTTP Sync (simple pull-based)
// =============================================================================

export async function fetchRemoteManifest(url: string): Promise<SyncManifest | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as SyncManifest;
  } catch (e) {
    logger.warn("Failed to fetch remote evolution manifest", { url, error: String(e) });
    return null;
  }
}

/**
 * Sync from a directory of manifest files (filesystem-based multi-instance sync).
 */
export function syncFromDirectory(dir = DEFAULT_SYNC_DIR): number {
  if (!existsSync(dir)) return 0;

  let totalImported = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const manifest = readSyncManifest(join(dir, entry));
    if (manifest) {
      totalImported += importTemplates(manifest);
    }
  }

  return totalImported;
}
