/**
 * Ouroboros Skill Marketplace
 * =============================
 * Install Skills from remote git repositories or local paths.
 *
 * Usage:
 *   install_skill({ gitUrl: "https://github.com/user/ouroboros-skills.git" })
 */

import { z } from "zod";
import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { buildTool } from "../../core/tool-framework.ts";
import { MARKETPLACE_CLONE_TIMEOUT_MS } from "../../web/routes/constants.ts";
import { parseSkillFrontmatter, clearSkillsCache } from "../learning/index.ts";
import { upsertSkillRegistry, getSkillRegistry } from "../../core/session-db.ts";
import { scanSkill, shouldAllowInstall } from "../skills-guard/index.ts";
import type { Skill, Result, TaskId, ToolCallContext } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

function getSkillDir(): string {
  return process.env.OUROBOROS_SKILL_DIR || join(process.cwd(), "skills");
}
const TMP_DIR = join(process.cwd(), ".ouroboros", "tmp");

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function isValidGitRef(ref: string): boolean {
  return /^[a-zA-Z0-9._\-/]+$/.test(ref);
}

// Simple semver comparison: returns 1 if a>b, 0 if equal, -1 if a<b
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function runGitClone(source: string, cloneDir: string, branch?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["clone", "--depth", "1"];
    if (branch) {
      args.push("--branch", branch);
    }
    args.push(source, cloneDir);
    const proc = spawn("git", args, { stdio: "pipe", timeout: MARKETPLACE_CLONE_TIMEOUT_MS });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed (code ${code}): ${stderr}`));
    });
  });
}

function containsTraversal(input: string): boolean {
  const normalized = input.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.includes("..");
}

function discoverSkillsInDirectory(dir: string): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(dir)) return skills;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");
    const fmResult = parseSkillFrontmatter(content);
    if (!fmResult.success) continue;
    skills.push({
      name: fmResult.data.name,
      frontmatter: fmResult.data,
      markdownBody: content,
      directory: skillDir,
      sourceCodeFiles: new Map(),
    });
  }
  return skills;
}

function discoverSkillsRecursively(dir: string): Skill[] {
  // Try top-level first
  const top = discoverSkillsInDirectory(dir);
  if (top.length > 0) return top;

  // If no skills at top-level, scan one level deeper (common for monorepos)
  const nested: Skill[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subDir = join(dir, entry.name);
      nested.push(...discoverSkillsInDirectory(subDir));
    }
  }
  return nested;
}

async function installSkill(skill: Skill, targetDir: string, _force = false, scanResult?: ReturnType<typeof scanSkill>): Promise<Result<string>> {
  const dest = join(targetDir, skill.name);
  try {
    cpSync(skill.directory, dest, { recursive: true, force: true });
    await upsertSkillRegistry(
      skill.name,
      dest,
      skill.frontmatter,
      skill.frontmatter.autoLoad,
      scanResult ? JSON.stringify(scanResult) : undefined,
      scanResult?.trustLevel
    );
    return ok(dest);
  } catch (e) {
    return err({ code: "INSTALL_ERROR", message: String(e) });
  }
}

export const installSkillTool = buildTool({
  name: "install_skill",
  description:
    "Clone a git repository (or copy a local path) and install all discovered skills into the local skill directory. " +
    "Supports optional branch/tag and subPath for monorepos.",
  inputSchema: z.object({
    source: z.string().describe("Git URL or local file path to the skill repository"),
    branch: z.string().optional().describe("Git branch or tag to checkout"),
    tag: z.string().optional().describe("Git tag (semver) to checkout; takes precedence over branch"),
    subPath: z.string().optional().describe("Subdirectory inside the repo to scan for skills"),
    force: z.boolean().default(false).describe("Overwrite existing skills with the same name"),
    allowDowngrade: z.boolean().default(false).describe("Allow installing an older version over a newer one"),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  costProfile: { latency: "slow", cpuIntensity: "medium", externalCost: "low" },
  async call({ source, branch, tag, subPath, force, allowDowngrade }) {
    ensureTmpDir();
    const gitRef = tag || branch;
    if (gitRef && !isValidGitRef(gitRef)) {
      throw new Error("Invalid branch/tag name.");
    }
    if (subPath && containsTraversal(subPath)) {
      throw new Error("Invalid subPath.");
    }
    const tmpId = `skill-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cloneDir = join(TMP_DIR, tmpId);

    try {
      const isLocal = existsSync(source);

      if (isLocal) {
        if (containsTraversal(source)) {
          throw new Error("Invalid local source path.");
        }
        // Local path: just copy
        cpSync(source, cloneDir, { recursive: true });
      } else {
        // Git clone (tag takes precedence over branch)
        await runGitClone(source, cloneDir, gitRef);
      }

      const scanDir = subPath ? join(cloneDir, subPath) : cloneDir;
      const found = discoverSkillsRecursively(scanDir);

      if (found.length === 0) {
        rmSync(cloneDir, { recursive: true, force: true });
        throw new Error(`No valid skills found in ${source}${subPath ? ` (subPath: ${subPath})` : ""}`);
      }

      const installed: { name: string; path: string }[] = [];
      const failed: { name: string; error: string }[] = [];

      const registryRes = await getSkillRegistry();
      const installedSkills = new Set(registryRes.success ? registryRes.data.map((r) => r.name) : []);

      for (const skill of found) {
        // Check declared dependencies
        let depsOk = true;
        if (skill.frontmatter.dependencies) {
          for (const [depName, depRange] of Object.entries(skill.frontmatter.dependencies)) {
            if (!installedSkills.has(depName)) {
              failed.push({ name: skill.name, error: `Missing dependency: ${depName} (${depRange})` });
              depsOk = false;
              break;
            }
          }
        }
        if (!depsOk) continue;

        const dest = join(getSkillDir(), skill.name);
        if (existsSync(dest) && !force) {
          const existingMd = join(dest, "SKILL.md");
          let shouldSkip = true;
          if (existsSync(existingMd) && skill.frontmatter.version) {
            const existingContent = readFileSync(existingMd, "utf-8");
            const existingFm = parseSkillFrontmatter(existingContent);
            if (existingFm.success && existingFm.data.version) {
              const cmp = compareSemver(skill.frontmatter.version, existingFm.data.version);
              if (cmp > 0) shouldSkip = false; // newer version
              else if (cmp < 0 && allowDowngrade) shouldSkip = false;
            }
          }
          if (shouldSkip) {
            failed.push({ name: skill.name, error: `Skill ${skill.name} already installed at ${dest}. Use force=true to overwrite.` });
            continue;
          }
        }
        // Security scan before installing external skill
        const scan = scanSkill(skill.directory, "community");
        const allow = shouldAllowInstall(scan);
        if (allow.action === "block") {
          failed.push({ name: skill.name, error: `Skills Guard blocked: ${allow.reason}` });
          continue;
        }

        const result = await installSkill(skill, getSkillDir(), force, scan);
        if (result.success) {
          installed.push({ name: skill.name, path: result.data });
        } else {
          failed.push({ name: skill.name, error: result.error.message });
        }
      }

      rmSync(cloneDir, { recursive: true, force: true });
      if (installed.length > 0) clearSkillsCache();

      return {
        installed,
        failed,
        source,
        scanned: found.map((s) => s.name),
      };
    } catch (e) {
      // Cleanup on error
      try {
        rmSync(cloneDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      throw e;
    }
  },
});

// Convenience one-shot for scripts
export async function installSkillFromGit(
  gitUrl: string,
  opts: { branch?: string; tag?: string; subPath?: string; force?: boolean; allowDowngrade?: boolean } = {}
): Promise<{ installed: { name: string; path: string }[]; failed: { name: string; error: string }[] }> {
  return installSkillTool.call(
    { source: gitUrl, ...opts },
    { taskId: "marketplace" as TaskId, abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as ToolCallContext<unknown>["invokeSubagent"] }
  );
}
