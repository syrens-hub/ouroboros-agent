#!/usr/bin/env tsx
/**
 * Test Background Review Agent with Real LLM
 * ===========================================
 * This script verifies that the Hermes-style background review agent
 * works when connected to a real LLM endpoint.
 */

import "dotenv/config";
import { createToolPool } from "../core/tool-framework.ts";
import { writeSkillTool, readSkillTool, discoverSkillsTool } from "../skills/learning/index.ts";
import { createAgentLoopRunner } from "../skills/agent-loop/index.ts";
import { runBackgroundReview } from "../skills/learning/review-agent.ts";
import type { LLMConfig } from "../core/llm-router.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  T E S T :  B A C K G R O U N D   R E V I E W   A G E N T   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const provider = (process.env.LLM_PROVIDER || "local") as LLMConfig["provider"];
  const model = process.env.LLM_MODEL || "mock";
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey || provider === "local") {
    console.log("ℹ️  No real LLM API key configured.");
    console.log("   To test background review with a real model, please:\n");
    console.log("   1. cp .env.example .env");
    console.log("   2. Edit .env and set LLM_PROVIDER and LLM_API_KEY");
    console.log("   3. Run this script again.\n");
    process.exit(0);
  }

  const llmCfg: LLMConfig = {
    provider,
    model,
    apiKey,
    baseUrl: process.env.LLM_BASE_URL,
    temperature: 0.2,
    maxTokens: 512,
  };

  console.log(`Using LLM: ${provider} / ${model}\n`);

  // Minimal tool pool for a simple conversation
  const pool = createToolPool();
  pool.register(writeSkillTool);
  pool.register(readSkillTool);
  pool.register(discoverSkillsTool);

  const sessionId = `review_test_${Date.now()}`;
  const runner = createAgentLoopRunner({
    sessionId,
    tools: pool.all(),
    llm: llmCfg,
    enableBackgroundReview: false, // we will trigger it manually below
  });

  const input = "Remember that when I say 'deploy', I mean pushing to staging first.";
  console.log(`User: ${input}\n`);

  for await (const msg of runner.run(input)) {
    if ("role" in msg && msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : "";
      console.log(`Assistant: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}\n`);
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("Triggering background review agent...\n");

  const reviewResult = await runBackgroundReview(sessionId, llmCfg, {
    autoApplyLowRisk: true,
  });

  if (reviewResult.success) {
    const decision = reviewResult.data;
    console.log("Review Decision:");
    console.log(`  Action : ${decision.action}`);
    console.log(`  Skill  : ${decision.skillName || "(none)"}`);
    console.log(`  Desc   : ${decision.description || "(none)"}`);
    if (decision.markdown) {
      console.log(`  Markdown preview:\n${decision.markdown.slice(0, 300)}...\n`);
    }
  } else {
    console.error("Review failed:", reviewResult.error);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
