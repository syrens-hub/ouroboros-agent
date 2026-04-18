/**
 * Skill Version Control
 * =====================
 * Automatic snapshot and rollback for skills.
 * Every mutation to a skill is archived under `.ouroboros/skill-versions/`.
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";
import { safeIgnore } from "../../core/safe-utils.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

const VERSION_DIR = join(process.cwd(), ".ouroboros", "skill-versions");

export interface SkillVersion {
  versionId: string;
  skillName: string;
  timestamp: number;
  files: string[];
}

function ensureVersionDir(skillName: string): string {
  const dir = join(VERSION_DIR, skillName);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSkillFiles(sourceDir: string): string[] {
  if (!existsSync(sourceDir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}

export function snapshotSkillVersion(skillName: string, sourceDir: string): Result<SkillVersion> {
  try {
    const files = getSkillFiles(sourceDir);
    if (files.length === 0) {
      return err({ code: "NO_FILES", message: "No files found in skill directory to snapshot." });
    }
    const timestamp = Date.now();
    const versionId = `${timestamp}`;
    const versionDir = ensureVersionDir(skillName);
    const snapshotDir = join(versionDir, versionId);
    mkdirSync(snapshotDir, { recursive: true });

    for (const file of files) {
      const src = join(sourceDir, file);
      const dest = join(snapshotDir, file);
      copyFileSync(src, dest);
    }

    return ok({ versionId, skillName, timestamp, files });
  } catch (e) {
    return err({ code: "SNAPSHOT_ERROR", message: String(e) });
  }
}

export function listSkillVersions(skillName: string): SkillVersion[] {
  const dir = join(VERSION_DIR, skillName);
  if (!existsSync(dir)) return [];
  const versions: SkillVersion[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snapshotDir = join(dir, entry.name);
    const timestamp = parseInt(entry.name, 10);
    if (Number.isNaN(timestamp)) continue;
    const files = getSkillFiles(snapshotDir);
    versions.push({ versionId: entry.name, skillName, timestamp, files });
  }
  return versions.sort((a, b) => b.timestamp - a.timestamp);
}

export function restoreSkillVersion(skillName: string, versionId: string, targetDir: string): Result<void> {
  try {
    const snapshotDir = join(VERSION_DIR, skillName, versionId);
    if (!existsSync(snapshotDir)) {
      return err({ code: "VERSION_NOT_FOUND", message: `Version ${versionId} not found for skill ${skillName}.` });
    }
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    for (const file of getSkillFiles(snapshotDir)) {
      copyFileSync(join(snapshotDir, file), join(targetDir, file));
    }
    return ok(undefined);
  } catch (e) {
    return err({ code: "RESTORE_ERROR", message: String(e) });
  }
}

export function pruneSkillVersions(skillName: string, keepCount: number): { deleted: number } {
  const versions = listSkillVersions(skillName);
  const toDelete = versions.slice(keepCount);
  let deleted = 0;
  for (const v of toDelete) {
    safeIgnore(() => {
      const dir = join(VERSION_DIR, skillName, v.versionId);
      rmSync(dir, { recursive: true, force: true });
      deleted++;
    }, "pruneSkillVersions cleanup");
  }
  return { deleted };
}

export function pruneAllSkillVersions(maxAgeMs?: number, maxVersionsPerSkill = 20): { deleted: number } {
  if (!existsSync(VERSION_DIR)) return { deleted: 0 };
  let deleted = 0;
  const now = Date.now();
  for (const entry of readdirSync(VERSION_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const versions = listSkillVersions(skillName);
    const toDelete = versions.filter((v, idx) => {
      if (idx >= maxVersionsPerSkill) return true;
      if (maxAgeMs !== undefined && now - v.timestamp > maxAgeMs) return true;
      return false;
    });
    for (const v of toDelete) {
      safeIgnore(() => {
        const dir = join(VERSION_DIR, skillName, v.versionId);
        rmSync(dir, { recursive: true, force: true });
        deleted++;
      }, "pruneAllSkillVersions cleanup");
    }
  }
  return { deleted };
}
