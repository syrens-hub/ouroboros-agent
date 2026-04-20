/**
 * Agency Agents Loader
 * =====================
 * Load and parse Markdown agent definitions from the agents directory.
 * Each agent is a Markdown file with YAML frontmatter.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, basename } from "path";
import { logger } from "../../core/logger.ts";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  division: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  content: string; // Full markdown content after frontmatter
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  [key: string]: unknown;
}

function parseFrontmatter(raw: string): { frontmatter: ParsedFrontmatter; content: string } {
  const frontmatter: ParsedFrontmatter = {};
  let content = raw;

  if (raw.startsWith("---")) {
    const endIdx = raw.indexOf("---", 3);
    if (endIdx !== -1) {
      const fmBlock = raw.slice(3, endIdx);
      content = raw.slice(endIdx + 3).trim();

      const lines = fmBlock.split("\n");
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const rest = line.slice(colonIdx + 1).trim();

          if (!key) { i++; continue; }

          // Multiline string: value ends with | or >
          if (rest === "|" || rest === ">") {
            i++;
            const valueLines: string[] = [];
            while (i < lines.length) {
              const next = lines[i];
              // Stop at next top-level key or end of block
              if (next.trim() === "" || (next.match(/^\S/) && next.includes(":"))) break;
              valueLines.push(next);
              i++;
            }
            (frontmatter as Record<string, unknown>)[key] = valueLines.join("\n").trim();
            continue;
          }

          // Array: value starts with - item
          if (rest.startsWith("-")) {
            const arr: string[] = [rest.slice(1).trim()];
            i++;
            while (i < lines.length) {
              const next = lines[i];
              if (!next.trim().startsWith("-")) break;
              arr.push(next.trim().slice(1).trim());
              i++;
            }
            (frontmatter as Record<string, unknown>)[key] = arr;
            continue;
          }

          if (rest) {
            // Unquote if wrapped in quotes
            const unquoted = rest.replace(/^["'](.*)["']$/, "$1");
            (frontmatter as Record<string, unknown>)[key] = unquoted;
          }
        }
        i++;
      }
    }
  }

  return { frontmatter, content };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function loadAgentFile(filePath: string, division: string): AgentDefinition | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, content } = parseFrontmatter(raw);

    const name = frontmatter.name || basename(filePath, ".md").replace(/^.+?-/, "").replace(/-/g, " ");
    const description = frontmatter.description || "";

    if (!name) {
      logger.warn("Agent file missing name", { path: filePath });
      return null;
    }

    return {
      id: slugify(name),
      name,
      description,
      division,
      color: frontmatter.color,
      emoji: frontmatter.emoji,
      vibe: frontmatter.vibe,
      content,
    };
  } catch (e) {
    logger.warn("Failed to load agent file", { path: filePath, error: String(e) });
    return null;
  }
}

export function loadAgentsFromDir(agentsDir: string): AgentDefinition[] {
  const agents: AgentDefinition[] = [];

  if (!existsSync(agentsDir)) {
    logger.warn("Agents directory does not exist", { path: agentsDir });
    return agents;
  }

  function scan(dir: string, division: string): void {
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry);
      const stat = statSync(entryPath);

      if (stat.isDirectory()) {
        // Recurse into subdirectories; use folder name as division if at top level
        const nextDivision = dir === agentsDir ? entry : division;
        scan(entryPath, nextDivision);
      } else if (entry.endsWith(".md")) {
        const agent = loadAgentFile(entryPath, division);
        if (agent) agents.push(agent);
      }
    }
  }

  scan(agentsDir, "general");
  return agents;
}
