#!/usr/bin/env tsx
/**
 * Priority A: Agent Loop Self-Evolution Demo
 * ===========================================
 * This script demonstrates the ultimate proof of Ouroboros:
 * the Agent Loop — itself a Skill — reading its own source,
 * deciding on an improvement, and replacing itself via self_modify.
 *
 * All mutations pass through the immutable Rule Engine.
 */

import { readFileSync } from "fs";
import { createToolPool } from "../core/tool-framework.ts";
import { setSelfModifyConfirmCallback } from "../skills/self-modify/index.ts";
import {
  compressTrajectoryTool,
  discoverSkillsTool,
  writeSkillTool,
  readSkillTool,
} from "../skills/learning/index.ts";
import { selfModifyTool, ruleEngineOverrideTool } from "../skills/self-modify/index.ts";
import { agentLoopTool, createAgentLoopRunner, createMockLLMCaller } from "../skills/agent-loop/index.ts";
import { readFileTool, writeFileTool } from "../skills/file-tools.ts";
import { META_RULE_AXIOM } from "../core/rule-engine.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     P R I O R I T Y   A :  S E L F - E V O L U T I O N       ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  The Agent Loop will read its own source code, propose a     ║");
  console.log("║  patch, and replace itself — guarded by the Rule Engine.     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Confirm callback: auto-approve low-risk loop replacements in demo
  setSelfModifyConfirmCallback(async (req) => {
    console.log("\n[SELF-MODIFICATION REQUEST]");
    console.log(`  Type: ${req.type}`);
    console.log(`  Risk: ${req.estimatedRisk}`);
    console.log(`  Rationale: ${req.rationale}`);
    console.log(`  Description: ${req.description}`);
    if (req.estimatedRisk === "low" || req.estimatedRisk === "medium") {
      console.log("  → AUTO-APPROVED for demo\n");
      return true;
    }
    console.log("  → DENIED\n");
    return false;
  });

  // Assemble tools
  const globalPool = createToolPool();
  globalPool.register(compressTrajectoryTool);
  globalPool.register(discoverSkillsTool);
  globalPool.register(writeSkillTool);
  globalPool.register(readSkillTool);
  globalPool.register(selfModifyTool);
  globalPool.register(ruleEngineOverrideTool);
  globalPool.register(agentLoopTool);
  globalPool.register(readFileTool);
  globalPool.register(writeFileTool);

  const sessionId = `evolve_${Date.now()}`;

  const runner = createAgentLoopRunner({
    sessionId,
    tools: globalPool.all(),
    llmCaller: createMockLLMCaller(),
    enableBackgroundReview: false,
    permissionCtx: {
      alwaysAllowRules: ["write_skill", "read_skill", "discover_skills", "compress_trajectory", "read_file"],
      alwaysDenyRules: [],
      alwaysAskRules: ["self_modify", "rule_engine_override", "write_file"],
      mode: "interactive",
      source: "session",
    },
    askConfirmCallback: async (toolName) => {
      if (toolName === "self_modify") {
        console.log(`  [Agent Loop Ask Confirm] Auto-approving ${toolName} for demo.`);
        return true;
      }
      return false;
    },
  });

  const input = "evolve your agent loop by adding a visibility log at the start of each turn";

  console.log(`──────────────────────────────────────────────────────────────`);
  console.log(`User: ${input}`);
  console.log(`──────────────────────────────────────────────────────────────\n`);

  for await (const msg of runner.run(input)) {
    if ("role" in msg && msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
      console.log(`Assistant:\n${content}\n`);
    } else if ("type" in msg && msg.type === "tool_result") {
      console.log(`Tool Result [${msg.toolUseId}]:\n${msg.content}\n`);
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("VERIFICATION: Checking if agent-loop source was mutated");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const updatedSource = readFileSync("skills/agent-loop/index.ts", "utf-8");
  const mutated = updatedSource.includes("[Ouroboros Loop v2]");

  if (mutated) {
    console.log("✅ SUCCESS: The Agent Loop has modified its own source code.");
    console.log("   The ouroboros is eating its tail and growing a new one.\n");

    // Show the diff context in the real execution path (run method)
    const lines = updatedSource.split("\n");
    const idx = lines.findIndex((l) => l.includes("async *run(userInput)") && !l.includes("mock"));
    const runIdx = lines.findIndex((l, i) => i > idx && l.includes("[Ouroboros Loop v2]"));
    console.log("--- Changed execution path ---");
    for (let i = Math.max(0, runIdx - 1); i <= Math.min(lines.length - 1, runIdx + 1); i++) {
      console.log(` ${i + 1}: ${lines[i]}`);
    }
    console.log("-------------------------------\n");

    // Phase 2: verify the mutated loop actually runs with the new behavior
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("PHASE 2: Verify mutated loop produces the new log output");
    console.log("═══════════════════════════════════════════════════════════════\n");

    const { spawnSync } = await import("child_process");
    const result = spawnSync("npx", ["tsx", "-e", `
      import { createAgentLoopRunner, createMockLLMCaller } from "./skills/agent-loop/index.ts";
      import { createToolPool } from "./core/tool-framework.ts";
      const runner = createAgentLoopRunner({
        sessionId: "verify_${Date.now()}",
        tools: createToolPool().all(),
        llmCaller: createMockLLMCaller(),
      });
      (async () => {
        for await (const msg of runner.run("hello")) {
          if ("role" in msg && msg.role === "assistant") {
            console.log(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
          }
        }
      })();
    `], { cwd: process.cwd(), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

    const combined = (result.stdout || "") + (result.stderr || "");
    if (combined.includes("[Ouroboros Loop v2]")) {
      console.log("✅ VERIFIED: The mutated loop produces the new v2 log output.\n");
    } else {
      console.log("⚠️  The mutated loop did not produce v2 log in subprocess (may be cached).");
      console.log("   Subprocess output:\n" + combined.slice(0, 500) + "\n");
    }
  } else {
    console.log("❌ FAILURE: The Agent Loop source was not mutated.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
