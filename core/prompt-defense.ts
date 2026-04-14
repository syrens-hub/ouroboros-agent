/**
 * Prompt Injection Defense
 * ========================
 * Shared utilities for sanitizing user input before sending to LLMs.
 */

import type { BaseMessage } from "../types/index.ts";

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all\s+prior)\s+instructions/i,
  /system\s+override/i,
  /you\s+are\s+now/i,
  /\u2028|\u2029/, // unicode line separator injection
  /角色扮演|系统设定|忽略之前|忽略以上|绕过限制|解除限制/i, // Chinese prompt injection
];

function containsInjection(content: string): boolean {
  if (content.includes("\0")) return true; // null byte injection
  return INJECTION_PATTERNS.some((p) => p.test(content));
}

export function escapeMetaDelimiters(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      if (line.trim() === "---") return "\\" + "---";
      if (line.trim() === "<<<") return "\\" + "<<<";
      if (line.trim() === ">>>") return "\\" + ">>>";
      return line;
    })
    .join("\n");
}

export function sanitizeMessageForLLM(msg: BaseMessage): BaseMessage {
  if (msg.role !== "user" && msg.role !== "tool_result") return msg;
  const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  let content = escapeMetaDelimiters(raw);
  if (containsInjection(content)) {
    content = `[⚠️ SUSPICIOUS INPUT DETECTED] "${content}"`;
  }
  return { ...msg, content };
}

export function sanitizeUserInput(text: string): string {
  const escaped = escapeMetaDelimiters(text);
  if (containsInjection(escaped)) {
    return `[USER INPUT START]\n${escaped}\n[USER INPUT END]`;
  }
  return escaped;
}
