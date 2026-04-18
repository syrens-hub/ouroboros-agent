import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  exportSuccessfulEvolutions,
  writeSyncManifest,
  readSyncManifest,
  importTemplates,
  syncFromDirectory,
} from "../../../skills/evolution-sync/index.ts";
import { initEvolutionVersionTables } from "../../../skills/evolution-version-manager/index.ts";

const SYNC_DIR = join(process.cwd(), ".ouroboros", "test-evolution-sync");

describe("Evolution Sync v9.2", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEvolutionVersionTables(db);
    db.exec("DELETE FROM evolution_versions;");
    if (existsSync(SYNC_DIR)) rmSync(SYNC_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    resetDbSingleton();
    if (existsSync(SYNC_DIR)) rmSync(SYNC_DIR, { recursive: true, force: true });
  });

  it("exports successful evolutions", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO evolution_versions (id, version_tag, files_changed, risk_score, approval_status, test_status, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("evo-1", "0.7.1", `["a.ts"]`, 10, "applied", "passed", "Fix bug", Date.now());

    const manifest = exportSuccessfulEvolutions("test-instance");
    expect(manifest.instanceId).toBe("test-instance");
    expect(manifest.templates.length).toBeGreaterThan(0);
  });

  it("writes and reads manifest", () => {
    const manifest = {
      instanceId: "test",
      exportedAt: Date.now(),
      templates: [{
        id: "tpl-1",
        name: "Test",
        description: "Desc",
        filesChanged: ["a.ts"],
        diffPattern: "",
        sourceInstance: "test",
        successRate: 1,
        totalApplications: 5,
        tags: [],
        createdAt: Date.now(),
      }],
    };

    const path = writeSyncManifest(manifest, SYNC_DIR);
    expect(existsSync(path)).toBe(true);

    const read = readSyncManifest(path);
    expect(read).not.toBeNull();
    expect(read!.templates[0].name).toBe("Test");
  });

  it("imports templates from manifest", () => {
    const manifest = {
      instanceId: "remote",
      exportedAt: Date.now(),
      templates: [{
        id: "tpl-1",
        name: "Remote Fix",
        description: "Fix from remote",
        filesChanged: ["b.ts"],
        diffPattern: "",
        sourceInstance: "remote",
        successRate: 0.9,
        totalApplications: 10,
        tags: ["remote"],
        createdAt: Date.now(),
      }],
    };

    const count = importTemplates(manifest);
    expect(count).toBe(1);
  });

  it("syncs from directory", () => {
    mkdirSync(SYNC_DIR, { recursive: true });
    const manifest = {
      instanceId: "dir-test",
      exportedAt: Date.now(),
      templates: [{
        id: "tpl-2",
        name: "Dir Fix",
        description: "Fix",
        filesChanged: ["c.ts"],
        diffPattern: "",
        sourceInstance: "dir-test",
        successRate: 1,
        totalApplications: 1,
        tags: [],
        createdAt: Date.now(),
      }],
    };
    writeSyncManifest(manifest, SYNC_DIR);

    const count = syncFromDirectory(SYNC_DIR);
    expect(count).toBe(1);
  });
});
