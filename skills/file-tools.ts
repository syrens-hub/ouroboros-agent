/**
 * Basic file tools for Ouroboros
 */

import { z } from "zod";
import { buildTool } from "../core/tool-framework.ts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, relative } from "path";
import { sanitizeFileContentForPrompt } from "../core/prompt-defense.ts";

const PROJECT_ROOT = resolve(process.cwd());

function resolveAndGuard(inputPath: string): string {
  const full = resolve(PROJECT_ROOT, inputPath);
  const rel = relative(PROJECT_ROOT, full);
  if (rel.startsWith("..") || rel === "") {
    throw new Error("Path traversal detected: access outside project root is not allowed.");
  }
  return full;
}

export const readFileTool = buildTool({
  name: "read_file",
  description: "Read the contents of a file within the project directory.",
  inputSchema: z.object({ path: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ path }) {
    const safePath = resolveAndGuard(path);
    if (!existsSync(safePath)) return { content: null, exists: false };
    const raw = readFileSync(safePath, "utf-8");
    return { content: sanitizeFileContentForPrompt(raw, path), exists: true };
  },
});

export const writeFileTool = buildTool({
  name: "write_file",
  description: "Write content to a file within the project directory. Creates directories as needed.",
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ path, content }) {
    const safePath = resolveAndGuard(path);
    const dir = dirname(safePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(safePath, content, "utf-8");
    return { success: true, bytes: Buffer.byteLength(content, "utf-8") };
  },
});
