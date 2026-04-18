/**
 * Prompt Injection Defense
 * ========================
 * Shared utilities for sanitizing user input before sending to LLMs.
 */

import type { BaseMessage } from "../types/index.ts";

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all\s+prior|above|earlier)\s+instructions?/i,
  /disregard\s+(previous|all\s+prior|above|earlier)\s+instructions?/i,
  /system\s+override/i,
  /you\s+are\s+now/i,
  /developer\s+mode/i,
  /new\s+instructions?/i,
  /do\s+not\s+(tell|inform|let|allow)\s+(user|them|anyone)/i,
  /\u2028|\u2029/, // unicode line separator injection
  /角色扮演|系统设定|忽略之前|忽略以上|绕过限制|解除限制|你是现在的|新的指示|开发模式/i, // Chinese prompt injection
];

const BASE64_PATTERN = /[A-Za-z0-9+/]{20,}={0,2}/g;
const _URLENCODE_PATTERN = /(?:%[0-9A-Fa-f]{2}){2,}/g;

function containsInjection(content: string): boolean {
  if (content.includes("\0")) return true; // null byte injection
  return INJECTION_PATTERNS.some((p) => p.test(content));
}

function tryDecodeBase64(segment: string): string | null {
  try {
    const decoded = Buffer.from(segment, "base64").toString("utf-8");
    if (decoded.length > 0 && decoded.length < segment.length) return decoded;
  } catch {
    // Intentional fail-closed: decoding failure means no hidden payload detected.
  }
  return null;
}

function tryDecodeUrlEncoded(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded !== segment && decoded.length > 0) return decoded;
  } catch {
    // Intentional fail-closed: malformed URI means no hidden payload detected.
  }
  return null;
}

function scanForEncodedInjection(content: string): boolean {
  // Whole-string URL decode check
  try {
    const decoded = decodeURIComponent(content);
    if (decoded !== content && containsInjection(decoded)) return true;
  } catch {
    // Intentional fail-closed: malformed URI means no hidden payload detected.
  }

  for (const match of content.matchAll(BASE64_PATTERN)) {
    const decoded = tryDecodeBase64(match[0]);
    if (decoded && containsInjection(decoded)) return true;
  }

  // Extract individual URL-encoded segments
  const urlSegments = content.match(/(?:%[0-9A-Fa-f]{2})+/g) || [];
  for (const segment of urlSegments) {
    const decoded = tryDecodeUrlEncoded(segment);
    if (decoded && containsInjection(decoded)) return true;
  }
  return false;
}

function containsSystemPromptInCodeBlocks(content: string): boolean {
  // Detect system prompt instructions hidden inside markdown code blocks
  const codeBlockPattern = /```[\s\S]*?```/g;
  for (const block of content.matchAll(codeBlockPattern)) {
    const inner = block[0].replace(/```/g, "").trim();
    if (/system\s*:\s*you\s+are/i.test(inner) || /you\s+are\s+an?\s+ai\s+assistant/i.test(inner)) {
      return true;
    }
  }
  return false;
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
  const suspicious = containsInjection(content) || scanForEncodedInjection(content) || containsSystemPromptInCodeBlocks(content);
  if (suspicious) {
    content = `[⚠️ SUSPICIOUS INPUT DETECTED] "${content}"`;
  }
  return { ...msg, content };
}

export function sanitizeUserInput(text: string): string {
  const escaped = escapeMetaDelimiters(text);
  const suspicious = containsInjection(escaped) || scanForEncodedInjection(escaped) || containsSystemPromptInCodeBlocks(escaped);
  if (suspicious) {
    return `[USER INPUT START]\n${escaped}\n[USER INPUT END]`;
  }
  return escaped;
}

/**
 * Sanitize file content before injecting it into a prompt.
 * Useful when reading files, web pages, or documents that may contain adversarial instructions.
 */
export function sanitizeFileContentForPrompt(fileContent: string, sourceHint = "file"): string {
  const suspicious = containsInjection(fileContent) || scanForEncodedInjection(fileContent) || containsSystemPromptInCodeBlocks(fileContent);
  if (suspicious) {
    return `[⚠️ SUSPICIOUS CONTENT IN ${sourceHint.toUpperCase()}]\n${fileContent}\n[END OF ${sourceHint.toUpperCase()}]`;
  }
  return fileContent;
}
