#!/usr/bin/env node
/**
 * Ouroboros Agent
 * ===============
 * Entry point that assembles the three-lineage super-agent.
 */

import "dotenv/config";
import * as Sentry from "@sentry/node";
import { appConfig } from "./core/config.ts";
import { join, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { createToolPool } from "./core/tool-framework.ts";
import { setSelfModifyConfirmCallback } from "./skills/self-modify/index.ts";
import {
  compressTrajectoryTool,
  discoverSkillsTool,
  writeSkillTool,
  readSkillTool,
  listSkillVersionsTool,
  restoreSkillVersionTool,
  pruneSkillVersionsTool,
} from "./skills/learning/index.ts";
import { selfModifyTool, ruleEngineOverrideTool } from "./skills/self-modify/index.ts";
import { agentLoopTool, createAgentLoopRunner, createMockLLMCaller } from "./skills/agent-loop/index.ts";
import { createSessionArchiver } from "./skills/session-archiver/index.ts";
import { createCheckpoint } from "./skills/checkpoint/index.ts";
import { META_RULE_AXIOM } from "./core/rule-engine.ts";
import { getMessages, getSession, getTrajectories, getSkillRegistry } from "./core/session-db.ts";
import { maybeAutoBackup } from "./skills/backup/index.ts";
import type { LLMConfig } from "./core/llm-router.ts";

// 全局定时器引用
let backupTimer: NodeJS.Timeout | undefined;
let runnerInstance: ReturnType<typeof createAgentLoopRunner> | undefined;

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
    if (process.env.OUROBOROS_DEMO_MODE !== "1") {
      console.log("\n[SELF-MODIFICATION REQUEST DENIED]");
      console.log("  Self-modification is disabled by default for safety.");
      console.log("  Set OUROBOROS_DEMO_MODE=1 to enable the interactive demo mode.\n");
      return false;
    }

    console.log("\n[SELF-MODIFICATION REQUEST]");
    console.log(`  Type: ${req.type}`);
    console.log(`  Risk: ${req.estimatedRisk}`);
    console.log(`  Rationale: ${req.rationale}`);
    console.log(`  Description: ${req.description}`);

    // In demo mode, still deny high/critical risk modifications
    if (req.estimatedRisk === "high" || req.estimatedRisk === "critical") {
      console.log("  Denied in demo mode (high/critical requires real prompt).\n");
      return false;
    }

    console.log("  Approved in demo mode (low/medium risk).\n");
    return true;
  });

  // Assemble the global tool pool
  const globalPool = createToolPool();
  globalPool.register(compressTrajectoryTool);
  globalPool.register(discoverSkillsTool);
  globalPool.register(writeSkillTool);
  globalPool.register(readSkillTool);
  globalPool.register(listSkillVersionsTool);
  globalPool.register(restoreSkillVersionTool);
  globalPool.register(pruneSkillVersionsTool);
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

  // Schedule daily auto-backup - 保存引用以便清理
  const backupTimer = setInterval(() => maybeAutoBackup(), 24 * 60 * 60 * 1000);
  backupTimer.unref(); // 防止阻止进程退出
  maybeAutoBackup().catch((e) => {
    // Intentionally non-fatal: auto-backup failure should not block startup
    console.error("Auto-backup failed during startup:", e);
  });

  const sessionId = `session_${Date.now()}`;

  // Create the agent loop runner
  const loopConfig = {
    max_iterations: 100,
    checkpoint_interval: 5,
    enable_pause: true,
    enable_resume: true,
  };
  const runner = createAgentLoopRunner({
    loopConfig,
    sessionId,
    tools: globalPool.all(),
    llm: llmCfg,
    llmCaller,
    enableBackgroundReview: !!llmCfg,
  });
  runnerInstance = runner;

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

  // 1. 保存循环状态快照
  if (runnerInstance) {
    try {
      const snapshot = runnerInstance.exportState();
      const snapshotPath = join(process.cwd(), ".ouroboros", `loop-snapshot-${snapshot.sessionId}.json`);
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
      console.log(`Loop state snapshot saved: ${snapshotPath}`);
    } catch (e) {
      console.error("Failed to save loop state snapshot:", e);
    }

    // 2. 保存最终 checkpoint
    try {
      const cp = createCheckpoint(process.cwd(), runnerInstance.getState().sessionId);
      if (cp.success) {
        console.log(`Final checkpoint created: ${cp.data.id}`);
      }
    } catch (e) {
      console.error("Failed to create final checkpoint:", e);
    }
  }

  // 3. 触发 Session 归档
  try {
    const archiver = createSessionArchiver({ archive_path: join(process.cwd(), ".ouroboros", "archive") });
    const stats = await archiver.run();
    console.log(`Session archiver stats: hot=${stats.hotSessions}, warm=${stats.warmSessions}, cold=${stats.coldSessions}, archived=${stats.archivedCount}, cleaned=${stats.cleanedCount}`);
  } catch (e) {
    console.error("Session archiver failed:", e);
  }

  // 4. 清理定时器
  if (typeof backupTimer !== 'undefined') {
    clearInterval(backupTimer);
  }

  console.log("Resource cleanup confirmed. Goodbye!\n");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// =============================================================================
// Sentry initialization
// =============================================================================

function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn("[Sentry] SENTRY_DSN not set — error tracking disabled.");
    return;
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
  });
  console.log("[Sentry] Initialized.");
}

// =============================================================================
// Global exception handlers
// =============================================================================

if (appConfig.sentry.dsn) {
  initSentry();
}

process.on("uncaughtException", (err) => {
  console.error("FATAL: Uncaught exception:", err);
  Sentry.captureException(err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("FATAL: Unhandled rejection:", reason);
  Sentry.captureException(reason);
});

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
