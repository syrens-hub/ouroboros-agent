import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyPatch, mutateFile } from "../../skills/self-modify/index.ts";
import { existsSync, readFileSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";

const TEST_DIR = join(process.cwd(), ".ouroboros", "test-mutations");

describe("Self-Modify", () => {
  beforeEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        ["a.txt", "b.txt"].forEach((f) => {
          const p = join(TEST_DIR, f);
          if (existsSync(p)) unlinkSync(p);
        });
        rmdirSync(TEST_DIR);
      }
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      ["a.txt", "b.txt"].forEach((f) => {
        const p = join(TEST_DIR, f);
        if (existsSync(p)) unlinkSync(p);
      });
      if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR);
    } catch {
      // ignore
    }
  });

  it("applyPatch replaces a substring", () => {
    const res = applyPatch("hello world", "world", "Ouroboros");
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("hello Ouroboros");
  });

  it("applyPatch returns error when old string missing", () => {
    const res = applyPatch("hello world", "missing", "xxx");
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("PATCH_NO_MATCH");
  });

  it("mutateFile writes new content", () => {
    const file = join(".ouroboros", "test-mutations", "a.txt");
    const res = mutateFile(file, { type: "write", content: "version 1" });
    expect(res.success).toBe(true);
    const fullPath = join(process.cwd(), file);
    expect(readFileSync(fullPath, "utf-8")).toBe("version 1");
  });

  it("mutateFile patches existing content", () => {
    const file = join(".ouroboros", "test-mutations", "b.txt");
    mutateFile(file, { type: "write", content: "foo bar baz" });
    const res = mutateFile(file, { type: "patch", old: "bar", new: "qux" });
    expect(res.success).toBe(true);
    const fullPath = join(process.cwd(), file);
    expect(readFileSync(fullPath, "utf-8")).toBe("foo qux baz");
  });
});
