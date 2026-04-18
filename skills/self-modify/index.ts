/**
 * Self-Modification Engine v8.0
 * ==============================
 * The beating heart of Ouroboros — applies approved code mutations safely.
 *
 * Safety layers (outer → inner):
 *   1. Constitution Guard (immutable kernel, core/ deletion)
 *   2. Syntax Validation (tsc --noEmit) for TS/JS files
 *   3. Atomic Write (tmp → validate → rename)
 *   4. Backup Snapshot (full rollback support)
 *
 * Backward-compatible exports from earlier versions:
 *   - applyPatch(original, oldStr, newStr)
 *   - mutateFile(filePath, operation)
 *   - selfModifyTool
 *   - ruleEngineOverrideTool
 *   - setSelfModifyConfirmCallback(cb)
 */

import { z } from "zod";
import { resolve, dirname, join, relative, sep, normalize } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  copyFileSync,
  statSync,
  readdirSync,
  rmdirSync,
} from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { buildTool } from "../../core/tool-framework.ts";
import { defaultRuleEngine } from "../../core/rule-engine.ts";
import { evaluateConstitutionGuard } from "../../core/constitution-guard.ts";
import { logger } from "../../core/logger.ts";
import { logModification, isModificationFingerprintRecent } from "../../core/session-db.ts";
import { runCanaryTests } from "../self-healing/index.ts";
import * as backupModule from "../backup/index.ts";
import * as skillVersioningModule from "../skill-versioning/index.ts";
import type { ModificationRequest, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

const PROJECT_ROOT = resolve(process.cwd());

function resolveAndGuard(inputPath: string): string {
  const full = resolve(inputPath);
  if (!full.startsWith(PROJECT_ROOT)) {
    throw new Error("Path traversal detected: access outside project root is not allowed.");
  }
  return full;
}

function normalizeForFingerprint(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

// =============================================================================
// Legacy Core Mutation Functions (backward-compatible)
// =============================================================================

/** Human confirmation callback. In CLI mode this can be a prompt; in headless, a policy hook. */
export type ConfirmCallback = (req: ModificationRequest) => Promise<boolean>;

let globalConfirmCallback: ConfirmCallback | null = null;

export function setSelfModifyConfirmCallback(cb: ConfirmCallback): void {
  globalConfirmCallback = cb;
}

export function applyPatch(original: string, oldStr: string, newStr: string): Result<string> {
  if (!original.includes(oldStr)) {
    return err({ code: "PATCH_NO_MATCH", message: "Old string not found in target file." });
  }
  return ok(original.split(oldStr).join(newStr));
}

export function mutateFile(
  filePath: string,
  operation: { type: "write"; content: string } | { type: "patch"; old: string; new: string }
): Result<void> {
  try {
    const fullPath = resolveAndGuard(filePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Backup existing file before mutation
    if (existsSync(fullPath)) {
      const backupPath = fullPath + ".bak." + Date.now();
      copyFileSync(fullPath, backupPath);
    }

    let content: string;
    if (operation.type === "write") {
      content = operation.content;
    } else {
      const original = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
      const patched = applyPatch(original, operation.old, operation.new);
      if (!patched.success) return patched;
      content = patched.data;
    }

    // Atomic write: write to temp file then rename
    const tmpPath = fullPath + ".tmp." + Date.now();
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, fullPath);

    return ok(undefined);
  } catch (e) {
    return err({ code: "MUTATION_ERROR", message: String(e) });
  }
}

// =============================================================================
// v8.0 Diff Application Engine
// =============================================================================

export interface DiffEntry {
  path: string;
  diff?: string; // unified diff
  content?: string; // full replacement content
}

export interface ApplyOptions {
  dryRun?: boolean;
  skipSyntaxCheck?: boolean;
  skipBackup?: boolean;
  backupDir?: string;
}

export interface ApplyResult {
  success: boolean;
  filesApplied: string[];
  filesFailed: Array<{ path: string; error: string }>;
  backupPath?: string;
}

// Constitution Guard Integration
function checkConstitution(path: string, operation: "write" | "patch" | "delete", content?: string): string | null {
  const result = evaluateConstitutionGuard(path, operation, content);
  if (!result.success) {
    return result.error?.message ?? "Constitution guard blocked the operation";
  }
  return null;
}

// Unified Diff Parser
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<{ type: "context" | "add" | "remove"; text: string }>;
}

export function parseUnifiedDiff(diffText: string): { oldPath: string; newPath: string; hunks: Hunk[] } | null {
  const lines = diffText.split("\n");
  if (lines.length < 3) return null;

  let oldPath = "";
  let newPath = "";
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("--- ")) {
      oldPath = line.slice(4).split("\t")[0].replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      newPath = line.slice(4).split("\t")[0].replace(/^b\//, "");
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: parseInt(match[2] ?? "1", 10),
          newStart: parseInt(match[3], 10),
          newCount: parseInt(match[4] ?? "1", 10),
          lines: [],
        };
      }
      continue;
    }

    if (currentHunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))) {
      const type = line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context";
      currentHunk.lines.push({ type, text: line.slice(1) });
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  if (!oldPath && !newPath) return null;
  return { oldPath, newPath, hunks };
}

export function applyHunks(originalLines: string[], hunks: Hunk[]): string[] {
  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let result = [...originalLines];

  for (const hunk of sortedHunks) {
    const startIdx = hunk.oldStart - 1;
    if (startIdx < 0 || startIdx > result.length) {
      throw new Error(`Hunk start ${hunk.oldStart} is out of range (file has ${result.length} lines)`);
    }
    const endIdx = hunk.oldCount === 0 ? startIdx : startIdx + hunk.oldCount;

    const replacementLines: string[] = [];
    for (const ln of hunk.lines) {
      if (ln.type === "context" || ln.type === "add") {
        replacementLines.push(ln.text);
      }
    }

    result = [...result.slice(0, startIdx), ...replacementLines, ...result.slice(endIdx)];
  }

  return result;
}

// Atomic File Operations
function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(filePath: string, content: string): void {
  ensureDir(filePath);
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

// Syntax Validation
function validateSyntax(filePaths: string[]): { valid: boolean; errors: Array<{ path: string; error: string }> } {
  const errors: Array<{ path: string; error: string }> = [];
  const tsFiles = filePaths.filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));

  if (tsFiles.length === 0) {
    return { valid: true, errors };
  }

  try {
    execSync("npx tsc --noEmit", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
      encoding: "utf-8",
    });
  } catch (e) {
    const stderr = e instanceof Error && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
    errors.push({ path: "<project>", error: stderr.slice(0, 2000) });
    return { valid: false, errors };
  }

  return { valid: true, errors };
}

// Backup System
export function createBackup(versionId: string, files: string[], backupDir?: string): string {
  const dir = backupDir ?? join(PROJECT_ROOT, ".ouroboros", "backups", versionId);
  mkdirSync(dir, { recursive: true });

  for (const fp of files) {
    const src = resolve(PROJECT_ROOT, fp);
    if (!existsSync(src)) continue;
    const dest = join(dir, fp);
    ensureDir(dest);
    copyFileSync(src, dest);
  }

  logger.info("Backup created", { versionId, fileCount: files.length, dir });
  return dir;
}

export function restoreBackup(versionId: string, backupDir?: string): string[] {
  const dir = backupDir ?? join(PROJECT_ROOT, ".ouroboros", "backups", versionId);
  if (!existsSync(dir)) {
    throw new Error(`Backup not found for version ${versionId}`);
  }

  const restored: string[] = [];

  function walk(relativeDir: string): void {
    const absDir = join(dir, relativeDir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(rel);
      } else {
        const src = join(dir, rel);
        const dest = resolve(PROJECT_ROOT, rel);
        ensureDir(dest);
        copyFileSync(src, dest);
        restored.push(rel);
      }
    }
  }

  walk("");
  logger.info("Backup restored", { versionId, restoredCount: restored.length });
  return restored;
}

// Diff Application Engine
function applySingleDiff(entry: DiffEntry, dryRun: boolean): { success: boolean; error?: string } {
  const relPath = entry.path.replace(/^(a\/|b\/)/, "");
  const fullPath = resolve(PROJECT_ROOT, relPath);

  const constitutionError = checkConstitution(relPath, entry.content !== undefined ? "write" : "patch", entry.content);
  if (constitutionError) {
    return { success: false, error: constitutionError };
  }

  if (dryRun) {
    return { success: true };
  }

  try {
    if (entry.content !== undefined) {
      atomicWrite(fullPath, entry.content);
      return { success: true };
    }

    if (entry.diff) {
      const parsed = parseUnifiedDiff(entry.diff);
      if (!parsed) {
        return { success: false, error: "Failed to parse unified diff" };
      }

      const originalContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
      const originalLines = originalContent.split("\n");
      const newLines = applyHunks(originalLines, parsed.hunks);
      const newContent = newLines.join("\n");

      atomicWrite(fullPath, newContent);
      return { success: true };
    }

    return { success: false, error: "Neither diff nor content provided" };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function applyDiffs(diffs: Record<string, string>, options?: ApplyOptions): ApplyResult {
  const opts = options ?? {};
  const entries: DiffEntry[] = Object.entries(diffs).map(([path, diffOrContent]) => ({
    path,
    diff: diffOrContent.includes("--- ") && diffOrContent.includes("+++ ") ? diffOrContent : undefined,
    content: diffOrContent.includes("--- ") && diffOrContent.includes("+++ ") ? undefined : diffOrContent,
  }));

  const filesToChange = entries.map((e) => e.path.replace(/^(a\/|b\/)/, ""));
  const result: ApplyResult = { success: false, filesApplied: [], filesFailed: [] };

  // Step 1: Constitution guard (dry-run)
  for (const entry of entries) {
    const constitutionError = checkConstitution(
      entry.path,
      entry.content !== undefined ? "write" : "patch",
      entry.content
    );
    if (constitutionError) {
      result.filesFailed.push({ path: entry.path, error: constitutionError });
    }
  }

  if (result.filesFailed.length > 0) {
    result.success = false;
    logger.warn("Diff application blocked by Constitution Guard", { blocked: result.filesFailed.map((f) => f.path) });
    return result;
  }

  if (opts.dryRun) {
    result.success = true;
    result.filesApplied = filesToChange;
    return result;
  }

  // Step 2: Create backup
  let backupPath: string | undefined;
  if (!opts.skipBackup) {
    try {
      backupPath = createBackup(`evo-${Date.now()}`, filesToChange, opts.backupDir);
      result.backupPath = backupPath;
    } catch (e) {
      logger.error("Backup creation failed", { error: String(e) });
      result.filesFailed.push({ path: "<backup>", error: String(e) });
      return result;
    }
  }

  // Step 3: Apply diffs
  for (const entry of entries) {
    const r = applySingleDiff(entry, false);
    if (r.success) {
      result.filesApplied.push(entry.path);
    } else {
      result.filesFailed.push({ path: entry.path, error: r.error ?? "Unknown error" });
    }
  }

  if (result.filesFailed.length > 0) {
    if (backupPath) {
      try {
        restoreBackup(`evo-${Date.now()}`, backupPath);
        logger.info("Rolled back due to application failure");
      } catch (e) {
        logger.error("Rollback failed", { error: String(e) });
      }
    }
    result.success = false;
    return result;
  }

  // Step 4: Syntax validation
  if (!opts.skipSyntaxCheck) {
    const syntaxResult = validateSyntax(result.filesApplied);
    if (!syntaxResult.valid) {
      logger.error("Syntax validation failed", { errors: syntaxResult.errors });
      if (backupPath) {
        try {
          restoreBackup(`evo-${Date.now()}`, backupPath);
          logger.info("Rolled back due to syntax validation failure");
        } catch (e) {
          logger.error("Rollback after syntax failure failed", { error: String(e) });
        }
      }
      result.success = false;
      for (const err of syntaxResult.errors) {
        result.filesFailed.push({ path: err.path, error: err.error });
      }
      result.filesApplied = [];
      return result;
    }
  }

  result.success = true;
  logger.info("Diffs applied successfully", { applied: result.filesApplied.length });
  return result;
}

// =============================================================================
// Legacy Tools (backward-compatible)
// =============================================================================

export const selfModifyTool = buildTool({
  name: "self_modify",
  description:
    "Modify the system's own code, skills, or agent loop. " +
    "All requests are gated by the immutable Rule Engine. " +
    "High-risk or loop-replacement changes require human confirmation.",
  inputSchema: z.object({
    type: z.enum(["skill_create", "skill_patch", "skill_delete", "loop_replace", "core_evolve"]),
    skillName: z.string().optional(),
    description: z.string(),
    proposedChanges: z.record(z.unknown()),
    rationale: z.string(),
    estimatedRisk: z.enum(["low", "medium", "high", "critical"]),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  checkPermissions(input, _ctx) {
    const req: ModificationRequest = {
      type: input.type,
      skillName: input.skillName,
      description: input.description,
      proposedChanges: input.proposedChanges,
      rationale: input.rationale,
      estimatedRisk: input.estimatedRisk,
    };
    return defaultRuleEngine.evaluateModification(req);
  },
  async call(input, ctx) {
    const req: ModificationRequest = {
      type: input.type,
      skillName: input.skillName,
      description: input.description,
      proposedChanges: input.proposedChanges,
      rationale: input.rationale,
      estimatedRisk: input.estimatedRisk,
    };

    const decision = defaultRuleEngine.evaluateModification(req);
    if (!decision.success) {
      throw new Error(`Rule Engine denied modification: ${decision.error.message}`);
    }

    if (decision.data === "deny") {
      throw new Error("Rule Engine denied this modification.");
    }

    if (decision.data === "ask") {
      if (!globalConfirmCallback) {
        throw new Error("Human confirmation required but no callback is registered.");
      }
      const confirmed = await globalConfirmCallback(req);
      if (!confirmed) {
        throw new Error("Modification rejected by human operator.");
      }
    }

    const changes = input.proposedChanges;
    let fingerprint: string | undefined;
    if (changes.targetPath && changes.operation === "patch") {
      const normOld = normalizeForFingerprint(String(changes.old ?? ""));
      const normNew = normalizeForFingerprint(String(changes.new ?? ""));
      fingerprint = createHash("sha256")
        .update(`${changes.targetPath}|${normOld}|${normNew}`)
        .digest("hex");
      if (await isModificationFingerprintRecent(fingerprint)) {
        return { success: true, decision: decision.data, modified: "already applied" };
      }
    }

    // Canary backup before mutation
    let canaryBackupPath: string | undefined;
    if (changes.targetPath && input.type === "core_evolve") {
      const targetPath = resolve(PROJECT_ROOT, changes.targetPath as string);
      const backupResult = backupModule.createFileBackup(targetPath);
      if (backupResult.success) {
        canaryBackupPath = backupResult.backupPath;
      }
    }

    if (changes.targetPath && (changes.operation === "write" || changes.operation === "patch")) {
      const op =
        changes.operation === "patch"
          ? { type: "patch" as const, old: changes.old as string, new: changes.new as string }
          : { type: "write" as const, content: changes.content as string };
      const result = mutateFile(changes.targetPath as string, op);
      if (!result.success) throw new Error(result.error.message);
    }

    // Canary tests after mutation
    const canaryResult = await runCanaryTests();
    if (!canaryResult.success) {
      // Rollback
      if (canaryBackupPath) {
        try {
          copyFileSync(canaryBackupPath, changes.targetPath as string);
          logger.info("Canary failed — restored core file from backup", { path: changes.targetPath });
        } catch (e) {
          logger.error("Canary rollback failed for core file", { path: changes.targetPath, error: String(e) });
        }
      } else if (input.type === "skill_patch" && input.skillName) {
        const versions = skillVersioningModule.listSkillVersions(input.skillName);
        if (versions.length > 0) {
          const latest = versions[versions.length - 1];
          const skillDir = resolve(PROJECT_ROOT, dirname(changes.targetPath as string));
          skillVersioningModule.restoreSkillVersion(input.skillName, latest.versionId, skillDir);
          logger.info("Canary failed — restored skill version", { skillName: input.skillName, versionId: latest.versionId });
        }
      }
      throw new Error(`Canary tests failed: ${canaryResult.stderr || canaryResult.stdout || "unknown error"}`);
    }

    await logModification(ctx.taskId as string | undefined, req, decision.data, true, fingerprint);

    const auditEntry = {
      timestamp: Date.now(),
      request: req,
      decision: decision.data,
      executed: true,
      taskId: ctx.taskId,
      fingerprint,
    };
    const auditPath = join(process.cwd(), ".ouroboros", "modifications.jsonl");
    try {
      const dir = dirname(auditPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(auditPath, JSON.stringify(auditEntry) + "\n", { flag: "a" });
    } catch {
      // non-fatal
    }

    return { success: true, decision: decision.data, modified: changes.targetPath || input.skillName };
  },
});

export const ruleEngineOverrideTool = buildTool({
  name: "rule_engine_override",
  description:
    "EMERGENCY ONLY: Override the Rule Engine to touch the immutable core/rule-engine.ts. " +
    "This ALWAYS requires human confirmation and is logged with highest severity.",
  inputSchema: z.object({
    description: z.string(),
    proposedChanges: z.record(z.unknown()),
    rationale: z.string(),
    emergencyJustification: z.string(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  checkPermissions() {
    return ok("ask");
  },
  async call(input, _ctx) {
    const req: ModificationRequest = {
      type: "rule_engine_override",
      description: input.description,
      proposedChanges: input.proposedChanges,
      rationale: `${input.rationale} | EMERGENCY: ${input.emergencyJustification}`,
      estimatedRisk: "critical",
    };

    if (!globalConfirmCallback) {
      throw new Error("Emergency override requires a human confirmation callback.");
    }
    const confirmed = await globalConfirmCallback(req);
    if (!confirmed) {
      throw new Error("Emergency override rejected.");
    }

    const changes = input.proposedChanges;
    if (changes.targetPath) {
      const op =
        changes.operation === "patch"
          ? { type: "patch" as const, old: changes.old as string, new: changes.new as string }
          : { type: "write" as const, content: changes.content as string };
      const result = mutateFile(changes.targetPath as string, op);
      if (!result.success) throw new Error(result.error.message);
    }

    return { success: true, warning: "IMMUTABLE CORE WAS MODIFIED. RESTART REQUIRED." };
  },
});
