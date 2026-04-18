import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, readFileSync, readdirSync, statSync, mkdirSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";
import {
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
} from "../../../skills/checkpoint/index.ts";

// We must be inside PROJECT_ROOT for checkpoints to work.
// Use a temp dir under cwd.
function createTempDir(): string {
  const dir = join(process.cwd(), ".ouroboros", "test-checkpoints", Date.now().toString());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        cleanupDir(full);
        rmdirSync(full);
      } else {
        unlinkSync(full);
      }
    }
  } catch {
    // ignore
  }
}

describe("checkpoint-manager", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = createTempDir();
  });

  afterAll(() => {
    cleanupDir(tempDir);
    try {
      rmdirSync(tempDir);
    } catch {
      // ignore
    }
  });

  it("creates and restores a checkpoint", () => {
    const file = join(tempDir, "test.txt");
    writeFileSync(file, "original", "utf-8");

    const cp = createCheckpoint(tempDir, "session-1");
    expect(cp.success).toBe(true);
    if (!cp.success) return;

    writeFileSync(file, "modified", "utf-8");
    expect(readFileSync(file, "utf-8")).toBe("modified");

    const restore = restoreCheckpoint(cp.data.id);
    expect(restore.success).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("original");
  });

  it("rejects path traversal", () => {
    const cp = createCheckpoint("/etc", "session-1");
    expect(cp.success).toBe(false);
    if (!cp.success) {
      expect(cp.error.code).toBe("PATH_TRAVERSAL");
    }
  });

  it("rejects invalid checkpoint id on restore", () => {
    const restore = restoreCheckpoint("invalid-id");
    expect(restore.success).toBe(false);
    if (!restore.success) {
      expect(["REPO_NOT_FOUND", "COMMIT_NOT_FOUND"]).toContain(restore.error.code);
    }
  });

  it("lists checkpoints by session", () => {
    const subDir = join(tempDir, "list-test");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "a.txt"), "a", "utf-8");

    const cp1 = createCheckpoint(subDir, "session-list");
    expect(cp1.success).toBe(true);

    const found = listCheckpoints("session-list");
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].sessionId).toBe("session-list");
  });
});
