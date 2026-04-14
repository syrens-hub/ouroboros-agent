#!/usr/bin/env tsx
/**
 * Priority D: Trajectory Training Pipeline
 * ==========================================
 * Exports trajectories from SessionDB into a ShareGPT-style JSONL
 * suitable for fine-tuning or distillation.
 *
 * Pipeline:
 *   1. Read all trajectories from SQLite
 *   2. Optionally compress them via trajectory_compressor
 *   3. Format as ShareGPT conversations
 *   4. Write to .ouroboros/trajectories.jsonl
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { createTrajectoryCompressor } from "../skills/learning/index.ts";
import type { TrajectoryEntry } from "../types/index.ts";

const DB_PATH = join(process.cwd(), ".ouroboros", "session.db");
const OUT_DIR = join(process.cwd(), ".ouroboros");
const OUT_PATH = join(OUT_DIR, "trajectories.jsonl");

interface ShareGPTConversation {
  id: string;
  conversations: { from: "system" | "human" | "gpt"; value: string; tool_calls?: unknown[] }[];
  metadata: {
    session_id: string;
    outcome: string;
    compressed: boolean;
    turn_count: number;
  };
}

function formatAsShareGPT(sessionId: string, entries: TrajectoryEntry[], compressed: boolean): ShareGPTConversation {
  const conversations: ShareGPTConversation["conversations"] = [];

  for (const entry of entries) {
    for (const msg of entry.messages) {
      const role = msg.role;
      const from = role === "system" ? "system" : role === "user" ? "human" : role === "assistant" ? "gpt" : "human";
      const value = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      conversations.push({ from, value });
    }
  }

  return {
    id: `traj_${sessionId}_${Date.now()}`,
    conversations,
    metadata: {
      session_id: sessionId,
      outcome: entries[entries.length - 1]?.outcome || "unknown",
      compressed,
      turn_count: entries.length,
    },
  };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  P R I O R I T Y   D :  T R A J E C T O R Y   E X P O R T    ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Export SessionDB trajectories → ShareGPT JSONL for training ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!existsSync(DB_PATH)) {
    console.error("❌ Database not found:", DB_PATH);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT session_id, entries, outcome, compressed FROM trajectories").all() as {
    session_id: string;
    entries: string;
    outcome: string;
    compressed: number;
  }[];

  console.log(`Found ${rows.length} trajectory records in database.`);

  if (rows.length === 0) {
    console.log("ℹ️  No trajectories to export. Run some agent sessions first.\n");
    process.exit(0);
  }

  const compressor = createTrajectoryCompressor();
  const exported: ShareGPTConversation[] = [];

  for (const row of rows) {
    let entries: TrajectoryEntry[] = JSON.parse(row.entries);

    // Optionally compress if large
    const tokenEstimate = JSON.stringify(entries).length / 4;
    if (tokenEstimate > 4000) {
      const compressed = await compressor.compress(entries, 4000);
      if (compressed.success) {
        entries = compressed.data;
      }
    }

    const conv = formatAsShareGPT(row.session_id, entries, row.compressed === 1);
    exported.push(conv);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const lines = exported.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(OUT_PATH, lines + "\n", "utf-8");

  console.log(`✅ Exported ${exported.length} conversations to ${OUT_PATH}\n`);

  // Show sample
  const sample = exported[0];
  console.log("--- Sample Export ---");
  console.log(JSON.stringify(sample, null, 2));
  console.log("---------------------\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
