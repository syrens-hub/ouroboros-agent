#!/usr/bin/env tsx
/**
 * Autonomous Evolution Daemon Demo
 * ================================
 * Demonstrates the fully autonomous loop:
 *   1. Daemon scans recent sessions.
 *   2. For each session, it reviews the trajectory.
 *   3. If a reusable pattern is found, it auto-creates a Skill.
 *   4. All modifications pass through the Rule Engine.
 */

import { existsSync, readFileSync, rmSync, copyFileSync } from "fs";
import { join } from "path";
import { createSession, appendMessage } from "../core/session-db.ts";
import { autonomousEvolutionLoop } from "../skills/autonomous-evolution/index.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import { META_RULE_AXIOM } from "../core/rule-engine.ts";

const DEMO_SESSION_ID = `autonomous_demo_${Date.now()}`;
const DAEMON_SOURCE_PATH = join(process.cwd(), "skills", "autonomous-evolution", "index.ts");
const DAEMON_BACKUP_PATH = DAEMON_SOURCE_PATH + ".backup";
const EXPECTED_SKILL_NAME = `greeting-optimizer-demo-${Date.now()}`;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   A U T O N O M O U S   E V O L U T I O N   D A E M O N      ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  The system continuously reviews sessions and auto-creates   ║");
  console.log("║  Skills without human intervention.                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Backup daemon source in case self-review triggers
  copyFileSync(DAEMON_SOURCE_PATH, DAEMON_BACKUP_PATH);

  // Phase 1: Seed a session with a learnable pattern
  console.log("[1/4] Seeding SessionDB with a demo conversation...\n");
  await createSession(DEMO_SESSION_ID, { title: "Autonomous Evolution Demo" });
  await appendMessage(DEMO_SESSION_ID, {
    role: "user",
    content: "Every time someone says 'hi', I want you to respond with a cheerful greeting and ask how you can help.",
  });
  await appendMessage(DEMO_SESSION_ID, {
    role: "assistant",
    content: "Got it! I'll use a cheerful greeting whenever you say 'hi'.",
  });
  await appendMessage(DEMO_SESSION_ID, { role: "user", content: "hi" });
  await appendMessage(DEMO_SESSION_ID, {
    role: "assistant",
    content: "Hey there! 👋 How can I help you today?",
  });
  console.log("  → Demo session created with 4 messages.\n");

  // Phase 2: Configure daemon with a deterministic mock review caller
  console.log("[2/4] Starting Autonomous Evolution Daemon...\n");

  const beforeSkills = discoverSkills().map((s) => s.name);

  autonomousEvolutionLoop.start();

  console.log("  [Autonomous Loop] Started");
  console.log(`  [State] ${JSON.stringify(autonomousEvolutionLoop.getState())}`);

  // Wait for one tick
  await sleep(3500);

  autonomousEvolutionLoop.stop();

  console.log("\n  → Autonomous loop stopped after first tick.\n");

  // Phase 3: Verify skill creation
  console.log("[3/4] Verifying autonomous skill creation...\n");
  const afterSkills = discoverSkills().map((s) => s.name);
  const skillCreated = afterSkills.includes(EXPECTED_SKILL_NAME);
  const skillPath = join(process.cwd(), "skills", EXPECTED_SKILL_NAME, "SKILL.md");

  console.log(`  Skill on disk: ${existsSync(skillPath) ? "✅ yes" : "❌ no"}`);
  console.log(`  Skill in registry: ${skillCreated ? "✅ yes" : "❌ no"}`);
  console.log(`  Total skills before: ${beforeSkills.length}`);
  console.log(`  Total skills after:  ${afterSkills.length}\n`);

  // Check self-review marker
  const daemonSource = readFileSync(DAEMON_SOURCE_PATH, "utf-8");
  const selfReviewApplied = daemonSource.includes("SELF_IMPROVEMENT_VERSION: 1");
  console.log(`  Self-review marker applied: ${selfReviewApplied ? "✅ yes" : "❌ no"}\n`);

  // Phase 4: Cleanup
  console.log("[4/4] Cleaning up demo artifacts...\n");
  if (existsSync(skillPath)) {
    rmSync(join(process.cwd(), "skills", EXPECTED_SKILL_NAME), { recursive: true, force: true });
  }
  copyFileSync(DAEMON_BACKUP_PATH, DAEMON_SOURCE_PATH);
  rmSync(DAEMON_BACKUP_PATH, { force: true });
  console.log("  → Demo skill removed and daemon source restored.\n");

  // Final verdict
  console.log("═══════════════════════════════════════════════════════════════");
  if (skillCreated && selfReviewApplied) {
    console.log("✅ AUTONOMOUS EVOLUTION VERIFIED");
    console.log("   The daemon scanned a session, auto-created a Skill,");
    console.log("   and applied a self-improvement marker without human input.\n");
  } else if (skillCreated) {
    console.log("✅ AUTONOMOUS EVOLUTION PARTIAL");
    console.log("   Skill was auto-created, but self-review marker was not applied.\n");
  } else {
    console.log("❌ AUTONOMOUS EVOLUTION FAILED");
    console.log("   The skill was not auto-created.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  // Emergency restore
  try {
    if (existsSync(DAEMON_BACKUP_PATH)) {
      copyFileSync(DAEMON_BACKUP_PATH, DAEMON_SOURCE_PATH);
      rmSync(DAEMON_BACKUP_PATH, { force: true });
    }
    const skillPath = join(process.cwd(), "skills", EXPECTED_SKILL_NAME);
    if (existsSync(skillPath)) {
      rmSync(skillPath, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
  process.exit(1);
});
