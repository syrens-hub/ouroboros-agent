import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadProjectMemorySync,
  getCachedProjectMemory,
  invalidateProjectMemoryCache,
} from "../../core/project-memory.ts";
import { resetSessionStateForTests } from "../../core/session-state.ts";

describe("project-memory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ouro-test-"));
    resetSessionStateForTests();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSessionStateForTests();
  });

  it("reads OUROBOROS.md", () => {
    writeFileSync(join(dir, "OUROBOROS.md"), "# Project Rules\nBe kind.");
    expect(loadProjectMemorySync(dir)).toBe("# Project Rules\nBe kind.");
  });

  it("reads .ouroboros/prompt.md as fallback", () => {
    mkdirSync(join(dir, ".ouroboros"), { recursive: true });
    writeFileSync(join(dir, ".ouroboros", "prompt.md"), "# Prompt\nHello");
    expect(loadProjectMemorySync(dir)).toBe("# Prompt\nHello");
  });

  it("returns null when no file exists", () => {
    expect(loadProjectMemorySync(dir)).toBeNull();
  });

  it("caches result per session", () => {
    writeFileSync(join(dir, "OUROBOROS.md"), "cached");
    const s1 = getCachedProjectMemory("sess-a", dir);
    expect(s1).toBe("cached");
    // mutate file; cache should still return old value
    writeFileSync(join(dir, "OUROBOROS.md"), "mutated");
    const s2 = getCachedProjectMemory("sess-a", dir);
    expect(s2).toBe("cached");
  });

  it("refreshes after invalidation", () => {
    writeFileSync(join(dir, "OUROBOROS.md"), "v1");
    expect(getCachedProjectMemory("sess-b", dir)).toBe("v1");
    writeFileSync(join(dir, "OUROBOROS.md"), "v2");
    invalidateProjectMemoryCache("sess-b");
    expect(getCachedProjectMemory("sess-b", dir)).toBe("v2");
  });
});
