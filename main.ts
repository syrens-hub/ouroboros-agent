#!/usr/bin/env node
/**
 * Ouroboros Agent
 * ===============
 * Entry point that assembles the three-lineage super-agent.
 */

import "dotenv/config";
import { createToolPool } from "./core/tool-framework.ts";
import { setSelfModifyConfirmCallback } from "./skills/self-modify/index.ts";
import {
  compressTrajectoryTool,
  discoverSkillsTool,
  writeSkillTool,
  readSkillTool,
} from "./skills/learning/index.ts";
import { selfModifyTool, ruleEngineOverrideTool } from "./skills/self-modify/index.ts";
import { agentLoopTool, createAgentLoopRunner, createMockLLMCaller } from "./skills/agent-loop/index.ts";
import { META_RULE_AXIOM } from "./core/rule-engine.ts";
import { getMessages, getSession, getTrajectories, getSkillRegistry } from "./core/session-db.ts";
import { maybeAutoBackup } from "./core/backup.ts";
import type { LLMConfig } from "./core/llm-router.ts";

// =============================================================================
// Bootstrap
// =============================================================================

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                 O U R O B O R O S   A G E N T                ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Skeleton: Claude Code  │  Blood: Hermes  │  Nerves: OpenClaw ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Register human-confirmation callback for self-modification
  setSelfModifyConfirmCallback(async (req) => {
    console.log("\n[SELF-MODIFICATION REQUEST]");
    console.log(`  Type: ${req.type}`);
    console.log(`  Risk: ${req.estimatedRisk}`);
    console.log(`  Rationale: ${req.rationale}`);
    console.log(`  Description: ${req.description}`);
    if (req.estimatedRisk === "low" || req.estimatedRisk === "medium") {
      console.log("  Auto-approved (low/medium risk demo mode).\n");
      return true;
    }
    console.log("  Denied in demo mode (high/critical requires real prompt).\n");
    return false;
  });

  // Assemble the global tool pool
  const globalPool = createToolPool();
  globalPool.register(compressTrajectoryTool);
  globalPool.register(discoverSkillsTool);
  globalPool.register(writeSkillTool);
  globalPool.register(readSkillTool);
  globalPool.register(selfModifyTool);
  globalPool.register(ruleEngineOverrideTool);
  globalPool.register(agentLoopTool);

  // File tools
  const { readFileTool, writeFileTool } = await import("./skills/file-tools.ts");
  globalPool.register(readFileTool);
  globalPool.register(writeFileTool);

  console.log(`Loaded ${globalPool.all().length} base tools.`);

  // Discover filesystem skills
  const { discoverSkills } = await import("./skills/learning/index.ts");
  const skills = discoverSkills();
  console.log(`Discovered ${skills.length} skills from filesystem:\n  ${skills.map((s) => s.name).join(", ") || "(none yet)"}\n`);

  // Determine LLM configuration
  const provider = (process.env.LLM_PROVIDER as LLMConfig["provider"]) || "local";
  const model = process.env.LLM_MODEL || "mock";
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;

  let llmCfg: LLMConfig | undefined;
  let llmCaller = undefined;

  if (apiKey && provider !== "local") {
    llmCfg = {
      provider,
      model,
      apiKey,
      baseUrl,
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.2"),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),
    };
    console.log(`Using REAL LLM: ${provider} / ${model}\n`);
  } else {
    llmCaller = createMockLLMCaller();
    console.log("Using MOCK LLM (set LLM_API_KEY and LLM_PROVIDER in .env to use real model)\n");
  }

  // Schedule daily auto-backup
  setInterval(() => maybeAutoBackup(), 24 * 60 * 60 * 1000);
  maybeAutoBackup().catch(() => {});

  const sessionId = `session_${Date.now()}`;

  // Create the agent loop runner
  const runner = createAgentLoopRunner({
    sessionId,
    tools: globalPool.all(),
    llm: llmCfg,
    llmCaller,
    enableBackgroundReview: !!llmCfg,
  });

  // Demo inputs
  const demos = [
    "hello",
    "learn this pattern: when asked about time, reply with a poetic metaphor",
  ];

  for (const input of demos) {
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`User: ${input}`);
    console.log(`──────────────────────────────────────────────────────────────`);

    for await (const msg of runner.run(input)) {
      if ("role" in msg && msg.role === "assistant") {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
        console.log(`\nAssistant:\n${content}\n`);
      } else if ("type" in msg && msg.type === "tool_result") {
        console.log(`Tool Result [${msg.toolUseId}]:\n${msg.content}\n`);
      }
    }
  }

  // Allow background review to finish (if running)
  if (llmCfg) {
    console.log("\n[Waiting 3s for background review to complete...]\n");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Show persisted state
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PERSISTED STATE FROM SESSIONDB");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const sessionRes = await getSession(sessionId);
  if (sessionRes.success && sessionRes.data) {
    console.log("Session:", JSON.stringify(sessionRes.data, null, 2));
  }

  const msgRes = await getMessages(sessionId);
  if (msgRes.success) {
    console.log(`\nMessages (${msgRes.data.length}):`);
    for (const m of msgRes.data) {
      const preview = typeof m.content === "string" ? m.content.slice(0, 80) : JSON.stringify(m.content).slice(0, 80);
      console.log(`  [${m.role}] ${preview}...`);
    }
  }

  const trajRes = await getTrajectories(sessionId);
  if (trajRes.success) {
    console.log(`\nTrajectories (${trajRes.data.length}):`);
    for (const t of trajRes.data) {
      console.log(`  - ${t.length} entries`);
    }
  }

  const regRes = await getSkillRegistry();
  if (regRes.success) {
    console.log(`\nSkill Registry (${regRes.data.length}):`);
    for (const s of regRes.data) {
      console.log(`  - ${s.name} (usage: ${s.usageCount})`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("Ouroboros demo complete.");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
