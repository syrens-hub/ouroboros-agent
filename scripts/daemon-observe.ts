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

import { createAutonomousEvolutionDaemon } from "../skills/autonomous-evolution/index.ts";
import { createSession, appendMessage } from "../core/session-db.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     D A E M O N   O P E N   E N V I R O N M E N T            ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Starting autonomous evolution daemon with live logging...   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const hasLLM = !!(process.env.LLM_API_KEY && process.env.LLM_PROVIDER);
  console.log(`LLM Mode: ${hasLLM ? `${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL || "unknown"}` : "MOCK (set LLM_API_KEY for real brain)"}\n`);

  const daemon = createAutonomousEvolutionDaemon({
    intervalMs: 15000, // faster tick for demo observation
    autoApplyLowRisk: true,
    selfReviewEveryNTicks: 4,
    onDecision: (d) => {
      const ts = new Date().toISOString();
      console.log(`\n[${ts}] Decision: ${d.action.toUpperCase()}`);
      console.log(`  Session : ${d.sessionId}`);
      console.log(`  Skill   : ${d.skillName || "(none)"}`);
      console.log(`  Applied : ${d.applied}`);
      console.log(`  Reason  : ${d.reason}`);
      if (d.markdown) {
        console.log(`  Markdown preview:`);
        console.log(d.markdown.split("\n").slice(0, 6).join("\n"));
        console.log("  ...");
      }
    },
    onError: (e) => {
      console.error("\n[Daemon Error]", e.message);
    },
  });

  daemon.start();
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
    const stats = daemon.getStats();
    process.stdout.write(`\r[Ticks: ${stats.tickCount} | Reviewed: ${stats.reviewedSessions} | History: ${stats.historySize}] `);
  }, 5000);

  process.on("SIGINT", () => {
    console.log("\n\nStopping daemon...");
    clearInterval(statsInterval);
    daemon.stop();
    console.log("Final stats:", daemon.getStats());
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
