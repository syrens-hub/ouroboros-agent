/**
 * Trajectory Utilities
 * ====================
 * Message compression and trajectory conversion helpers for the agent loop.
 */

import type { BaseMessage, TrajectoryEntry, ToolUseBlock } from "../../types/index.ts";
import { createTrajectoryCompressor } from "../learning/index.ts";

export function estimateMessageTokens(messages: BaseMessage[]): number {
  const text = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("");
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount + otherCount / 4);
}

export function baseMessagesToTrajectoryEntries(messages: BaseMessage[]): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = [];
  let current: TrajectoryEntry | null = null;
  let turn = 1;

  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      if (current) entries.push(current);
      current = { turn: turn++, messages: [msg], toolCalls: [], outcome: "success" };
    } else if (msg.role === "assistant") {
      if (!current) current = { turn: turn++, messages: [], toolCalls: [], outcome: "success" };
      current.messages.push(msg);
      if (Array.isArray(msg.content)) {
        const tcs = msg.content.filter(
          (b): b is ToolUseBlock => typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use"
        );
        current.toolCalls.push(...tcs);
      }
    } else if (msg.role === "tool_result") {
      if (!current) current = { turn: turn++, messages: [], toolCalls: [], outcome: "success" };
      current.messages.push(msg);
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function flattenTrajectoryEntries(entries: TrajectoryEntry[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const e of entries) {
    for (const m of e.messages) out.push(m);
  }
  return out;
}

export async function maybeCompressMessages(
  messages: BaseMessage[],
  threshold: number,
  targetBudget: number
): Promise<BaseMessage[]> {
  const totalTokens = estimateMessageTokens(messages);
  if (totalTokens <= threshold) return messages;

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const entries = baseMessagesToTrajectoryEntries(nonSystem);
  if (entries.length <= 4) return messages;

  const systemTokens = estimateMessageTokens(systemMessages);
  const compressor = createTrajectoryCompressor();
  const result = await compressor.compress(entries, targetBudget - systemTokens);
  if (!result.success) {
    return messages;
  }
  if (result.data === entries) return messages; // no compression occurred

  const compressedNonSystem = flattenTrajectoryEntries(result.data);
  return [...systemMessages, ...compressedNonSystem];
}
