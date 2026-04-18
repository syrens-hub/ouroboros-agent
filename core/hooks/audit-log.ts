/**
 * Built-in Audit Log Hook
 * ========================
 * Appends a lightweight audit entry for every completed agent turn.
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { HookEventType, HookContext } from "../hook-system.ts";

const AUDIT_PATH = join(process.cwd(), ".ouroboros", "audit.jsonl");

export async function handle(event: HookEventType, context: HookContext): Promise<void> {
  if (event !== "agent:turnEnd") return;
  const entry = {
    timestamp: Date.now(),
    event,
    sessionId: context.sessionId,
    turn: context.turn,
  };
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // fail-open
  }
}
