/**
 * Trajectory Export Utilities
 * ===========================
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { appConfig } from "../../../core/config.ts";
import { createTrajectoryCompressor } from "../../../skills/learning/index.ts";
import type { TrajectoryEntry } from "../../../types/index.ts";
import { safeJsonParse } from "../../../core/safe-utils.ts";

export const DB_PATH = join(appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir), "session.db");
export const OUT_DIR = join(process.cwd(), ".ouroboros");
export const OUT_PATH = join(OUT_DIR, "trajectories.jsonl");

export interface ShareGPTConversation {
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

export async function exportTrajectories(): Promise<{ count: number; path: string }> {
  if (!existsSync(DB_PATH)) {
    throw new Error("Database not found");
  }
  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT session_id, entries, outcome, compressed FROM trajectories").all() as {
    session_id: string;
    entries: string;
    outcome: string;
    compressed: number;
  }[];

  const compressor = createTrajectoryCompressor();
  const exported: ShareGPTConversation[] = [];

  for (const row of rows) {
    let entries = safeJsonParse<TrajectoryEntry[]>(row.entries, "trajectory entries") ?? [];
    const tokenEstimate = JSON.stringify(entries).length / 4;
    if (tokenEstimate > 4000) {
      const compressed = await compressor.compress(entries, 4000);
      if (compressed.success) {
        entries = compressed.data;
      }
    }
    exported.push(formatAsShareGPT(row.session_id, entries, row.compressed === 1));
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const lines = exported.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(OUT_PATH, lines + "\n", "utf-8");
  return { count: exported.length, path: OUT_PATH };
}
