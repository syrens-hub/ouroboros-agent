/**
 * Git Bridge
 * ==========
 * Reads the agent's own commit history for self-reflection.
 * No write operations — evolution executor handles code changes.
 *
 * Capabilities:
 *   - list recent commits
 *   - read commit diff + message
 *   - search commits by message/content
 *   - summarize evolution trends
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
// logger imported dynamically when needed
import type { BridgeItem, BridgeSearchResult } from "../bridge-common/types.ts";

export { type BridgeItem, type BridgeSearchResult };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GIT_DIR = findGitDir();

function findGitDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(`${dir}/.git`)) return dir;
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function git(args: string[]): string {
  if (!GIT_DIR) return "";
  try {
    return execSync(`git ${args.join(" ")}`, { cwd: GIT_DIR, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// List commits
// ---------------------------------------------------------------------------

export function listCommits(limit = 20): BridgeItem[] {
  const format = "%H|%s|%an|%ae|%ad|%D";
  const stdout = git([`log`, `--pretty=format:${format}`, `--date=iso`, `-n`, String(limit)]);
  if (!stdout) return [];

  const lines = stdout.trim().split("\n");
  return lines.map((line) => {
    const [hash, subject, author, email, date, refs] = line.split("|");
    return {
      id: hash,
      title: subject,
      content: `${subject}\nAuthor: ${author} <${email}>\nDate: ${date}\nRefs: ${refs}`,
      source: "git",
      tags: parseTags(subject),
      createdAt: new Date(date).getTime(),
    };
  });
}

// ---------------------------------------------------------------------------
// Read commit detail
// ---------------------------------------------------------------------------

export function readCommit(hash: string): BridgeItem | undefined {
  const message = git(["log", "-1", "--pretty=format:%B", hash]).trim();
  const stat = git(["show", "--stat", "--oneline", "-s", hash]).trim();
  const diff = git(["show", "--stat", hash]).trim();
  if (!message) return undefined;

  return {
    id: hash,
    title: message.split("\n")[0],
    content: `${message}\n\n--- Stats ---\n${stat}\n\n--- Files ---\n${diff}`,
    source: "git",
    tags: parseTags(message),
    createdAt: parseDateFromShow(hash),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function searchCommits(query: string, limit = 20): BridgeSearchResult {
  const stdout = git(["log", `--grep=${query}`, `--pretty=format:%H|%s|%ad`, `--date=iso`, `-n`, String(limit)]);
  if (!stdout) return { items: [], total: 0 };

  const lines = stdout.trim().split("\n");
  const items = lines.map((line) => {
    const [hash, subject, date] = line.split("|");
    return {
      id: hash,
      title: subject,
      content: subject,
      source: "git" as const,
      tags: parseTags(subject),
      createdAt: new Date(date).getTime(),
    };
  });

  return { items, total: items.length };
}

// ---------------------------------------------------------------------------
// Self-reflection: evolution trends
// ---------------------------------------------------------------------------

export interface EvolutionTrend {
  period: string;
  commitCount: number;
  authors: string[];
  topTags: Array<{ tag: string; count: number }>;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export function getEvolutionTrends(days = 30): EvolutionTrend[] {
  const stdout = git(["log", `--since=${days} days ago`, `--pretty=format:%H|%s|%an|%ad`, `--date=short`, `--numstat`]);
  if (!stdout) return [];

  const byDate = new Map<string, { commits: string[]; authors: Set<string>; tags: Map<string, number>; files: number; added: number; removed: number }>();

  const blocks = stdout.trim().split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    const header = lines[0];
    if (!header) continue;
    const [hash, subject, author, date] = header.split("|");
    if (!date) continue;

    const entry = byDate.get(date) || { commits: [], authors: new Set(), tags: new Map(), files: 0, added: 0, removed: 0 };
    entry.commits.push(hash);
    entry.authors.add(author);

    for (const tag of parseTags(subject)) {
      entry.tags.set(tag, (entry.tags.get(tag) || 0) + 1);
    }

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split("\t");
      if (parts.length === 3) {
        const added = parseInt(parts[0], 10) || 0;
        const removed = parseInt(parts[1], 10) || 0;
        entry.added += added;
        entry.removed += removed;
        entry.files += 1;
      }
    }

    byDate.set(date, entry);
  }

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, data]) => ({
      period: date,
      commitCount: data.commits.length,
      authors: Array.from(data.authors),
      topTags: Array.from(data.tags.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
      filesChanged: data.files,
      linesAdded: data.added,
      linesRemoved: data.removed,
    }));
}

/** Why did I make this change? — Self-reflection helper */
export function explainCommit(hash: string): string {
  const commit = readCommit(hash);
  if (!commit) return `Commit ${hash} not found.`;

  const parent = git(["log", "-1", "--pretty=format:%H", `${hash}^`]).trim();
  const diffSummary = git(["diff", "--stat", parent, hash]).trim();

  return `# Self-Reflection: ${commit.title}

## Commit Message
${commit.content.split("\n---")[0]}

## Files Changed
${diffSummary || "(no diff available)"}

## Design Decision Summary
This change was made to ${commit.title.toLowerCase().replace(/^(add|fix|update|remove|refactor|optimize)/, "")}.
The impact affected ${diffSummary.split("\n").filter((l) => l.includes("|")).length} file(s).
`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTags(text: string): string[] {
  const tags: string[] = [];
  const conventional = text.match(/^(\w+)(\(|:)/);
  if (conventional) tags.push(conventional[1]);
  const hashes = text.match(/#(\w+)/g);
  if (hashes) tags.push(...hashes.map((h) => h.slice(1)));
  return tags;
}

function parseDateFromShow(hash: string): number {
  const dateStr = git(["log", "-1", "--pretty=format:%cd", "--date=iso", hash]).trim();
  return dateStr ? new Date(dateStr).getTime() : 0;
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const gitBridge = {
  name: "git",
  get enabled() { return !!GIT_DIR; },
  list: async (limit?: number) => listCommits(limit),
  read: async (id: string) => readCommit(id),
  write: async () => ({ success: false as const, error: "Git bridge is read-only. Use evolution-executor for code changes." }),
  search: async (query: string, limit?: number) => searchCommits(query, limit),
};
