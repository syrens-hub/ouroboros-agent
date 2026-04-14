#!/usr/bin/env tsx
/**
 * Migrate OpenClaw Memory to Ouroboros SQLite
 * =============================================
 * Scans ~/.openclaw/workspace/memory/ and imports all
 * .md / .txt / .json files into the memory_layers table.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, basename, extname, relative } from "path";
import { getDb } from "../core/db-manager.ts";

const MEMORY_ROOT = join(process.env.HOME || "/Users/chimu", ".openclaw", "workspace", "memory");

const LAYER_MAP: Record<string, string> = {
  "agency-history": "agency",
  "agency-messages": "agency",
  "competence": "competence",
  "learnings": "learning",
  "patterns": "pattern",
  "projects": "project",
  "reflections": "reflection",
  "evaluations": "evaluation",
  "collective": "collective",
  "archive": "archive",
  "important": "important",
  "hil": "hil",
  "logs": "log",
};

function resolveLayer(dirName: string): string {
  return LAYER_MAP[dirName] || "general";
}

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".txt" || ext === ".json" || ext === ".jsonl";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n\n[truncated]";
}

function generateSummary(content: string): string {
  const firstLine = content.split("\n")[0].trim();
  if (firstLine.length > 10) return firstLine.slice(0, 200);
  return content.slice(0, 200).replace(/\s+/g, " ").trim();
}

interface MemoryEntry {
  layer: string;
  sourcePath: string;
  content: string;
  summary: string;
}

function scanDirectory(dir: string, entries: MemoryEntry[] = []): MemoryEntry[] {
  if (!existsSync(dir)) return entries;

  const relativeToMemory = relative(MEMORY_ROOT, dir);
  const layer = resolveLayer(basename(dir) || relativeToMemory.split("/")[0] || "general");

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, entries);
    } else if (entry.isFile() && isTextFile(fullPath)) {
      try {
        const stats = statSync(fullPath);
        if (stats.size > 5 * 1024 * 1024) {
          console.log(`Skipping large file: ${fullPath} (${stats.size} bytes)`);
          continue;
        }
        const raw = readFileSync(fullPath, "utf-8");
        const content = truncate(raw, 50000);
        entries.push({
          layer,
          sourcePath: fullPath,
          content,
          summary: generateSummary(content),
        });
      } catch (e) {
        console.error(`Failed to read ${fullPath}:`, e);
      }
    }
  }

  return entries;
}

function main() {
  if (!existsSync(MEMORY_ROOT)) {
    console.error(`OpenClaw memory directory not found: ${MEMORY_ROOT}`);
    process.exit(1);
  }

  console.log(`Scanning ${MEMORY_ROOT}...`);
  const entries = scanDirectory(MEMORY_ROOT);
  console.log(`Found ${entries.length} memory files to import.`);

  if (entries.length === 0) {
    console.log("Nothing to import.");
    process.exit(0);
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO memory_layers (layer, source_path, content, summary, score)
     VALUES (?, ?, ?, ?, ?)`
  );

  let imported = 0;
  for (const e of entries) {
    try {
      insert.run(e.layer, e.sourcePath, e.content, e.summary, 1.0);
      imported++;
    } catch (err) {
      console.error(`Failed to import ${e.sourcePath}:`, err);
    }
  }

  console.log(`Successfully imported ${imported}/${entries.length} memory entries.`);

  // Print summary by layer
  const summary = db.prepare(
    `SELECT layer, COUNT(*) as count FROM memory_layers GROUP BY layer ORDER BY count DESC`
  ).all() as { layer: string; count: number }[];

  console.log("\nLayer breakdown:");
  for (const row of summary) {
    console.log(`  ${row.layer}: ${row.count}`);
  }
}

main();
