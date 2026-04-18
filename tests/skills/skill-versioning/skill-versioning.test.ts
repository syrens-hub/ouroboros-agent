import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  snapshotSkillVersion,
  listSkillVersions,
  restoreSkillVersion,
  pruneSkillVersions,
  pruneAllSkillVersions,
} from "../../../skills/skill-versioning/index.ts";

const VERSION_DIR = join(process.cwd(), ".ouroboros", "skill-versions");
const TEST_SKILL_BASE = mkdtempSync(join(tmpdir(), "ouroboros-test-skills-"));

function getTestSkillDir(skillName: string) {
  return join(TEST_SKILL_BASE, skillName);
}

function cleanupSkill(skillName: string) {
  const dir = getTestSkillDir(skillName);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const vDir = join(VERSION_DIR, skillName);
  if (existsSync(vDir)) rmSync(vDir, { recursive: true, force: true });
}

function createTestSkill(skillName: string) {
  const dir = getTestSkillDir(skillName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# v1", "utf-8");
  writeFileSync(join(dir, "index.ts"), "export const v = 1;", "utf-8");
  return dir;
}

describe("Skill Versioning", () => {
  beforeEach(() => {
    // Wipe entire version dir to avoid cross-test contamination in concurrent runs
    if (existsSync(VERSION_DIR)) {
      rmSync(VERSION_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(VERSION_DIR)) {
      rmSync(VERSION_DIR, { recursive: true, force: true });
    }
  });

  it("snapshots a skill version", () => {
    const skillName = "snap-test";
    cleanupSkill(skillName);
    const dir = createTestSkill(skillName);
    const result = snapshotSkillVersion(skillName, dir);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skillName).toBe(skillName);
    expect(result.data.files).toContain("SKILL.md");
    expect(result.data.files).toContain("index.ts");
    cleanupSkill(skillName);
  });

  it("lists skill versions in descending order", () => {
    const skillName = "list-test";
    cleanupSkill(skillName);
    const dir = createTestSkill(skillName);
    const r1 = snapshotSkillVersion(skillName, dir);
    expect(r1.success).toBe(true);
    const start = Date.now();
    while (Date.now() - start < 10) { /* busy wait */ }
    const r2 = snapshotSkillVersion(skillName, dir);
    expect(r2.success).toBe(true);
    const versions = listSkillVersions(skillName);
    expect(versions.length).toBe(2);
    expect(versions[0].timestamp).toBeGreaterThanOrEqual(versions[1].timestamp);
    cleanupSkill(skillName);
  });

  it("restores a skill version", () => {
    const skillName = "restore-test";
    cleanupSkill(skillName);
    const dir = createTestSkill(skillName);
    const snap = snapshotSkillVersion(skillName, dir);
    expect(snap.success).toBe(true);
    if (!snap.success) return;

    writeFileSync(join(dir, "SKILL.md"), "# v2", "utf-8");
    const restore = restoreSkillVersion(skillName, snap.data.versionId, dir);
    expect(restore.success).toBe(true);
    const restoredContent = readFileSync(join(dir, "SKILL.md"), "utf-8");
    expect(restoredContent).toBe("# v1");
    cleanupSkill(skillName);
  });

  it("prunes old versions keeping N most recent", () => {
    const skillName = "prune-test";
    cleanupSkill(skillName);
    const dir = createTestSkill(skillName);
    for (let i = 0; i < 3; i++) {
      snapshotSkillVersion(skillName, dir);
      const start = Date.now();
      while (Date.now() - start < 10) { /* busy wait */ }
    }
    expect(listSkillVersions(skillName).length).toBe(3);
    const { deleted } = pruneSkillVersions(skillName, 1);
    expect(deleted).toBe(2);
    expect(listSkillVersions(skillName).length).toBe(1);
    cleanupSkill(skillName);
  });

  it("prunes all skill versions by age", () => {
    const skillName = "prune-all-test";
    cleanupSkill(skillName);
    const dir = createTestSkill(skillName);
    snapshotSkillVersion(skillName, dir);
    expect(listSkillVersions(skillName).length).toBe(1);
    const { deleted } = pruneAllSkillVersions(0, 0);
    expect(deleted).toBe(1);
    expect(listSkillVersions(skillName).length).toBe(0);
    cleanupSkill(skillName);
  });
});
