import { spawnSync } from "child_process";

export interface EvolutionCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  tags: string[];
  stats: { filesChanged: number; insertions: number; deletions: number };
}

export function getEvolutionHistory(limit?: number): EvolutionCommit[] {
  const n = limit ?? 50;
  const result = spawnSync(
    "git",
    ["log", "--pretty=format:%H|%h|%s|%an|%ai|%D", "--numstat", "-n", String(n)],
    { encoding: "utf-8", cwd: process.cwd() }
  );

  if (result.error || result.status !== 0) {
    return [];
  }

  const commits: EvolutionCommit[] = [];
  const lines = result.stdout.split("\n");
  let current: Partial<EvolutionCommit> & { stats: { filesChanged: number; insertions: number; deletions: number } } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this is a commit header line
    if (line.includes("|") && !/^\d/.test(line) && !/^-/.test(line)) {
      if (current) {
        commits.push(current as EvolutionCommit);
      }
      const [hash, shortHash, message, author, date, refsRaw] = trimmed.split("|");
      const tags = (refsRaw || "")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.startsWith("tag: "))
        .map((r) => r.replace("tag: ", ""));
      current = {
        hash: hash || "",
        shortHash: shortHash || "",
        message: message || "",
        author: author || "",
        date: date || "",
        tags,
        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
      };
    } else if (current && /^\d/.test(line)) {
      // numstat line: <insertions> <deletions> <file>
      const parts = trimmed.split("\t");
      if (parts.length >= 2) {
        const insertions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        current.stats.filesChanged += 1;
        current.stats.insertions += insertions;
        current.stats.deletions += deletions;
      }
    } else if (current && /^-/.test(line)) {
      // binary file line: -\t-\t<file>
      current.stats.filesChanged += 1;
    }
  }

  if (current) {
    commits.push(current as EvolutionCommit);
  }

  return commits;
}
