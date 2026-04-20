/**
 * Auto-Evolve Executor
 * ====================
 * Applies approved improvement proposals and commits changes to Git.
 *
 * Execution strategy per category:
 *   - performance (index)  →  run ALTER TABLE / CREATE INDEX via db-manager
 *   - reliability (prompt) →  generate diff, human must review
 *   - resource             →  config change (env or config.ts)
 *   - security             →  never auto-apply; manual only
 *
 * All applied changes are committed to Git with a descriptive message.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { getDb } from "../../core/db-manager.ts";
import { logger } from "../../core/logger.ts";
import type { ImprovementProposal } from "./proposal-db.ts";
import { updateProposalStatus } from "./proposal-db.ts";

export interface ExecutionResult {
  success: boolean;
  message: string;
  gitCommit?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function executeProposal(proposal: ImprovementProposal): Promise<ExecutionResult> {
  if (proposal.status !== "approved") {
    return { success: false, message: `Proposal ${proposal.id} is not approved (status: ${proposal.status})` };
  }

  logger.info("Executing auto-evolve proposal", {
    proposalId: proposal.id,
    category: proposal.category,
    title: proposal.title,
  });

  try {
    switch (proposal.category) {
      case "performance":
        return await executePerformanceProposal(proposal);
      case "reliability":
        return await executeReliabilityProposal(proposal);
      case "resource":
        return await executeResourceProposal(proposal);
      case "security":
        return { success: false, message: "Security proposals must be applied manually." };
      default:
        return { success: false, message: `Unknown category: ${proposal.category}` };
    }
  } catch (e) {
    const err = String(e);
    updateProposalStatus(proposal.id, "failed", { errorMessage: err });
    return { success: false, message: `Execution failed: ${err}`, error: err };
  }
}

// ---------------------------------------------------------------------------
// Category executors
// ---------------------------------------------------------------------------

async function executePerformanceProposal(proposal: ImprovementProposal): Promise<ExecutionResult> {
  // Index proposals: parse CREATE INDEX from suggestedFix
  const indexMatch = proposal.suggestedFix.match(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^)]+)\)/i);
  if (!indexMatch) {
    return { success: false, message: "No CREATE INDEX directive found in proposal." };
  }

  const [, indexName, tableName, columns] = indexMatch;
  const db = getDb();

  // Safety: verify table exists
  const tableCheck = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { name: string } | undefined;

  if (!tableCheck) {
    return { success: false, message: `Table '${tableName}' does not exist.` };
  }

  // Check if index already exists
  const existing = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
  ).get(indexName) as { name: string } | undefined;

  if (existing) {
    updateProposalStatus(proposal.id, "applied");
    return { success: true, message: `Index ${indexName} already exists.` };
  }

  // Execute CREATE INDEX
  db.prepare(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columns})`).run();

  const commitMsg = `auto-evolve: add index ${indexName} on ${tableName}(${columns})

Proposal: ${proposal.id}
Reason: ${proposal.rootCause}
Expected impact: ${proposal.expectedImpact}`;

  const gitCommit = gitCommitAll(commitMsg);
  updateProposalStatus(proposal.id, "applied", { gitCommit: gitCommit ?? undefined });

  return {
    success: true,
    message: `Created index ${indexName} on ${tableName}(${columns}).`,
    gitCommit: gitCommit ?? undefined,
  };
}

async function executeReliabilityProposal(proposal: ImprovementProposal): Promise<ExecutionResult> {
  // Reliability proposals (prompt fixes) are not auto-applied by default.
  // Instead, generate a diff file in .ouroboros/evolution-patches/ for human review.
  if (proposal.autoApplicable) {
    // If explicitly marked auto-applicable, apply a safe config change
    return applyConfigPatch(proposal);
  }

  const { writeFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");
  const patchDir = join(process.cwd(), ".ouroboros", "evolution-patches");
  mkdirSync(patchDir, { recursive: true });

  const patchFile = join(patchDir, `${proposal.id}.md`);
  writeFileSync(patchFile, `# Evolution Patch: ${proposal.title}

**Proposal ID:** ${proposal.id}
**Category:** ${proposal.category}
**Severity:** ${proposal.severity}
**Risk:** ${proposal.riskLevel}

## Problem
${proposal.description}

## Root Cause
${proposal.rootCause}

## Suggested Fix
${proposal.suggestedFix}

## Expected Impact
${proposal.expectedImpact}

## Manual Application Steps
1. Review the suggested fix above.
2. Apply changes to the relevant skill files.
3. Run tests: \`npm test\`
4. Commit with: \`git commit -am "fix: ${proposal.title}"\`
`);

  updateProposalStatus(proposal.id, "applied");
  return {
    success: true,
    message: `Patch written to ${patchFile} for manual review.`,
  };
}

async function executeResourceProposal(proposal: ImprovementProposal): Promise<ExecutionResult> {
  return applyConfigPatch(proposal);
}

// ---------------------------------------------------------------------------
// Config patch helper
// ---------------------------------------------------------------------------

async function applyConfigPatch(proposal: ImprovementProposal): Promise<ExecutionResult> {
  // For now, resource/config proposals generate a patch file too.
  // In the future, this could safely modify .env or config.ts with structured edits.
  const { writeFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");
  const patchDir = join(process.cwd(), ".ouroboros", "evolution-patches");
  mkdirSync(patchDir, { recursive: true });

  const patchFile = join(patchDir, `${proposal.id}.md`);
  writeFileSync(patchFile, `# Config Patch: ${proposal.title}

**Proposal ID:** ${proposal.id}
**Category:** ${proposal.category}
**Risk:** ${proposal.riskLevel}

## Problem
${proposal.description}

## Suggested Fix
${proposal.suggestedFix}

## Expected Impact
${proposal.expectedImpact}
`);

  updateProposalStatus(proposal.id, "applied");
  return {
    success: true,
    message: `Config patch written to ${patchFile}.`,
  };
}

// ---------------------------------------------------------------------------
// Git helper
// ---------------------------------------------------------------------------

function gitCommitAll(message: string): string | null {
  const gitDir = joinGitDir();
  if (!gitDir) return null;

  try {
    execSync("git add -A", { cwd: gitDir, encoding: "utf-8" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}" --quiet`, {
      cwd: gitDir,
      encoding: "utf-8",
    });
    // Extract commit hash
    const hash = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
    return hash;
  } catch {
    // Git commit may fail if nothing to commit or not a git repo
    return null;
  }
}

function joinGitDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(`${dir}/.git`)) return dir;
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
