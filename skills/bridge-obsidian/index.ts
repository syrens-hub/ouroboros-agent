/**
 * Obsidian Bridge
 * ===============
 * Bidirectional sync with a local Obsidian vault.
 *
 * Reads Markdown files (with YAML frontmatter) from a local directory
 * and writes Agent insights back as new notes.
 *
 * Config:
 *   OBSIDIAN_VAULT_PATH — absolute or relative path to vault root
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, basename, extname } from "path";
import { logger } from "../../core/logger.ts";
import type { BridgeItem, BridgeSearchResult } from "../bridge-common/types.ts";

export { type BridgeItem, type BridgeSearchResult };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getVaultPath(): string {
  return process.env.OBSIDIAN_VAULT_PATH || join(process.cwd(), ".ouroboros", "obsidian-bridge");
}

function ensureVault(): void {
  mkdirSync(getVaultPath(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

interface ParsedNote {
  frontmatter: Record<string, unknown>;
  content: string;
  title: string;
}

function parseNote(filepath: string): ParsedNote {
  const raw = readFileSync(filepath, "utf-8");
  const lines = raw.split("\n");

  if (lines[0] !== "---") {
    return { frontmatter: {}, content: raw, title: basename(filepath, ".md") };
  }

  const fmEnd = lines.findIndex((l, i) => i > 0 && l === "---");
  const fmLines = fmEnd > 0 ? lines.slice(1, fmEnd) : [];
  const content = fmEnd > 0 ? lines.slice(fmEnd + 1).join("\n").trim() : raw;

  const frontmatter: Record<string, unknown> = {};
  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      frontmatter[key] = val;
    }
  }

  return { frontmatter, content, title: String(frontmatter.title || basename(filepath, ".md")) };
}

function serializeNote(title: string, content: string, frontmatter: Record<string, unknown> = {}): string {
  const fm = Object.entries({ title, ...frontmatter })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${content}\n`;
}

// ---------------------------------------------------------------------------
// Scan vault
// ---------------------------------------------------------------------------

function scanVault(dir: string, relativePath = ""): Array<{ path: string; relPath: string }> {
  const results: Array<{ path: string; relPath: string }> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = join(relativePath, entry);
    const st = statSync(full);
    if (st.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
      results.push(...scanVault(full, rel));
    } else if (st.isFile() && extname(entry) === ".md") {
      results.push({ path: full, relPath: rel });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listNotes(limit = 50): BridgeItem[] {
  ensureVault();
  const files = scanVault(getVaultPath()).slice(0, limit);

  return files.map((f) => {
    const parsed = parseNote(f.path);
    return {
      id: f.relPath,
      title: parsed.title,
      content: parsed.content,
      source: "obsidian",
      tags: parseTags(parsed.content),
      updatedAt: statSync(f.path).mtimeMs,
    };
  });
}

export function readNote(relPath: string): BridgeItem | undefined {
  ensureVault();
  const fullPath = join(getVaultPath(), relPath);
  try {
    const parsed = parseNote(fullPath);
    return {
      id: relPath,
      title: parsed.title,
      content: parsed.content,
      source: "obsidian",
      tags: parseTags(parsed.content),
      updatedAt: statSync(fullPath).mtimeMs,
    };
  } catch {
    return undefined;
  }
}

export function writeNote(relPath: string, title: string, content: string, tags: string[] = []): { success: boolean; id?: string; error?: string } {
  ensureVault();
  const fullPath = join(getVaultPath(), relPath);
  try {
    mkdirSync(join(fullPath, ".."), { recursive: true });
    const fm: Record<string, unknown> = {
      tags: tags.join(", "),
      created: new Date().toISOString(),
      source: "ouroboros-agent",
    };
    writeFileSync(fullPath, serializeNote(title, content, fm), "utf-8");
    logger.info("obsidian:write", { path: relPath, title });
    return { success: true, id: relPath };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function searchNotes(query: string, limit = 20): BridgeSearchResult {
  ensureVault();
  const files = scanVault(getVaultPath());
  const q = query.toLowerCase();
  const items: BridgeItem[] = [];

  for (const f of files) {
    const parsed = parseNote(f.path);
    if (parsed.title.toLowerCase().includes(q) || parsed.content.toLowerCase().includes(q)) {
      items.push({
        id: f.relPath,
        title: parsed.title,
        content: parsed.content,
        source: "obsidian",
        tags: parseTags(parsed.content),
        updatedAt: statSync(f.path).mtimeMs,
      });
      if (items.length >= limit) break;
    }
  }

  return { items, total: items.length };
}

// ---------------------------------------------------------------------------
// Knowledge graph ingestion
// ---------------------------------------------------------------------------

export async function ingestToKnowledgeGraph(limit = 50): Promise<{ nodesCreated: number; edgesCreated: number }> {
  const { addNode, addEdge } = await import("../engraph/kg-api.ts");
  const notes = listNotes(limit);
  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const note of notes) {
    try {
      const node = addNode(note.title, "document", { source: `obsidian:${note.id}`, tags: note.tags });
      nodesCreated++;

      // Link to tags as concepts
      for (const tag of note.tags) {
        try {
          const tagNode = addNode(tag, "concept");
          addEdge(node.id, tagNode.id, "relates_to");
          edgesCreated++;
        } catch {
          // tag may already exist
        }
      }
    } catch (e) {
      logger.warn("obsidian:ingest failed", { note: note.id, error: String(e) });
    }
  }

  logger.info("obsidian:ingest complete", { nodesCreated, edgesCreated });
  return { nodesCreated, edgesCreated };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTags(content: string): string[] {
  const tags = new Set<string>();
  const matches = content.match(/#(\w+)/g);
  if (matches) matches.forEach((m) => tags.add(m.slice(1)));
  const yamlTags = content.match(/^tags:\s*(.+)$/m);
  if (yamlTags) yamlTags[1].split(",").forEach((t) => tags.add(t.trim()));
  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const obsidianBridge = {
  name: "obsidian",
  get enabled() {
    try {
      ensureVault();
      return true;
    } catch {
      return false;
    }
  },
  list: async (limit?: number) => listNotes(limit),
  read: async (id: string) => readNote(id),
  write: async (item: BridgeItem) => writeNote(item.id, item.title, item.content, item.tags),
  search: async (query: string, limit?: number) => searchNotes(query, limit),
};
