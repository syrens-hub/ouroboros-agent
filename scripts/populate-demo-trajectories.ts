#!/usr/bin/env tsx
/**
 * Populate Demo Trajectories
 * ===========================
 * Generates synthetic trajectory records from existing session messages
 * so that the export pipeline has something to process.
 */

import Database from "better-sqlite3";
import { join } from "path";
import { saveTrajectory } from "../core/session-db.ts";
import type { BaseMessage, TrajectoryEntry } from "../types/index.ts";

const DB_PATH = join(process.cwd(), ".ouroboros", "session.db");

async function main() {
  console.log("Populating demo trajectories from existing sessions...\n");

  const db = new Database(DB_PATH);
  const sessions = db.prepare("SELECT id FROM sessions").all() as { id: string }[];

  let populated = 0;
  for (const { id } of sessions) {
    const msgs = db
      .prepare("SELECT role, content, name FROM messages WHERE session_id = ? ORDER BY id ASC")
      .all(id) as { role: string; content: string; name?: string }[];

    if (msgs.length < 3) continue;

    // Build a simple trajectory from messages
    const entries: TrajectoryEntry[] = [];
    let turn = 0;
    for (let i = 0; i < msgs.length; ) {
      const turnMessages: BaseMessage[] = [];
      // Consume user message
      if (msgs[i].role === "user") {
        turnMessages.push({ role: "user", content: msgs[i].content });
        i++;
      }
      // Consume assistant + tool_results until next user
      while (i < msgs.length && msgs[i].role !== "user") {
        turnMessages.push({
          role: msgs[i].role as import("../types/index.ts").MessageRole,
          content: msgs[i].content,
          name: msgs[i].name,
        });
        i++;
      }
      entries.push({
        turn: turn++,
        messages: turnMessages,
        toolCalls: [],
        outcome: turnMessages.some((m) => m.role === "tool_result") ? "success" : "success",
      });
    }

    const result = await saveTrajectory(id, entries, "success", undefined, false);
    if (result.success) populated++;
  }

  const total = db.prepare("SELECT COUNT(*) as c FROM trajectories").get() as { c: number };
  console.log(`✅ Populated ${populated} session trajectories.`);
  console.log(`Total trajectory rows in DB: ${total.c}\n`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
