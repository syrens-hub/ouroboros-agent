import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import {
  applyPatch,
  mutateFile,
  parseUnifiedDiff,
  applyHunks,
  applyDiffs,
  createBackup,
  restoreBackup,
} from "../../../skills/self-modify/index.ts";
import { evaluateConstitutionGuard } from "../../../core/constitution-guard.ts";
import { err } from "../../../types/index.ts";

// ---------------------------------------------------------------------------
// Mocks for side-effectful dependencies
// ---------------------------------------------------------------------------
vi.mock("../../../core/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../core/event-bus.ts", () => ({
  eventBus: {
    emitAsync: vi.fn(),
  },
}));

vi.mock("../../../skills/backup/index.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../skills/backup/index.ts")>();
  return {
    ...mod,
    pruneEvolutionBackups: vi.fn(() => ({ pruned: 0, errors: [] })),
  };
});

vi.mock("../../../core/constitution-guard.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../core/constitution-guard.ts")>();
  return {
    ...mod,
    evaluateConstitutionGuard: vi.fn(mod.evaluateConstitutionGuard),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_FIXTURE_DIR = join(process.cwd(), "tests", "skills", "self-modify", "fixtures");

function ensureClean(): void {
  if (existsSync(TEST_FIXTURE_DIR)) {
    rmSync(TEST_FIXTURE_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_FIXTURE_DIR, { recursive: true });
}

function fixturePath(name: string): string {
  return join("tests", "skills", "self-modify", "fixtures", name);
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. applyPatch
// ---------------------------------------------------------------------------
describe("applyPatch", () => {
  it("successfully replaces a substring", () => {
    const result = applyPatch("hello world", "world", "universe");
    if (!result.success) throw new Error("expected success");
    expect(result.data).toBe("hello universe");
  });

  it("returns error when old string is not found", () => {
    const result = applyPatch("hello world", "foo", "bar");
    if (result.success) throw new Error("expected failure");
    expect(result.error.code).toBe("PATCH_NO_MATCH");
    expect(result.error.message).toContain("Old string not found");
  });

  it("replaces all occurrences", () => {
    const result = applyPatch("abc abc abc", "abc", "xyz");
    if (!result.success) throw new Error("expected success");
    expect(result.data).toBe("xyz xyz xyz");
  });
});

// ---------------------------------------------------------------------------
// 2. mutateFile
// ---------------------------------------------------------------------------
describe("mutateFile", () => {
  beforeEach(() => ensureClean());
  afterEach(() => ensureClean());

  it("writes a new file", () => {
    const fp = fixturePath("mutate-new.ts");
    const result = mutateFile(fp, { type: "write", content: "export const a = 1;\n" });
    if (!result.success) throw new Error("expected success");
    expect(readFileSync(resolve(process.cwd(), fp), "utf-8")).toBe("export const a = 1;\n");
  });

  it("patches an existing file", () => {
    const fp = fixturePath("mutate-patch.ts");
    writeFileSync(resolve(process.cwd(), fp), "let x = 1;\nlet y = 2;\n", "utf-8");
    const result = mutateFile(fp, { type: "patch", old: "let x = 1;", new: "let x = 99;" });
    if (!result.success) throw new Error("expected success");
    const content = readFileSync(resolve(process.cwd(), fp), "utf-8");
    expect(content).toContain("let x = 99;");
    expect(content).toContain("let y = 2;");
  });

  it("returns error when patch old string is not found", () => {
    const fp = fixturePath("mutate-patch-miss.ts");
    writeFileSync(resolve(process.cwd(), fp), "const x = 1;\n", "utf-8");
    const result = mutateFile(fp, { type: "patch", old: "not found", new: "replaced" });
    if (result.success) throw new Error("expected failure");
    expect(result.error.code).toBe("PATCH_NO_MATCH");
  });

  it("rejects absolute path traversal outside project root", () => {
    const result = mutateFile("/etc/passwd", { type: "write", content: "hack" });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("Path traversal detected");
  });

  it("rejects relative path traversal outside project root", () => {
    const result = mutateFile("../../../etc/passwd", { type: "write", content: "hack" });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("Path traversal detected");
  });
});

// ---------------------------------------------------------------------------
// 3. parseUnifiedDiff
// ---------------------------------------------------------------------------
describe("parseUnifiedDiff", () => {
  it("parses a standard unified diff", () => {
    const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 line1
-line2
+line2_modified
 line3
`;
    const parsed = parseUnifiedDiff(diff);
    expect(parsed).not.toBeNull();
    expect(parsed!.oldPath).toBe("foo.ts");
    expect(parsed!.newPath).toBe("foo.ts");
    expect(parsed!.hunks.length).toBe(1);
    expect(parsed!.hunks[0].oldStart).toBe(1);
    expect(parsed!.hunks[0].oldCount).toBe(3);
    expect(parsed!.hunks[0].newStart).toBe(1);
    expect(parsed!.hunks[0].newCount).toBe(3);
    expect(parsed!.hunks[0].lines.length).toBe(4);
    expect(parsed!.hunks[0].lines[0]).toEqual({ type: "context", text: "line1" });
    expect(parsed!.hunks[0].lines[1]).toEqual({ type: "remove", text: "line2" });
    expect(parsed!.hunks[0].lines[2]).toEqual({ type: "add", text: "line2_modified" });
    expect(parsed!.hunks[0].lines[3]).toEqual({ type: "context", text: "line3" });
  });

  it("strips a/ and b/ prefixes from paths", () => {
    const diff = `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,1 +1,1 @@
-old
+new
`;
    const parsed = parseUnifiedDiff(diff);
    expect(parsed).not.toBeNull();
    expect(parsed!.oldPath).toBe("src/index.ts");
    expect(parsed!.newPath).toBe("src/index.ts");
  });

  it("returns null when paths are missing", () => {
    const diff = `--- 
+++ 
@@ -1,1 +1,1 @@
-foo
+bar
`;
    expect(parseUnifiedDiff(diff)).toBeNull();
  });

  it("returns null for invalid format", () => {
    expect(parseUnifiedDiff("this is not a diff")).toBeNull();
    expect(parseUnifiedDiff("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. applyHunks
// ---------------------------------------------------------------------------
describe("applyHunks", () => {
  it("applies hunks to lines", () => {
    const original = ["line1", "line2", "line3"];
    const hunks = [
      {
        oldStart: 2,
        oldCount: 1,
        newStart: 2,
        newCount: 1,
        lines: [
          { type: "remove" as const, text: "line2" },
          { type: "add" as const, text: "line2_modified" },
        ],
      },
    ];
    const result = applyHunks(original, hunks);
    expect(result).toEqual(["line1", "line2_modified", "line3"]);
  });

  it("applies multiple hunks from bottom to top", () => {
    const original = ["a", "b", "c", "d", "e"];
    const hunks = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { type: "remove" as const, text: "a" },
          { type: "add" as const, text: "A" },
        ],
      },
      {
        oldStart: 5,
        oldCount: 1,
        newStart: 5,
        newCount: 1,
        lines: [
          { type: "remove" as const, text: "e" },
          { type: "add" as const, text: "E" },
        ],
      },
    ];
    const result = applyHunks(original, hunks);
    expect(result).toEqual(["A", "b", "c", "d", "E"]);
  });

  it("inserts lines when oldCount is zero", () => {
    const original = ["a", "b", "c"];
    const hunks = [
      {
        oldStart: 2,
        oldCount: 0,
        newStart: 2,
        newCount: 1,
        lines: [{ type: "add" as const, text: "inserted" }],
      },
    ];
    const result = applyHunks(original, hunks);
    expect(result).toEqual(["a", "inserted", "b", "c"]);
  });

  it("throws when hunk start is out of range", () => {
    const original = ["line1"];
    const hunks = [
      {
        oldStart: 10,
        oldCount: 1,
        newStart: 10,
        newCount: 1,
        lines: [{ type: "add" as const, text: "out_of_range" }],
      },
    ];
    expect(() => applyHunks(original, hunks)).toThrow("out of range");
  });
});

// ---------------------------------------------------------------------------
// 5. applyDiffs
// ---------------------------------------------------------------------------
describe("applyDiffs", () => {
  beforeEach(() => ensureClean());
  afterEach(() => ensureClean());

  it("dry-run mode does not modify files", () => {
    const fp = fixturePath("dryrun.ts");
    writeFileSync(resolve(process.cwd(), fp), "const a = 1;\n", "utf-8");
    const result = applyDiffs(
      { [fp]: "const a = 2;\n" },
      { dryRun: true, skipSyntaxCheck: true }
    );
    if (!result.success) throw new Error("expected success");
    expect(result.filesApplied).toContain(fp);
    const content = readFileSync(resolve(process.cwd(), fp), "utf-8");
    expect(content).toBe("const a = 1;\n");
  });

  it("applies full content replacement successfully", () => {
    const fp = fixturePath("content-replace.ts");
    const backupDir = join(TEST_FIXTURE_DIR, "backups");
    const result = applyDiffs(
      { [fp]: "export const greet = 'hi';\n" },
      { skipSyntaxCheck: true, backupDir }
    );
    if (!result.success) throw new Error("expected success");
    expect(result.filesApplied).toContain(fp);
    expect(result.backupPath).toBe(backupDir);
    const content = readFileSync(resolve(process.cwd(), fp), "utf-8");
    expect(content).toBe("export const greet = 'hi';\n");
  });

  it("applies unified diff successfully", () => {
    const fp = fixturePath("diff-apply.ts");
    writeFileSync(
      resolve(process.cwd(), fp),
      "let count = 0;\nexport function inc() {\n  count++;\n  return count;\n}\n",
      "utf-8"
    );
    const diff = `--- a/${fp}
+++ b/${fp}
@@ -1,4 +1,4 @@
 let count = 0;
 export function inc() {
-  count++;
+  count += 1;
   return count;
 }
`;
    const backupDir = join(TEST_FIXTURE_DIR, "backups");
    const result = applyDiffs({ [fp]: diff }, { skipSyntaxCheck: true, backupDir });
    if (!result.success) throw new Error("expected success");
    expect(result.filesApplied).toContain(fp);
    const content = readFileSync(resolve(process.cwd(), fp), "utf-8");
    expect(content).toContain("count += 1;");
    expect(content).not.toContain("count++;");
  });

  it("blocks known immutable paths via constitution guard", () => {
    const result = applyDiffs(
      { "core/rule-engine.ts": "// hacked" },
      { skipSyntaxCheck: true }
    );
    if (result.success) throw new Error("expected failure");
    expect(result.filesFailed.length).toBeGreaterThan(0);
    expect(result.filesFailed[0].path).toBe("core/rule-engine.ts");
    expect(result.filesFailed[0].error).toContain("Constitution");
  });

  it("blocks via mocked constitution guard", () => {
    vi.mocked(evaluateConstitutionGuard).mockReturnValueOnce(
      err({ code: "CONSTITUTION_VIOLATION", message: "Mock guard block" })
    );
    const fp = fixturePath("guard-block.ts");
    const result = applyDiffs(
      { [fp]: "content" },
      { skipSyntaxCheck: true }
    );
    if (result.success) throw new Error("expected failure");
    expect(result.filesFailed).toEqual([
      { path: fp, error: "Mock guard block" },
    ]);
  });

  it("rolls back on application failure", () => {
    const fp1 = fixturePath("rollback-ok.ts");
    const fp2 = fixturePath("rollback-fail.ts");
    const p1 = resolve(process.cwd(), fp1);
    writeFileSync(p1, "const original = 1;\n", "utf-8");

    const diffs: Record<string, string> = {
      [fp1]: "const modified = 2;\n",
      [fp2]: `--- 
+++ 
@@ -1,1 +1,1 @@
-foo
+bar
`,
    };

    const backupDir = join(TEST_FIXTURE_DIR, "rollback-backup");
    const result = applyDiffs(diffs, { skipSyntaxCheck: true, backupDir });

    if (result.success) throw new Error("expected failure");
    expect(result.filesFailed.some((f) => f.path === fp2)).toBe(true);
    expect(result.backupPath).toBe(backupDir);

    // Rollback should restore the original content of the successfully-applied file
    const content = readFileSync(p1, "utf-8");
    expect(content).toBe("const original = 1;\n");
  });
});

// ---------------------------------------------------------------------------
// 6. createBackup / restoreBackup
// ---------------------------------------------------------------------------
describe("createBackup / restoreBackup", () => {
  beforeEach(() => ensureClean());
  afterEach(() => ensureClean());

  it("round-trips backup and restore", () => {
    const fp = fixturePath("backup-roundtrip.ts");
    const originalPath = resolve(process.cwd(), fp);
    writeFileSync(originalPath, "export const x = 42;\n", "utf-8");

    const backupDir = join(TEST_FIXTURE_DIR, "backups");
    const backupPath = createBackup("v1", [fp], backupDir);
    expect(existsSync(backupPath)).toBe(true);

    writeFileSync(originalPath, "export const x = 999;\n", "utf-8");

    const restored = restoreBackup("v1", backupPath);
    expect(restored).toContain(fp);

    const content = readFileSync(originalPath, "utf-8");
    expect(content).toBe("export const x = 42;\n");
  });

  it("round-trips nested file paths", () => {
    const fp = fixturePath("nested/backup-nested.ts");
    const originalPath = resolve(process.cwd(), fp);
    mkdirSync(dirname(originalPath), { recursive: true });
    writeFileSync(originalPath, "export const nested = true;\n", "utf-8");

    const backupDir = join(TEST_FIXTURE_DIR, "backups-nested");
    const backupPath = createBackup("v2", [fp], backupDir);
    expect(existsSync(backupPath)).toBe(true);

    writeFileSync(originalPath, "export const nested = false;\n", "utf-8");

    const restored = restoreBackup("v2", backupPath);
    expect(restored).toContain(fp);

    const content = readFileSync(originalPath, "utf-8");
    expect(content).toBe("export const nested = true;\n");
  });

  it("throws when restoring a missing backup", () => {
    expect(() =>
      restoreBackup("missing-version", join(TEST_FIXTURE_DIR, "nonexistent"))
    ).toThrow("Backup not found");
  });
});
