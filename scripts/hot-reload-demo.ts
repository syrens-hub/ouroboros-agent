#!/usr/bin/env tsx
/**
 * Agent Loop Hot Reload Demo
 * ============================
 * Demonstrates that Ouroboros can reload its own Agent Loop Skill
 * at runtime after it has been _modified on disk.
 *
 * Phase 1: Run a hello turn with the current loop.
 * Phase 2: Patch the loop file to add a v2 marker log.
 * Phase 3: Wait for fs.watch to trigger hot reload.
 * Phase 4: Run another hello turn and observe the new log.
 */

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { watchModule } from "../skills/hot-reload/index.ts";
import { createToolPool } from "../core/tool-framework.ts";
import { META_RULE_AXIOM } from "../core/rule-engine.ts";

const LOOP_PATH = join(process.cwd(), "skills", "agent-loop", "index.ts");
const BACKUP_PATH = LOOP_PATH + ".backup";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     A G E N T   L O O P   H O T   R E L O A D   D E M O      ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  The system will patch its own loop, hot-reload it, and      ║");
  console.log("║  immediately run the new code without process restart.         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Backup original
  copyFileSync(LOOP_PATH, BACKUP_PATH);

  // Set up hot-reload watcher for the agent loop _module
  console.log(`[1/5] Setting up hot-reload watcher for ${LOOP_PATH}...\n`);

  type AgentLoopModule = typeof import("../skills/agent-loop/index.ts");
  let reloadCount = 0;

  const handle = watchModule<AgentLoopModule>(LOOP_PATH, {
    onLoad: (_mod) => {
      reloadCount++;
      console.log(`[Hot Reload] Agent Loop reloaded (count: ${reloadCount}).`);
      if (reloadCount > 1) {
        console.log("          → New loop source is now active in memory.\n");
      }
    },
    onError: (err) => {
      console.error("[Hot Reload] Error:", err.message);
    },
  });

  // Wait for initial load
  await sleep(500);

  // Phase 1: Run with current loop
  console.log("[2/5] Running hello with CURRENT loop...\n");
  const _mod1 = handle.current!;
  const pool1 = createToolPool();
  const runner1 = _mod1.createAgentLoopRunner({
    sessionId: `hot_before_${Date.now()}`,
    tools: pool1.all(),
    llmCaller: _mod1.createMockLLMCaller(),
    enableBackgroundReview: false,
  });

  for await (const msg of runner1.run("hello")) {
    if ("role" in msg && msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : "";
      console.log(`  Assistant: ${text}\n`);
    }
  }

  // Phase 2: Apply patch to loop source
  console.log("[3/5] Patching loop source to add v2 visibility log...\n");
  const source = readFileSync(LOOP_PATH, "utf-8");
  const marker = `      state.status = "running";`;
  const patched = source.replace(
    marker,
    `      state.status = "running";\n      console.log(\`[Ouroboros Loop v2 HOT-RELOADED] Turn \${state.turnCount} starting\`);`
  );

  if (source === patched) {
    console.error("❌ Patch failed: marker not found. Restoring backup.\n");
    copyFileSync(BACKUP_PATH, LOOP_PATH);
    handle.dispose();
    process.exit(1);
  }

  writeFileSync(LOOP_PATH, patched, "utf-8");
  console.log("  → Patch written to disk. Waiting for fs.watch...\n");

  // Phase 3: Wait for hot reload
  const beforeCount = reloadCount;
  let attempts = 0;
  while (reloadCount <= beforeCount && attempts < 50) {
    await sleep(100);
    attempts++;
  }

  if (reloadCount <= beforeCount) {
    console.error("❌ Hot reload did not trigger within 5s. Restoring backup.\n");
    copyFileSync(BACKUP_PATH, LOOP_PATH);
    handle.dispose();
    process.exit(1);
  }

  // Phase 4: Run with new loop
  console.log("[4/5] Running hello with NEW loop (expect v2 log)...\n");
  const _mod2 = handle.current!;
  const pool2 = createToolPool();
  const runner2 = _mod2.createAgentLoopRunner({
    sessionId: `hot_after_${Date.now()}`,
    tools: pool2.all(),
    llmCaller: _mod2.createMockLLMCaller(),
    enableBackgroundReview: false,
  });

  // Capture console.log from the loop
  const originalLog = console.log;
  let v2LogSeen = false;
  console.log = (...args: unknown[]) => {
    const line = args.join(" ");
    if (line.includes("[Ouroboros Loop v2 HOT-RELOADED]")) {
      v2LogSeen = true;
    }
    originalLog.apply(console, args);
  };

  for await (const msg of runner2.run("hello")) {
    if ("role" in msg && msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : "";
      console.log(`  Assistant: ${text}\n`);
    }
  }

  console.log = originalLog;

  // Phase 5: Restore backup
  console.log("[5/5] Restoring original loop source...\n");
  copyFileSync(BACKUP_PATH, LOOP_PATH);
  await sleep(300);
  handle.dispose();

  // Verification
  console.log("═══════════════════════════════════════════════════════════════");
  if (v2LogSeen) {
    console.log("✅ HOT RELOAD VERIFIED");
    console.log("   The Agent Loop was mutated on disk, reloaded at runtime,");
    console.log("   and the new behavior executed without restarting Node.\n");
  } else {
    console.log("⚠️  HOT RELOAD PARTIAL");
    console.log("   The _module reloaded but the v2 log was not captured.\n");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  // Emergency restore
  try {
    copyFileSync(BACKUP_PATH, LOOP_PATH);
  } catch {
    // ignore
  }
  process.exit(1);
});
