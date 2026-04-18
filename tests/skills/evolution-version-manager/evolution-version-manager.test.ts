import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  EvolutionVersionManager,
  initEvolutionVersionTables,
} from "../../../skills/evolution-version-manager/index.ts";

describe("Evolution Version Manager", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEvolutionVersionTables(db);
    db.exec("DELETE FROM evolution_versions;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("creates a version with auto-incremented tag", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v = mgr.createVersion({
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Greet update",
    });

    expect(v.versionTag).toBe("0.2.1");
    expect(v.parentVersionId).toBeNull();
    expect(v.filesChanged).toEqual(["skills/greet/index.ts"]);
    expect(v.appliedAt).toBeNull();
  });

  it("links parent version on subsequent creates", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v1 = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    const v2 = mgr.createVersion({
      filesChanged: ["b.ts"],
      riskScore: 15,
      approvalStatus: "approved",
      description: "Second",
    });

    expect(v2.parentVersionId).toBe(v1.id);
    expect(v2.versionTag).toBe("0.2.2");
  });

  it("retrieves a version by id", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Test",
    });

    const fetched = mgr.getVersion(v.id);
    expect(fetched).toBeDefined();
    expect(fetched!.versionTag).toBe(v.versionTag);
  });

  it("retrieves a version by tag", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Test",
    });

    const fetched = mgr.getVersionByTag(v.versionTag);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(v.id);
  });

  it("returns undefined for missing version", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    expect(mgr.getVersion("missing")).toBeUndefined();
    expect(mgr.getVersionByTag("9.9.9")).toBeUndefined();
  });

  it("lists versions in descending order", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    mgr.createVersion({ filesChanged: ["a.ts"], riskScore: 10, approvalStatus: "approved", description: "1" });
    mgr.createVersion({ filesChanged: ["b.ts"], riskScore: 10, approvalStatus: "approved", description: "2" });

    const list = mgr.listVersions();
    expect(list.length).toBe(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
  });

  it("returns current version as the latest", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    expect(mgr.getCurrentVersion()).toBeUndefined();

    const v = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });

    const current = mgr.getCurrentVersion();
    expect(current).toBeDefined();
    expect(current!.id).toBe(v.id);
  });

  it("marks a version as applied", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Test",
    });

    const ok = mgr.markApplied(v.id);
    expect(ok).toBe(true);

    const fetched = mgr.getVersion(v.id);
    expect(fetched!.appliedAt).toBeDefined();
    expect(fetched!.approvalStatus).toBe("applied");
  });

  it("updates test status", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Test",
    });

    const ok = mgr.updateTestStatus(v.id, "passed");
    expect(ok).toBe(true);

    const fetched = mgr.getVersion(v.id);
    expect(fetched!.testStatus).toBe("passed");
  });

  it("returns rollback target (parent)", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v1 = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });
    const v2 = mgr.createVersion({
      filesChanged: ["b.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "Second",
    });

    const target = mgr.getRollbackTarget(v2.id);
    expect(target).toBeDefined();
    expect(target!.id).toBe(v1.id);
  });

  it("returns undefined rollback target for root version", () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v1 = mgr.createVersion({
      filesChanged: ["a.ts"],
      riskScore: 10,
      approvalStatus: "approved",
      description: "First",
    });

    expect(mgr.getRollbackTarget(v1.id)).toBeUndefined();
  });

  it("reconstructs lineage", async () => {
    const mgr = new EvolutionVersionManager("0.2.0");
    const v1 = mgr.createVersion({ filesChanged: ["a.ts"], riskScore: 10, approvalStatus: "approved", description: "1" });
    await new Promise((r) => setTimeout(r, 2));
    const v2 = mgr.createVersion({ filesChanged: ["b.ts"], riskScore: 10, approvalStatus: "approved", description: "2" });
    await new Promise((r) => setTimeout(r, 2));
    const v3 = mgr.createVersion({ filesChanged: ["c.ts"], riskScore: 10, approvalStatus: "approved", description: "3" });

    const lineage = mgr.getLineage(v3.id);
    expect(lineage.length).toBe(3);
    expect(lineage[0].id).toBe(v3.id);
    expect(lineage[1].id).toBe(v2.id);
    expect(lineage[2].id).toBe(v1.id);
  });
});
