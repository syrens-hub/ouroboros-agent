import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { join, relative, resolve } from "path";
import {
  mutateFile,
  applyDiffs,
  selfModifyTool,
} from "../../skills/self-modify/index.ts";
import * as backupModule from "../../skills/backup/index.ts";
import * as skillVersioningModule from "../../skills/skill-versioning/index.ts";
import * as selfHealingModule from "../../skills/self-healing/index.ts";
import * as childProcess from "child_process";
import { logger } from "../../core/logger.ts";

const TEST_DIR = join(process.cwd(), ".ouroboros", "test-fault-injection");

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn((...args: unknown[]) => (actual.writeFileSync as (...args: unknown[]) => void)(...args)),
    mkdirSync: vi.fn((...args: unknown[]) => (actual.mkdirSync as (...args: unknown[]) => void)(...args)),
    copyFileSync: vi.fn((...args: unknown[]) => (actual.copyFileSync as (...args: unknown[]) => void)(...args)),
    renameSync: vi.fn((...args: unknown[]) => (actual.renameSync as (...args: unknown[]) => void)(...args)),
    existsSync: vi.fn((...args: unknown[]) => (actual.existsSync as (...args: unknown[]) => boolean)(...args)),
    readFileSync: vi.fn((...args: unknown[]) => (actual.readFileSync as (...args: unknown[]) => string | Buffer)(...args)),
    unlinkSync: vi.fn((...args: unknown[]) => (actual.unlinkSync as (...args: unknown[]) => void)(...args)),
    readdirSync: vi.fn((...args: unknown[]) => (actual.readdirSync as (...args: unknown[]) => string[])(...args)),
    statSync: vi.fn((...args: unknown[]) => (actual.statSync as (...args: unknown[]) => import("fs").Stats)(...args)),
    rmdirSync: vi.fn((...args: unknown[]) => (actual.rmdirSync as (...args: unknown[]) => void)(...args)),
  };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn((...args: unknown[]) => (actual.execSync as (...args: unknown[]) => Buffer)(...args)),
  };
});

vi.mock("../../core/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("self-modify fault injection", () => {
  let actualFs: typeof import("fs");

  beforeEach(async () => {
    vi.clearAllMocks();
    actualFs = await vi.importActual("fs");
    actualFs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      const cleanup = (dir: string) => {
        for (const entry of actualFs.readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, entry.name);
          if (entry.isDirectory()) {
            cleanup(p);
            actualFs.rmdirSync(p);
          } else {
            actualFs.unlinkSync(p);
          }
        }
      };
      cleanup(TEST_DIR);
      actualFs.rmdirSync(TEST_DIR);
    } catch {
      // ignore cleanup errors
    }
  });

  it("atomicWrite disk failure returns MUTATION_ERROR and cleans up .tmp files", () => {
    const file = join(TEST_DIR, "atomic-fail.txt");
    actualFs.writeFileSync(file, "original", "utf-8");

    const err = new Error("EROFS: read-only file system, write");
    (err as any).code = "EROFS";

    vi.spyOn(fs, "writeFileSync").mockImplementation((path, ...args) => {
      if (String(path).includes(".tmp.")) {
        throw err;
      }
      return actualFs.writeFileSync(path as any, ...args);
    });

    const res = mutateFile(file, { type: "write", content: "mutated" });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe("MUTATION_ERROR");

    // Verify no .tmp. files left behind
    const entries = actualFs.readdirSync(TEST_DIR);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
  });

  it("backup creation failure stops before file modification", () => {
    const file = join(TEST_DIR, "backup-fail.txt");
    actualFs.writeFileSync(file, "original", "utf-8");

    const err = new Error("ENOSPC: no space left on device, mkdir");
    (err as any).code = "ENOSPC";

    vi.spyOn(fs, "mkdirSync").mockImplementation((path, ...args) => {
      if (String(path).includes("backups")) {
        throw err;
      }
      return actualFs.mkdirSync(path as any, ...args);
    });

    const result = applyDiffs({ [rel(file)]: "mutated content" });
    expect(result.success).toBe(false);
    expect(result.filesFailed).toContainEqual({
      path: "<backup>",
      error: expect.stringContaining("ENOSPC"),
    });
    // File should not have been modified
    expect(actualFs.readFileSync(file, "utf-8")).toBe("original");
  });

  it("backup restore failure is logged without panic", () => {
    const file1 = join(TEST_DIR, "restore-fail-1.txt");
    const file2 = join(TEST_DIR, "restore-fail-2.txt");
    actualFs.writeFileSync(file1, "original1", "utf-8");
    actualFs.writeFileSync(file2, "original2", "utf-8");

    // First file succeeds, second fails during atomic write
    vi.spyOn(fs, "writeFileSync").mockImplementation((path, ...args) => {
      const pathStr = String(path);
      if (pathStr.includes(".tmp.") && pathStr.includes("restore-fail-2")) {
        throw new Error("Simulated diff apply failure");
      }
      return actualFs.writeFileSync(path as any, ...args);
    });

    // Make restoreBackup fail by making readdirSync throw for backup dirs
    vi.spyOn(fs, "readdirSync").mockImplementation((path: unknown, options?: unknown) => {
      const pathStr = String(path);
      if (pathStr.includes("backups") && pathStr.includes("evo-")) {
        throw new Error("Simulated restore backup failure");
      }
      return (actualFs as any).readdirSync(path, options);
    });

    const result = applyDiffs({
      [rel(file1)]: "mutated1",
      [rel(file2)]: "mutated2",
    });

    expect(result.success).toBe(false);
    expect(result.filesApplied).toContain(rel(file1));
    expect(result.filesFailed).toContainEqual({
      path: rel(file2),
      error: expect.stringContaining("Simulated diff apply failure"),
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Rollback failed",
      expect.objectContaining({
        error: expect.stringContaining("Simulated restore backup failure"),
      })
    );
  });

  it("syntax check timeout triggers rollback and clears filesApplied", () => {
    const file = join(TEST_DIR, "syntax-fail.ts");
    actualFs.writeFileSync(file, "const x = 1;\n", "utf-8");

    vi.spyOn(childProcess, "execSync").mockImplementation(() => {
      const err = new Error("ETIMEDOUT");
      (err as any).code = "ETIMEDOUT";
      throw err;
    });

    const result = applyDiffs(
      { [rel(file)]: "const x = 2;\n" },
      { skipSyntaxCheck: false }
    );

    expect(result.success).toBe(false);
    expect(result.filesApplied).toEqual([]);
    expect(result.filesFailed).toContainEqual({
      path: "<project>",
      error: expect.stringContaining("ETIMEDOUT"),
    });
    // File should be restored from backup
    expect(actualFs.readFileSync(file, "utf-8")).toBe("const x = 1;\n");
  });

  it("canary failure with both backup mechanisms failing throws contextual error", async () => {
    vi.spyOn(selfHealingModule, "runCanaryTests").mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Canary test runner failure",
    });

    // core_evolve path: createFileBackup fails
    const coreFile = join(TEST_DIR, "canary-fail-core.txt");
    actualFs.writeFileSync(coreFile, "// original", "utf-8");
    vi.spyOn(backupModule, "createFileBackup").mockReturnValue({
      success: false,
      error: "disk full",
    });

    await expect(
      selfModifyTool.call(
        {
          type: "core_evolve",
          description: "should fail canary and backup",
          proposedChanges: {
            targetPath: rel(coreFile),
            operation: "write",
            content: "// broken",
          },
          rationale: "test",
          estimatedRisk: "low",
        },
        {
          taskId: "task_canary_backup_fail",
          abortSignal: new AbortController().signal,
          reportProgress: () => {},
          invokeSubagent: async () => ({} as any),
        }
      )
    ).rejects.toThrow(/Canary tests failed/);

    expect(backupModule.createFileBackup).toHaveBeenCalled();

    // skill_patch path: restoreSkillVersion fails
    const skillFile = join(TEST_DIR, "canary-fail-skill.txt");
    actualFs.writeFileSync(skillFile, "// original", "utf-8");
    vi.spyOn(skillVersioningModule, "listSkillVersions").mockReturnValue([
      {
        versionId: "v1",
        skillName: "test-skill",
        timestamp: 1,
        files: ["index.ts"],
      },
    ]);
    vi.spyOn(skillVersioningModule, "restoreSkillVersion").mockReturnValue({
      success: false,
      error: "restore failed",
    } as any);

    await expect(
      selfModifyTool.call(
        {
          type: "skill_patch",
          skillName: "test-skill",
          description: "should fail canary and restore",
          proposedChanges: {
            targetPath: rel(skillFile),
            operation: "write",
            content: "// broken",
          },
          rationale: "test",
          estimatedRisk: "low",
        },
        {
          taskId: "task_canary_restore_fail",
          abortSignal: new AbortController().signal,
          reportProgress: () => {},
          invokeSubagent: async () => ({} as any),
        }
      )
    ).rejects.toThrow(/Canary tests failed/);

    expect(skillVersioningModule.restoreSkillVersion).toHaveBeenCalled();
  });
});

function rel(absolutePath: string): string {
  return relative(resolve(process.cwd()), absolutePath);
}
