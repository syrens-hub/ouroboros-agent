/**
 * Shadow-Git Checkpoint Manager
 * ==============================
 * Transparent filesystem snapshots via shadow git repos.
 *
 * Creates automatic snapshots of working directories before file-mutating
 * operations, without leaking .git into the user's project directory.
 *
 * Architecture:
 *   ${appConfig.db.dir}/checkpoints/{sha256(abs_dir)[:16]}/  — shadow git repo
 *       HEAD, refs/, objects/                                 — standard git internals
 *       info/exclude                                          — default excludes
 *
 * The shadow repo uses GIT_DIR + GIT_WORK_TREE so no git state leaks
 * into the user's project directory.
 */

import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { appConfig } from "../../core/config.ts";
import { logger } from "../../core/logger.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

const PROJECT_ROOT = resolve(process.cwd());
const CHECKPOINT_BASE = resolve(
  appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(PROJECT_ROOT, appConfig.db.dir),
  "checkpoints"
);

const DEFAULT_EXCLUDES = [
  "node_modules/",
  "dist/",
  "build/",
  ".env",
  ".env.*",
  ".env.local",
  ".env.*.local",
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  ".DS_Store",
  "*.log",
  ".cache/",
  ".next/",
  ".nuxt/",
  "coverage/",
  ".pytest_cache/",
  ".venv/",
  "venv/",
  ".git/",
  ".ouroboros/",
  "*.bak.*",
];

const GIT_TIMEOUT_MS = max(10, min(60, parseInt(process.env.OUROBOROS_CHECKPOINT_TIMEOUT || "30", 10)));
const MAX_FILES = 50_000;
const COMMIT_HASH_RE = /^[0-9a-fA-F]{4,64}$/;

function max(a: number, b: number) {
  return a > b ? a : b;
}
function min(a: number, b: number) {
  return a < b ? a : b;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  workingDir: string;
  commitHash: string;
  createdAt: number;
}

function _normalizePath(p: string): string {
  return resolve(p);
}

function _validateCommitHash(commitHash: string): Result<void> {
  if (!commitHash || !commitHash.trim()) {
    return err({ code: "INVALID_HASH", message: "Empty commit hash" });
  }
  if (commitHash.startsWith("-")) {
    return err({ code: "INVALID_HASH", message: `Commit hash must not start with '-': ${commitHash}` });
  }
  if (!COMMIT_HASH_RE.test(commitHash)) {
    return err({ code: "INVALID_HASH", message: `Invalid commit hash (expected 4-64 hex chars): ${commitHash}` });
  }
  return ok(undefined);
}

function _validateWorkingDir(workingDir: string): Result<void> {
  const abs = _normalizePath(workingDir);
  try {
    const rel = relative(PROJECT_ROOT, abs);
    if (rel.startsWith("..") || rel === "") {
      return err({ code: "PATH_TRAVERSAL", message: `Working directory escapes project root: ${workingDir}` });
    }
  } catch {
    return err({ code: "PATH_TRAVERSAL", message: `Failed to resolve working directory: ${workingDir}` });
  }
  return ok(undefined);
}

function _getShadowRepoPath(workingDir: string): string {
  const hash = createHash("sha256").update(_normalizePath(workingDir)).digest("hex").slice(0, 16);
  return join(CHECKPOINT_BASE, hash);
}

function _runGit(args: string[], env?: Record<string, string>): { success: boolean; stdout: string; stderr: string } {
  // 过滤环境变量，只传递必要的和安全的变量
  const safeEnv: Record<string, string> = {};
  const sensitivePrefixes = ['NODE_', 'npm_', 'YARN_', 'pnpm_', 'npm_config_'];
  const allowedVars = ['PATH', 'HOME', 'USER', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
  
  for (const [key, value] of Object.entries(process.env)) {
    if (allowedVars.includes(key)) {
      safeEnv[key] = value ?? "";
    } else if (!sensitivePrefixes.some(prefix => key.startsWith(prefix))) {
      // 只传递非敏感变量
      safeEnv[key] = value ?? "";
    }
  }
  
  const result = spawnSync("git", args, {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS * 1000,
    env: { ...safeEnv, ...env },
    windowsHide: true,
  });
  return {
    success: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function _ensureCheckpointDir() {
  if (!existsSync(CHECKPOINT_BASE)) {
    mkdirSync(CHECKPOINT_BASE, { recursive: true });
  }
}

function _countFiles(dir: string): number {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = readdirSync(current);
      for (const entry of entries) {
        if (entry === ".git") continue;
        const full = join(current, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else {
          count++;
          if (count > MAX_FILES) return count;
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return count;
}

export function createCheckpoint(workingDir: string, sessionId: string): Result<Checkpoint> {
  const wdValidation = _validateWorkingDir(workingDir);
  if (!wdValidation.success) return wdValidation as Result<never>;

  const absDir = _normalizePath(workingDir);
  const fileCount = _countFiles(absDir);
  if (fileCount > MAX_FILES) {
    logger.warn("Checkpoint skipped: too many files", { workingDir, fileCount, max: MAX_FILES });
    return err({ code: "TOO_MANY_FILES", message: `Directory has ${fileCount} files, exceeds limit ${MAX_FILES}` });
  }

  _ensureCheckpointDir();
  const shadowRepo = _getShadowRepoPath(absDir);

  if (!existsSync(shadowRepo)) {
    mkdirSync(shadowRepo, { recursive: true });
    const init = _runGit(["init", "--bare", shadowRepo]);
    if (!init.success) {
      return err({ code: "GIT_INIT_FAILED", message: init.stderr });
    }
  }

  // Persist workingDir mapping for restore lookups
  const mappingPath = join(shadowRepo, "OUROBOROS_WORKDIR");
  try {
    writeFileSync(mappingPath, absDir, "utf-8");
  } catch (e) {
    logger.warn("Failed to write checkpoint working dir mapping", { error: String(e) });
  }

  // Write default excludes
  const excludePath = join(shadowRepo, "info", "exclude");
  if (!existsSync(excludePath)) {
    mkdirSync(join(shadowRepo, "info"), { recursive: true });
    writeFileSync(excludePath, DEFAULT_EXCLUDES.join("\n") + "\n", "utf-8");
  }

  const env = {
    GIT_DIR: shadowRepo,
    GIT_WORK_TREE: absDir,
  };

  // Configure git user (required for commit)
  _runGit(["config", "user.email", "ouroboros@checkpoint.local"], env);
  _runGit(["config", "user.name", "Ouroboros Checkpoint"], env);

  const add = _runGit(["add", "-A"], env);
  if (!add.success) {
    return err({ code: "GIT_ADD_FAILED", message: add.stderr });
  }

  const timestamp = Date.now();
  const commitMsg = `checkpoint:${sessionId}:${timestamp}`;
  const commit = _runGit(["commit", "-m", commitMsg, "--allow-empty"], env);
  if (!commit.success) {
    // If nothing to commit, it's okay as long as HEAD exists
    const head = _runGit(["rev-parse", "HEAD"], env);
    if (!head.success) {
      return err({ code: "GIT_COMMIT_FAILED", message: commit.stderr });
    }
  }

  const revParse = _runGit(["rev-parse", "HEAD"], env);
  if (!revParse.success) {
    return err({ code: "GIT_REV_PARSE_FAILED", message: revParse.stderr });
  }

  const commitHash = revParse.stdout.trim();
  const hashValidation = _validateCommitHash(commitHash);
  if (!hashValidation.success) return hashValidation as Result<never>;

  const repoHash = createHash("sha256").update(absDir).digest("hex").slice(0, 16);
  const checkpoint: Checkpoint = {
    id: `${repoHash}-${timestamp}`,
    sessionId,
    workingDir: absDir,
    commitHash,
    createdAt: timestamp,
  };

  logger.info("Checkpoint created", { checkpointId: checkpoint.id, workingDir: absDir, sessionId });
  return ok(checkpoint);
}

export function restoreCheckpoint(checkpointId: string): Result<void> {
  const parts = checkpointId.split("-");
  if (parts.length < 2) {
    return err({ code: "INVALID_ID", message: `Invalid checkpoint id: ${checkpointId}` });
  }
  const repoHash = parts[0];
  // Find shadow repo by hash prefix
  _ensureCheckpointDir();
  let shadowRepo: string | undefined;
  try {
    for (const entry of readdirSync(CHECKPOINT_BASE)) {
      if (entry.startsWith(repoHash)) {
        shadowRepo = join(CHECKPOINT_BASE, entry);
        break;
      }
    }
  } catch {
    return err({ code: "REPO_NOT_FOUND", message: `Shadow repo not found for checkpoint ${checkpointId}` });
  }
  if (!shadowRepo || !existsSync(shadowRepo)) {
    return err({ code: "REPO_NOT_FOUND", message: `Shadow repo not found for checkpoint ${checkpointId}` });
  }

  // Resolve working dir from shadow repo name (sha256 prefix) — we also store it in git notes or log message.
  // Fallback: scan git log for the checkpoint message to find commitHash, then use current work tree if known.
  // Simpler: we require the caller to know the workingDir, but here we infer from the repoHash match.
  // To be robust, we read the most recent log that matches this checkpoint timestamp.
  const timestamp = parts.slice(1).join("-"); // in case timestamp contains dashes (it doesn't, but safe)
  const log = _runGit(
    ["log", "--all", "--format=%H", "--grep", `checkpoint:.*:${timestamp}`],
    { GIT_DIR: shadowRepo }
  );
  const commitHash = log.stdout.split("\n")[0]?.trim();
  if (!commitHash) {
    return err({ code: "COMMIT_NOT_FOUND", message: `Commit not found for checkpoint ${checkpointId}` });
  }

  const hashValidation = _validateCommitHash(commitHash);
  if (!hashValidation.success) return hashValidation as Result<never>;

  // Determine workingDir: we can't reliably reverse sha256, but we can store a mapping file.
  // For now, maintain a simple mapping file in the shadow repo.
  const mappingPath = join(shadowRepo, "OUROBOROS_WORKDIR");
  let workingDir = "";
  if (existsSync(mappingPath)) {
    workingDir = readFileSync(mappingPath, "utf-8").trim();
  }
  if (!workingDir || !existsSync(workingDir)) {
    return err({
      code: "WORKDIR_UNKNOWN",
      message: `Could not determine working directory for checkpoint ${checkpointId}.`,
    });
  }

  const env = {
    GIT_DIR: shadowRepo,
    GIT_WORK_TREE: workingDir,
  };

  const checkout = _runGit(["checkout", "-f", commitHash], env);
  if (!checkout.success) {
    return err({ code: "GIT_CHECKOUT_FAILED", message: checkout.stderr });
  }

  logger.info("Checkpoint restored", { checkpointId, commitHash, workingDir });
  return ok(undefined);
}

export function listCheckpoints(sessionId?: string): Checkpoint[] {
  _ensureCheckpointDir();
  const checkpoints: Checkpoint[] = [];
  try {
    for (const entry of readdirSync(CHECKPOINT_BASE)) {
      const shadowRepo = join(CHECKPOINT_BASE, entry);
      const st = statSync(shadowRepo);
      if (!st.isDirectory()) continue;

      const mappingPath = join(shadowRepo, "OUROBOROS_WORKDIR");
      let workingDir = "";
      if (existsSync(mappingPath)) {
        workingDir = readFileSync(mappingPath, "utf-8").trim();
      }

      const log = _runGit(
        ["log", "--all", "--format=%H|%s|%ct", "--grep", "^checkpoint:"],
        { GIT_DIR: shadowRepo }
      );
      if (!log.success) continue;

      for (const line of log.stdout.split("\n")) {
        const [hash, subject, _tsStr] = line.split("|");
        if (!hash || !subject) continue;
        const m = subject.match(/^checkpoint:([^:]+):(\d+)$/);
        if (!m) continue;
        const cpSessionId = m[1];
        const timestamp = parseInt(m[2], 10) * 1000; // ct is seconds
        if (sessionId && cpSessionId !== sessionId) continue;
        checkpoints.push({
          id: `${entry}-${m[2]}`,
          sessionId: cpSessionId,
          workingDir,
          commitHash: hash,
          createdAt: timestamp,
        });
      }
    }
  } catch {
    // ignore
  }
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
}


