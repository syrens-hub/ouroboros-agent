/**
 * Obsidian Exporter
 * =================
 * Export claims to standard Markdown files with YAML frontmatter
 * for use in Obsidian or other Markdown-based knowledge systems.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Claim } from "./types.ts";

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\n\r]/g, "_").trim() || "untitled";
}

function claimToMarkdown(claim: Claim): string {
  const frontmatter = [
    "---",
    `id: ${claim.id}`,
    `category: ${claim.category}`,
    `freshness: ${claim.freshness}`,
    `status: ${claim.status}`,
    `confidence: ${claim.confidence}`,
    `created_at: ${claim.createdAt}`,
    `updated_at: ${claim.updatedAt}`,
    `contradictions: [${claim.contradictions.join(", ")}]`,
    "---",
    "",
    `# Claim: ${claim.content.slice(0, 80)}${claim.content.length > 80 ? "..." : ""}`,
    "",
    claim.content,
    "",
  ];

  if (claim.sources.length > 0) {
    frontmatter.push("## Sources");
    frontmatter.push("");
    for (const source of claim.sources) {
      const parts: string[] = [];
      if (source.file) parts.push(`File: \`${source.file}\``);
      if (source.sessionId) parts.push(`Session: \`${source.sessionId}\``);
      if (source.excerpt) parts.push(`Excerpt: > ${source.excerpt}`);
      if (source.timestamp) parts.push(`Timestamp: ${new Date(source.timestamp).toISOString()}`);
      frontmatter.push(`- ${parts.join(" | ") || "source"}`);
    }
    frontmatter.push("");
  }

  if (claim.contradictions.length > 0) {
    frontmatter.push("## Contradictions");
    frontmatter.push("");
    for (const cid of claim.contradictions) {
      frontmatter.push(`- [[${cid}]]`);
    }
    frontmatter.push("");
  }

  return frontmatter.join("\n");
}

export function exportToObsidian(claims: Claim[], outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });

  for (const claim of claims) {
    const filename = `${sanitizeFilename(claim.id)}.md`;
    const filepath = join(outputDir, filename);
    writeFileSync(filepath, claimToMarkdown(claim), "utf-8");
  }

  // Generate Map of Content (MOC)
  const mocLines: string[] = [
    "# Map of Content — Memory Wiki",
    "",
    `> Generated on ${new Date().toISOString()} — ${claims.length} claim(s)`,
    "",
    "| ID | Category | Status | Freshness | Confidence | Content |",
    "|---|---|---|---|---|---|",
  ];

  for (const claim of claims) {
    const shortContent = claim.content.slice(0, 60).replace(/\|/g, "\\|") + (claim.content.length > 60 ? "..." : "");
    mocLines.push(
      `| [[${claim.id}]] | ${claim.category} | ${claim.status} | ${claim.freshness} | ${claim.confidence} | ${shortContent} |`
    );
  }

  mocLines.push("");
  writeFileSync(join(outputDir, "MOC.md"), mocLines.join("\n"), "utf-8");
}
