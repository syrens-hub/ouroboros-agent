#!/usr/bin/env tsx
/**
 * Skill Marketplace Demo
 * ======================
 * Demonstrates installing a Skill from a remote (or local) source
 * into the Ouroboros skill directory.
 *
 * Phase 1: Create a temporary git repository containing a sample skill.
 * Phase 2: Use `install_skill` tool to install it into `skills/`.
 * Phase 3: Verify the skill appears in the registry and on disk.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { installSkillTool } from "../skills/marketplace/index.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import { META_RULE_AXIOM } from "../core/rule-engine.ts";
import type { TaskId, ToolCallContext } from "../types/index.ts";

const TMP_REPO = join(process.cwd(), ".ouroboros", "tmp", `marketplace-demo-${Date.now()}`);
const SAMPLE_SKILL_NAME = `weather-checker-demo-${Date.now()}`;

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║      S K I L L   M A R K E T P L A C E   I N S T A L L E R   ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Demonstrates `ouroboros skill install <git-url>` workflow.  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Phase 1: Bootstrap a temporary git repo with a sample skill
  console.log("[1/4] Creating temporary git repo with sample skill...\n");
  mkdirSync(TMP_REPO, { recursive: true });
  const skillDir = join(TMP_REPO, "weather-checker");
  mkdirSync(skillDir, { recursive: true });

  const skillMarkdown = `---
name: ${SAMPLE_SKILL_NAME}
description: Check the weather for a given city (demo skill from marketplace).
version: 1.0.0
tags: [weather, demo, marketplace]
autoLoad: false
---

# Weather Checker

This is a sample skill installed via the Ouroboros marketplace.
`;

  writeFileSync(join(skillDir, "SKILL.md"), skillMarkdown, "utf-8");

  // Init git repo and commit
  execSync("git init", { cwd: TMP_REPO, stdio: "ignore" });
  execSync("git config user.email 'demo@ouroboros.local'", { cwd: TMP_REPO, stdio: "ignore" });
  execSync("git config user.name 'Ouroboros Demo'", { cwd: TMP_REPO, stdio: "ignore" });
  execSync("git add .", { cwd: TMP_REPO, stdio: "ignore" });
  execSync("git commit -m 'Initial skill commit'", { cwd: TMP_REPO, stdio: "ignore" });

  console.log(`  → Temp repo created at ${TMP_REPO}`);
  console.log(`  → Sample skill: ${SAMPLE_SKILL_NAME}\n`);

  // Phase 2: Install the skill
  console.log("[2/4] Running install_skill tool...\n");
  const beforeSkills = discoverSkills().map((s) => s.name);
  const result = await installSkillTool.call(
    { source: TMP_REPO, force: false },
    { taskId: "marketplace-demo" as TaskId, abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as ToolCallContext<unknown>["invokeSubagent"] }
  );

  console.log(`  Installed: ${result.installed.map((i: { name: string }) => i.name).join(", ") || "none"}`);
  if (result.failed.length > 0) {
    console.log(`  Failed: ${result.failed.map((f: { name: string; error: string }) => `${f.name} (${f.error})`).join(", ")}`);
  }
  console.log();

  // Phase 3: Verify
  console.log("[3/4] Verifying installation...\n");
  const afterSkills = discoverSkills().map((s) => s.name);
  const installedPath = join(process.cwd(), "skills", SAMPLE_SKILL_NAME, "SKILL.md");
  const exists = existsSync(installedPath);

  console.log(`  Skill on disk: ${exists ? "✅ yes" : "❌ no"}`);
  console.log(`  Skill in registry: ${afterSkills.includes(SAMPLE_SKILL_NAME) ? "✅ yes" : "❌ no"}`);
  console.log(`  Total skills before: ${beforeSkills.length}`);
  console.log(`  Total skills after:  ${afterSkills.length}\n`);

  // Phase 4: Cleanup
  console.log("[4/4] Cleaning up temp repo...\n");
  rmSync(TMP_REPO, { recursive: true, force: true });

  // Also remove the installed demo skill so the workspace stays clean
  const installedSkillDir = join(process.cwd(), "skills", SAMPLE_SKILL_NAME);
  if (existsSync(installedSkillDir)) {
    rmSync(installedSkillDir, { recursive: true, force: true });
    console.log(`  → Removed installed demo skill from ${installedSkillDir}\n`);
  }

  // Final verdict
  console.log("═══════════════════════════════════════════════════════════════");
  if (exists && afterSkills.includes(SAMPLE_SKILL_NAME)) {
    console.log("✅ SKILL MARKETPLACE VERIFIED");
    console.log("   The install_skill tool successfully discovered, copied,");
    console.log("   and registered a remote skill into the local Ouroboros system.\n");
  } else {
    console.log("❌ SKILL MARKETPLACE FAILED");
    console.log("   The skill was not found after installation.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  // Cleanup
  try {
    rmSync(TMP_REPO, { recursive: true, force: true });
    const installedSkillDir = join(process.cwd(), "skills", SAMPLE_SKILL_NAME);
    rmSync(installedSkillDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(1);
});
