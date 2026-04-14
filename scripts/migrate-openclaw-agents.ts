#!/usr/bin/env tsx
/**
 * Migrate OpenClaw Agent Sessions to Ouroboros SQLite
 * ===================================================
 * Scans ~/.openclaw-migrated/agents/ and imports all
 * .jsonl session files into the sessions / messages / trajectories tables.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import { getDb } from "../core/db-manager.ts";
import type { BaseMessage } from "../types/index.ts";

const AGENTS_ROOT = join(process.cwd(), ".openclaw-migrated", "agents");

interface OpenClawSessionEvent {
  type: "session";
  id: string;
  timestamp: string;
  cwd?: string;
}

interface OpenClawModelChangeEvent {
  type: "model_change";
  provider?: string;
  modelId?: string;
}

interface OpenClawMessageEvent {
  type: "message";
  timestamp?: string;
  message: {
    role: "user" | "assistant" | "toolResult";
    content?: string | unknown[];
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    name?: string;
  };
}

type OpenClawEvent = OpenClawSessionEvent | OpenClawModelChangeEvent | OpenClawMessageEvent | Record<string, unknown>;

function isSessionEvent(evt: unknown): evt is OpenClawSessionEvent {
  return typeof evt === "object" && evt !== null && (evt as Record<string, unknown>).type === "session";
}

function isModelChangeEvent(evt: unknown): evt is OpenClawModelChangeEvent {
  return typeof evt === "object" && evt !== null && (evt as Record<string, unknown>).type === "model_change";
}

function isMessageEvent(evt: unknown): evt is OpenClawMessageEvent {
  return typeof evt === "object" && evt !== null && (evt as Record<string, unknown>).type === "message";
}

function* walkJsonlFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(fullPath);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
      // Skip checkpoint files to avoid duplicate partial sessions
      if (entry.name.includes(".checkpoint.")) continue;
      yield fullPath;
    }
  }
}

function parseEvent(line: string): OpenClawEvent | null {
  try {
    return JSON.parse(line) as OpenClawEvent;
  } catch {
    return null;
  }
}

function convertToolCallBlock(block: unknown): { type: "tool_use"; id: string; name: string; input: unknown } | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as Record<string, unknown>;
  if (b.type !== "toolCall") return null;
  return {
    type: "tool_use",
    id: typeof b.id === "string" ? b.id : "",
    name: typeof b.name === "string" ? b.name : "",
    input: b.arguments,
  };
}

function convertMessage(evt: OpenClawMessageEvent): { msg: BaseMessage; toolCalls?: unknown[] } | null {
  const m = evt.message;
  if (!m) return null;

  const rawContent = m.content ?? "";

  if (m.role === "toolResult") {
    const msg: BaseMessage = {
      role: "tool_result",
      content: rawContent as string,
      name: m.toolName,
    };
    return { msg };
  }

  if (m.role === "assistant") {
    let content: BaseMessage["content"] = rawContent as string;
    const toolCalls: unknown[] = [];

    if (Array.isArray(rawContent)) {
      // Extract toolCall blocks and remap them to tool_use format
      const preservedBlocks: Record<string, unknown>[] = [];
      for (const block of rawContent) {
        const tc = convertToolCallBlock(block);
        if (tc) {
          toolCalls.push(tc);
        } else if (typeof block === "object" && block !== null) {
          preservedBlocks.push(block as Record<string, unknown>);
        }
      }
      content = preservedBlocks.length > 0 ? (preservedBlocks as BaseMessage["content"]) : "";
    }

    const msg: BaseMessage = {
      role: "assistant",
      content,
      name: m.name,
    };
    return { msg, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  // user
  const msg: BaseMessage = {
    role: "user",
    content: rawContent as string,
    name: m.name,
  };
  return { msg };
}

interface ParsedSession {
  sessionId: string;
  createdAt: number;
  title: string;
  model?: string;
  provider?: string;
  messages: { msg: BaseMessage; toolCalls?: unknown[] }[];
}

function parseSessionFile(filePath: string): ParsedSession | null {
  const stats = statSync(filePath);
  if (stats.size === 0) return null;

  let sessionId: string | undefined;
  let createdAt = Date.now();
  let model: string | undefined;
  let provider: string | undefined;
  const messages: { msg: BaseMessage; toolCalls?: unknown[] }[] = [];

  const lines = readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const evt = parseEvent(line);
    if (!evt) continue;

    if (isSessionEvent(evt)) {
      sessionId = evt.id;
      const ts = new Date(evt.timestamp).getTime();
      if (!isNaN(ts)) createdAt = ts;
    } else if (isModelChangeEvent(evt)) {
      if (!model && evt.modelId) model = evt.modelId;
      if (!provider && evt.provider) provider = evt.provider;
    } else if (isMessageEvent(evt)) {
      const converted = convertMessage(evt);
      if (converted) messages.push(converted);
    }
  }

  if (!sessionId) {
    // Fallback to filename stem if no session event found
    const stem = basename(filePath, ".jsonl");
    sessionId = stem;
  }

  const title = `Migrated ${basename(filePath)}`;
  return { sessionId, createdAt, title, model, provider, messages };
}

function main() {
  if (!existsSync(AGENTS_ROOT)) {
    console.error(`OpenClaw agents directory not found: ${AGENTS_ROOT}`);
    process.exit(1);
  }

  const files = Array.from(walkJsonlFiles(AGENTS_ROOT));
  console.log(`Found ${files.length} session files to migrate.`);

  if (files.length === 0) {
    console.log("Nothing to migrate.");
    process.exit(0);
  }

  const db = getDb();

  const insertSession = db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, model, provider, status, created_at, updated_at, message_count, turn_count)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  );

  const insertMessage = db.prepare(
    `INSERT INTO messages (session_id, role, content, name, tool_calls, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertTrajectory = db.prepare(
    `INSERT INTO trajectories (session_id, turn, entries, outcome, summary, compressed)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let filesProcessed = 0;
  let filesSkipped = 0;
  let totalMessages = 0;

  for (const filePath of files) {
    const parsed = parseSessionFile(filePath);
    if (!parsed) {
      console.log(`  Skipping empty or unreadable file: ${filePath}`);
      continue;
    }

    // Check if session already exists
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(parsed.sessionId) as { id: string } | undefined;
    if (existing) {
      filesSkipped++;
      continue;
    }

    const atomic = db.transaction(() => {
      insertSession.run(
        parsed.sessionId,
        parsed.title,
        parsed.model || "unknown",
        parsed.provider || null,
        parsed.createdAt,
        parsed.createdAt,
        parsed.messages.length,
        parsed.messages.length
      );

      for (const { msg, toolCalls } of parsed.messages) {
        const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const toolCallsStr = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
        insertMessage.run(parsed.sessionId, msg.role, contentStr, msg.name || null, toolCallsStr, parsed.createdAt);
      }

      if (parsed.messages.length > 0) {
        const entries = [
          {
            turn: 1,
            messages: parsed.messages.map((m) => m.msg),
            toolCalls: parsed.messages.flatMap((m) => m.toolCalls || []),
            outcome: "success",
          },
        ];
        insertTrajectory.run(
          parsed.sessionId,
          parsed.messages.length,
          JSON.stringify(entries),
          "success",
          null,
          0
        );
      }
    });

    try {
      atomic();
      filesProcessed++;
      totalMessages += parsed.messages.length;
      console.log(`  Migrated ${parsed.sessionId} (${parsed.messages.length} messages)`);
    } catch (err) {
      console.error(`  Failed to migrate ${filePath}:`, err);
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  Files processed: ${filesProcessed}`);
  console.log(`  Files skipped (already exist): ${filesSkipped}`);
  console.log(`  Total messages inserted: ${totalMessages}`);
}

main();
