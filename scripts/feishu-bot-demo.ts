#!/usr/bin/env tsx
/**
 * Feishu Bot Demo
 * ================
 * Demonstrates a real IM integration with Feishu (Lark).
 *
 * Mode 1 - Simulation (no credentials):
 *   The demo injects a fake Feishu event and routes it through the full
 *   inbound → agent → outbound pipeline.
 *
 * Mode 2 - Live webhook (with credentials):
 *   Starts an HTTP server and waits for real events from Feishu Open Platform.
 *   Set FEISHU_APP_ID, FEISHU_APP_SECRET, and configure the event subscription
 *   URL to point to http://<your-host>:3000/feishu/webhook
 */

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
import { feishuPlugin, simulateFeishuMessage } from "../extensions/im/feishu/index.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import type { ChannelMessage } from "../types/index.ts";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║        F E I S H U   B O T   I N T E G R A T I O N   D E M O   ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Real IM nervous system: Feishu/Lark webhook + Open API.     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  const hasCredentials = !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);

  if (!hasCredentials) {
    console.log("⚠️  No Feishu credentials found (FEISHU_APP_ID / FEISHU_APP_SECRET).");
    console.log("   Running in SIMULATION mode. A fake Feishu event will be injected.\n");
  } else {
    console.log("✅ Feishu credentials detected. Running in LIVE webhook mode.\n");
    console.log(`   Webhook URL: http://localhost:${process.env.FEISHU_WEBHOOK_PORT || 3000}${process.env.FEISHU_WEBHOOK_PATH || "/feishu/webhook"}\n`);
    console.log("   Waiting for real events from Feishu Open Platform...\n");
  }

  // Conservative self-mod policy
  setSelfModifyConfirmCallback(async (req) => {
    console.log("\n[SELF-MODIFICATION REQUEST via Feishu]");
    console.log(`  Type: ${req.type} | Risk: ${req.estimatedRisk}`);
    return req.estimatedRisk === "low";
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

  // Setup IM nerve
  const inbound = feishuPlugin.inbound;
  const outbound = feishuPlugin.outbound;

  inbound.onMessage(async (msg: ChannelMessage) => {
    const skills = discoverSkills();
    const skillPrompts = skills.map((s) => `${s.name}: ${s.frontmatter.description}`);

    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`[Feishu INBOUND] ${msg.senderName}: ${msg.text}`);
    console.log(`  chatId: ${msg.channelId} | messageId: ${msg.threadId}`);
    console.log(`──────────────────────────────────────────────────────────────`);

    const sessionId = `feishu_${msg.channelId}_${msg.senderId}`;
    const runner = createAgentLoopRunner({
      sessionId,
      tools: globalPool.all(),
      llmCaller: createMockLLMCaller(),
      enableBackgroundReview: false,
      skillPrompts,
    });

    let replyText = "";
    for await (const event of runner.run(msg.text)) {
      if ("role" in event && event.role === "assistant") {
        replyText = typeof event.content === "string" ? event.content : "";
      }
    }

    if (replyText) {
      const result = await outbound.sendText(msg.channelId, replyText, {
        threadId: msg.threadId,
        mentionUsers: msg.isGroup ? [msg.senderId] : undefined,
      });
      if (!result.success) {
        console.error("[Feishu] Failed to send reply.");
      }
    }
  });

  // Start webhook server
  feishuPlugin.start();

  if (!hasCredentials) {
    // Simulation mode: inject a synthetic Feishu message
    await sleep(800);
    simulateFeishuMessage("你好，Ouroboros！请介绍一下你自己。", "demo_chat_1", "demo_user_1");
    await sleep(1500);

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("Feishu simulation demo complete.");
    console.log("═══════════════════════════════════════════════════════════════\n");
    feishuPlugin.stop();
    process.exit(0);
  } else {
    // Live mode: keep running until Ctrl+C
    console.log("Press Ctrl+C to stop the Feishu webhook server.\n");
    process.on("SIGINT", () => {
      console.log("\n[Feishu] Stopping webhook server...");
      feishuPlugin.stop();
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  feishuPlugin.stop();
  process.exit(1);
});
