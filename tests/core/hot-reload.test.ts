import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const TEST_DIR = join(process.cwd(), ".ouroboros", "test-hot-reload");
const SCRIPT_PATH = join(process.cwd(), "tests", "core", "hot-reload-child.ts");

describe("Hot Reload", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("reloads module when file changes via child process", () => {
    const modPath = join(TEST_DIR, "mod.ts");
    writeFileSync(modPath, `export const value = 1;`, "utf-8");

    const output = execSync(`npx tsx "${SCRIPT_PATH}" "${modPath}"`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    expect(output).toContain("init: 1");
    expect(output).toContain("reload: 42");
  });
});
