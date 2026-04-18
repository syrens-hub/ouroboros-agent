#!/usr/bin/env tsx
/**
 * Daemon Open-Environment Observer
 * ================================
 * Starts the Autonomous Evolution Daemon and prints a live decision log.
 *
 * Usage:
 *   1. Configure real LLM in .env (optional; works in mock mode too)
 *   2. tsx scripts/daemon-observe.ts
 *   3. Interact with the agent via Web UI or CLI to create sessions
 *   4. Watch the daemon review sessions and propose skills in real-time
 */

import { autonomousEvolutionLoop } from "../skills/autonomous-evolution/index.ts";
import { createSession, appendMessage } from "../core/session-db.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     D A E M O N   O P E N   E N V I R O N M E N T            ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Starting autonomous evolution daemon with live logging...   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const hasLLM = !!(process.env.LLM_API_KEY && process.env.LLM_PROVIDER);
  console.log(`LLM Mode: ${hasLLM ? `${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL || "unknown"}` : "MOCK (set LLM_API_KEY for real brain)"}\n`);

  autonomousEvolutionLoop.start();
  console.log("Autonomous evolution loop started. Press Ctrl+C to stop.\n");
  console.log("Daemon started. Press Ctrl+C to stop.\n");

  // Seed a demo session so there's something to review immediately
  const demoSessionId = `observe_${Date.now()}`;
  await createSession(demoSessionId, { title: "Daemon Observation Demo" });
  await appendMessage(demoSessionId, {
    role: "user",
    content: "Remember: always answer coding questions with Python examples.",
  });
  await appendMessage(demoSessionId, {
    role: "assistant",
    content: "Got it. I'll include Python examples whenever you ask about code.",
  });
  console.log(`Seeded demo session: ${demoSessionId}\n`);

  // Live stats loop
  const statsInterval = setInterval(() => {
    const state = autonomousEvolutionLoop.getState();
    process.stdout.write(`\r[Cycles: ${state.totalCycles} | Proposals: ${state.totalProposals} | Executed: ${state.totalExecuted} | Status: ${state.status}] `);
  }, 5000);

  process.on("SIGINT", () => {
    console.log("\n\nStopping autonomous loop...");
    clearInterval(statsInterval);
    autonomousEvolutionLoop.stop();
    console.log("Final state:", autonomousEvolutionLoop.getState());
    console.log("Goodbye.\n");
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
