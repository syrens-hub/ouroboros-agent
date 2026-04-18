/**
 * MCP Output Storage
 * ==================
 * Persist large/binary MCP outputs to disk so they don't bloat the context window.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";

const LARGE_OUTPUT_THRESHOLD_CHARS = 50_000;

function getBaseDir(): string {
  const dir = appConfig.db.dir.startsWith("/")
    ? appConfig.db.dir
    : join(process.cwd(), appConfig.db.dir);
  return join(dir, "mcp-outputs");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function guessExtension(content: unknown): string {
  if (typeof content === "string") {
    if (content.startsWith("data:image/png;base64,")) return "png";
    if (content.startsWith("data:image/jpeg;base64,")) return "jpg";
    if (content.startsWith("data:application/pdf;base64,")) return "pdf";
    return "txt";
  }
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (c.mimeType) {
      const mt = String(c.mimeType);
      if (mt.includes("png")) return "png";
      if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
      if (mt.includes("pdf")) return "pdf";
      if (mt.includes("json")) return "json";
    }
  }
  return "bin";
}

function estimateSize(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content && typeof content === "object") return JSON.stringify(content).length;
  return 0;
}

export function getMcpOutputPath(sessionId: string, toolUseId: string, content: unknown): string {
  const base = getBaseDir();
  const sessionDir = join(base, sanitizeFilename(sessionId));
  const ext = guessExtension(content);
  return join(sessionDir, `${sanitizeFilename(toolUseId)}.${ext}`);
}

export function persistMcpOutput(
  sessionId: string,
  toolUseId: string,
  content: unknown
): { persisted: boolean; path?: string; summary: string } {
  const size = estimateSize(content);
  if (size <= LARGE_OUTPUT_THRESHOLD_CHARS) {
    return { persisted: false, summary: typeof content === "string" ? content : JSON.stringify(content) };
  }

  const filepath = getMcpOutputPath(sessionId, toolUseId, content);
  const sessionDir = join(getBaseDir(), sanitizeFilename(sessionId));
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  let payload: string;
  if (typeof content === "string") {
    payload = content;
  } else {
    payload = JSON.stringify(content, null, 2);
  }
  writeFileSync(filepath, payload);

  const sizeKb = Math.round(size / 1024);
  const summary = `[Large MCP output persisted to file] path: ${filepath} size: ${sizeKb}KB`;
  return { persisted: true, path: filepath, summary };
}
