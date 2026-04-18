import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { selfModifyTool, setSelfModifyConfirmCallback } from "../../skills/self-modify/index.ts";
import * as selfHealing from "../../skills/self-healing/index.ts";
import * as skillVersioning from "../../skills/skill-versioning/index.ts";
import * as backup from "../../skills/backup/index.ts";
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";

const TEST_DIR = join(process.cwd(), ".ouroboros", "test-canary-mutations");

describe("self-modify canary", () => {
  const coreFake = join(TEST_DIR, "core", "fake-core.ts");
  const skillFake = join(TEST_DIR, "skills", "fake-skill", "index.ts");

  beforeEach(() => {
    vi.restoreAllMocks();
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "core"), { recursive: true });
    mkdirSync(join(TEST_DIR, "skills", "fake-skill"), { recursive: true });
    writeFileSync(coreFake, "// original core content", "utf-8");
    writeFileSync(skillFake, "// original skill content", "utf-8");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      unlinkSync(coreFake);
      rmdirSync(join(TEST_DIR, "core"));
      unlinkSync(skillFake);
      rmdirSync(join(TEST_DIR, "skills", "fake-skill"));
      rmdirSync(join(TEST_DIR, "skills"));
      rmdirSync(TEST_DIR);
    } catch {
      // ignore cleanup errors
    }
  });

  it("returns success when canary passes", async () => {
    vi.spyOn(selfHealing, "runCanaryTests").mockResolvedValue({ success: true, stdout: "", stderr: "" });

    const result = await selfModifyTool.call(
      {
        type: "skill_patch",
        skillName: "fake-skill",
        description: "benign patch",
        proposedChanges: {
          targetPath: ".ouroboros/test-canary-mutations/skills/fake-skill/index.ts",
          operation: "write",
          content: "export default {}\n",
        },
        rationale: "test",
        estimatedRisk: "low",
      },
      { taskId: "task_canary_pass", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: async () => ({} as any) }
    );

    expect(result.success).toBe(true);
  });

  it("throws and rolls back when canary fails for a core file", async () => {
    setSelfModifyConfirmCallback(async () => true);
    vi.spyOn(selfHealing, "runCanaryTests").mockResolvedValue({ success: false, stdout: "", stderr: "Canary failed" });

    const backupPath = join(TEST_DIR, "core-fake-backup.ts");
    writeFileSync(backupPath, "// original core content", "utf-8");
    const backupSpy = vi.spyOn(backup, "createFileBackup").mockReturnValue({ success: true, backupPath });

    await expect(
      selfModifyTool.call(
        {
          type: "core_evolve",
          description: "should fail canary",
          proposedChanges: {
            targetPath: ".ouroboros/test-canary-mutations/core/fake-core.ts",
            operation: "write",
            content: "// broken",
          },
          rationale: "test",
          estimatedRisk: "high",
        },
        { taskId: "task_canary_fail", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: async () => ({} as any) }
      )
    ).rejects.toThrow(/Canary tests failed/);

    expect(backupSpy).toHaveBeenCalledWith(coreFake);

    try { unlinkSync(backupPath); } catch { /* ignore */ }
  });

  it("throws when canary fails for a skill and restores skill version", async () => {
    vi.spyOn(selfHealing, "runCanaryTests").mockResolvedValue({ success: false, stdout: "", stderr: "Canary failed" });
    vi.spyOn(backup, "createFileBackup").mockReturnValue({ success: false, error: "not a core file" });
    const restoreSpy = vi.spyOn(skillVersioning, "restoreSkillVersion").mockReturnValue({ success: true } as any);
    vi.spyOn(skillVersioning, "listSkillVersions").mockReturnValue([{ versionId: "123", skillName: "fake-skill", timestamp: 123, files: ["index.ts"] }]);

    await expect(
      selfModifyTool.call(
        {
          type: "skill_patch",
          skillName: "fake-skill",
          description: "should fail canary",
          proposedChanges: {
            targetPath: ".ouroboros/test-canary-mutations/skills/fake-skill/index.ts",
            operation: "write",
            content: "// broken",
          },
          rationale: "test",
          estimatedRisk: "medium",
        },
        { taskId: "task_canary_fail_skill", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: async () => ({} as any) }
      )
    ).rejects.toThrow(/Canary tests failed/);

    expect(restoreSpy).toHaveBeenCalledWith("fake-skill", "123", join(TEST_DIR, "skills", "fake-skill"));
  });
});
