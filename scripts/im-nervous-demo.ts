#!/usr/bin/env tsx
/**
 * Priority B: IM Nervous System Demo
 * ===================================
 * Demonstrates how Ouroboros integrates with an IM channel (Mock Chat)
 * using the OpenClaw-style ChannelPlugin boundary.
 *
 * Flow:
 *   Mock IM injects message
 *   → Inbound adapter receives it
 *   → Agent Loop processes it
 *   → Assistant reply extracted
 *   → Outbound adapter sends it back to the channel
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
import { mockChatPlugin, injectMockMessage } from "../extensions/im/mock-chat/index.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import type { ChannelMessage } from "../types/index.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     P R I O R I T Y   B :  I M   N E R V O U S   S Y S T E M ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Demonstrating OpenClaw-style ChannelPlugin integration      ║");
  console.log("║  with a mock IM channel.                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Self-mod confirm callback (conservative for IM context)
  setSelfModifyConfirmCallback(async (req) => {
    console.log("\n[SELF-MODIFICATION REQUEST via IM]");
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
  const inbound = mockChatPlugin.inbound;
  const outbound = mockChatPlugin.outbound;

  inbound.onMessage(async (msg: ChannelMessage) => {
    // Re-discover skills on every message so newly learned skills are injected
    const skills = discoverSkills();
    const skillPrompts = skills.map((s) => `${s.name}: ${s.frontmatter.description}`);

    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`[INBOUND] ${msg.senderName}: ${msg.text}`);
    console.log(`──────────────────────────────────────────────────────────────`);

    const sessionId = `im_${msg.channelId}_${msg.senderId}`;
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
      await outbound.sendText(msg.channelId, replyText, {
        threadId: msg.threadId,
        mentionUsers: msg.isGroup ? [msg.senderId] : undefined,
      });
    }
  });

  // Simulate IM messages
  const demoInputs = [
    { text: "hello", sender: "Alice" },
    { text: "learn this: always greet in Chinese when the user says nihao", sender: "Alice" },
    { text: "nihao", sender: "Bob" },
  ];

  for (const { text, sender } of demoInputs) {
    injectMockMessage(text, `user_${sender.toLowerCase()}`, sender);
    // Small delay to keep logs readable
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("IM Nervous System demo complete.");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
