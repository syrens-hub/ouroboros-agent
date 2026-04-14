import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";

const TEST_DB_DIR = join(process.cwd(), ".ouboros", "test-marketplace-db-" + Date.now());
const TEST_TMP_DIR = join(process.cwd(), ".ouroboros", "test-marketplace-tmp-" + Date.now());

appConfig.db.dir = TEST_DB_DIR;
process.env.OUROBOROS_SKILL_DIR = join(process.cwd(), ".ouroboros", "test-marketplace-skills-" + Date.now());

import { installSkillTool } from "../../skills/marketplace/index.ts";
import { resetDbSingleton } from "../../core/session-db.ts";

describe("Marketplace", () => {
  beforeEach(() => {
    resetDbSingleton();
    const ts = Date.now();
    process.env.OUROBOROS_SKILL_DIR = join(process.cwd(), ".ouroboros", `test-marketplace-skills-${ts}`);
    const skillDir = process.env.OUROBOROS_SKILL_DIR;
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  });

  afterEach(() => {
    try {
      [process.env.OUROBOROS_SKILL_DIR, TEST_TMP_DIR, appConfig.db.dir].forEach((dir) => {
        if (!dir) return;
        const d = dir.startsWith("/") ? dir : join(process.cwd(), dir);
        if (existsSync(d)) rmSync(d, { recursive: true, force: true });
      });
    } catch {
      // ignore
    }
  });

  function makeSkillDir(name: string, parent = TEST_TMP_DIR) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} desc\nversion: 1.0.0\n---\n\n# ${name}\n`,
      "utf-8"
    );
    return dir;
  }

  it("installs skill from local path", async () => {
    const parent = join(TEST_TMP_DIR, "src1");
    makeSkillDir("local-skill", parent);
    const result = (await installSkillTool.call(
      { source: parent },
      { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] }
    )) as { installed: { name: string; path: string }[] };

    expect(result.installed.length).toBe(1);
    expect(result.installed[0].name).toBe("local-skill");
    expect(existsSync(join(process.env.OUROBOROS_SKILL_DIR!, "local-skill", "SKILL.md"))).toBe(true);
  });

  it("installs skill using subPath", async () => {
    const root = join(TEST_TMP_DIR, "repo");
    makeSkillDir("nested-skill", join(root, "packages", "skills"));
    const result = (await installSkillTool.call(
      { source: root, subPath: "packages/skills" },
      { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] }
    )) as { installed: { name: string; path: string }[] };

    expect(result.installed.length).toBe(1);
    expect(result.installed[0].name).toBe("nested-skill");
  });

  it("force overwrites existing skill", async () => {
    const parent = join(TEST_TMP_DIR, "src3");
    const src = makeSkillDir("overwrite-skill", parent);
    await installSkillTool.call(
      { source: parent },
      { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] }
    );

    // mutate source
    writeFileSync(join(src, "extra.txt"), "new", "utf-8");
    const result = (await installSkillTool.call(
      { source: parent, force: true },
      { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] }
    )) as { installed: { name: string; path: string }[] };

    expect(result.installed.length).toBe(1);
    expect(existsSync(join(process.env.OUROBOROS_SKILL_DIR!, "overwrite-skill", "extra.txt"))).toBe(true);
  });

  it("throws when no valid skills found", async () => {
    const emptyDir = join(TEST_TMP_DIR, "empty");
    mkdirSync(emptyDir, { recursive: true });
    await expect(
      installSkillTool.call(
        { source: emptyDir },
        { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] }
      )
    ).rejects.toThrow("No valid skills found");
  });
});
