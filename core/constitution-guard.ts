/**
 * Ouroboros Constitution Guard
 * ==============================
 * Runtime enforcement of immutable constitutional rules.
 * All self-modifications must pass through this gate BEFORE any filesystem write.
 *
 * Rules (hard-coded, not LLM-dependent):
 * 1. No deletion of files under core/ (except sandbox test dirs).
 * 2. No modification of core/rule-engine.ts, identity.md, or BIBLE.md without emergency override.
 * 3. No modification of core/config.ts (budget/guard configuration).
 * 4. No introduction of new network-outbound dependencies in package.json.
 */

import { resolve, relative, sep, normalize } from "path";
import { readFileSync } from "fs";
import type { Result } from "../types/index.ts";
import { ok, err } from "../types/index.ts";
import { notificationBus } from "../skills/notification/index.ts";
import { logger } from "./logger.ts";

// Cached, platform-normalized PROJECT_ROOT — computed once at module load.
// normalize() and resolve() are called here so every guard function below
// can skip redundant per-call path resolution.
const CACHED_PROJECT_ROOT = normalize(resolve(process.cwd()));

/** Paths that are sacred and must never be silently modified. */
const IMMUTABLE_PATHS = [
  "core/rule-engine.ts",
  "identity.md",
  "BIBLE.md",
  "core/config.ts",
];

function normalizeForComparison(p: string): string {
  return normalize(p).split(sep).join("/");
}

function isUnderCore(filePath: string): boolean {
  try {
    const resolved = resolve(filePath);
    const rel = normalizeForComparison(relative(CACHED_PROJECT_ROOT, resolved));
    return rel.startsWith("core/");
  } catch {
    // 路径解析失败时 fail-closed：拒绝访问
    return false;
  }
}

function isImmutablePath(filePath: string): boolean {
  try {
    const resolved = resolve(filePath);
    const rel = normalizeForComparison(relative(CACHED_PROJECT_ROOT, resolved));
    return IMMUTABLE_PATHS.some((sacred) => rel === sacred);
  } catch {
    return false;
  }
}

function isPackageJson(filePath: string): boolean {
  try {
    const resolved = resolve(filePath);
    const rel = normalizeForComparison(relative(CACHED_PROJECT_ROOT, resolved));
    return rel === "package.json";
  } catch {
    return false;
  }
}

function hasNewNetworkDependency(original: string, modified: string): boolean {
  try {
    const orig = JSON.parse(original);
    const mod = JSON.parse(modified);
    const origDeps = new Set(Object.keys(orig.dependencies || {}));
    const modDeps = Object.keys(mod.dependencies || {});
    for (const dep of modDeps) {
      if (!origDeps.has(dep)) {
        // Any new dependency is treated as a potential network-outbound risk
        return true;
      }
    }
    return false;
  } catch {
    logger.warn(
      "hasNewNetworkDependency: failed to parse package.json — rejecting to be conservative",
      { originalLength: original.length, modifiedLength: modified.length }
    );
    // Fail-close: any parse error is treated as a potential dependency change
    return true;
  }
}

export interface GuardEvaluation {
  filePath: string;
  operation: "write" | "patch" | "delete";
  allowed: boolean;
  reason?: string;
}

/**
 * Evaluate whether a self-modification violates the Constitution.
 *
 * @param filePath   Target file path (relative or absolute)
 * @param operation  Type of mutation
 * @param content    Optional new content (required for package.json dependency check)
 */
export function evaluateConstitutionGuard(
  filePath: string,
  operation: "write" | "patch" | "delete",
  content?: string
): Result<void> {
  const fullPath = resolve(CACHED_PROJECT_ROOT, filePath);
  const rel = normalizeForComparison(relative(CACHED_PROJECT_ROOT, fullPath));

  // Rule 1: Deletion of core/ files is forbidden (except sandbox test dirs)
  if (operation === "delete" && isUnderCore(fullPath)) {
    if (!rel.startsWith("core/sandbox/") && !rel.includes("test")) {
      const message = `Deletion of core file '${rel}' is prohibited by the Constitution (Rule 1).`;
      notificationBus.emitEvent({
        type: "audit",
        title: "Constitution Guard 拦截",
        message,
        timestamp: Date.now(),
        meta: { filePath: rel, operation, rule: "Rule 1", code: "CONSTITUTION_VIOLATION" },
      });
      return err({ code: "CONSTITUTION_VIOLATION", message });
    }
  }

  // Rule 2: Immutable paths cannot be modified silently
  if (operation !== "delete" && isImmutablePath(fullPath)) {
    const message = `Modification of immutable file '${rel}' is prohibited by the Constitution (Rule 2). Use emergency override only.`;
    notificationBus.emitEvent({
      type: "audit",
      title: "Constitution Guard 拦截",
      message,
      timestamp: Date.now(),
      meta: { filePath: rel, operation, rule: "Rule 2", code: "CONSTITUTION_VIOLATION" },
    });
    return err({ code: "CONSTITUTION_VIOLATION", message });
  }

  // Rule 4: package.json cannot silently gain new dependencies
  if (isPackageJson(fullPath) && content !== undefined) {
    const existing = readFileSync(fullPath, "utf-8");
    if (hasNewNetworkDependency(existing, content)) {
      const message = `Adding new dependencies to package.json is prohibited by the Constitution (Rule 4).`;
      notificationBus.emitEvent({
        type: "audit",
        title: "Constitution Guard 拦截",
        message,
        timestamp: Date.now(),
        meta: { filePath: rel, operation, rule: "Rule 4", code: "CONSTITUTION_VIOLATION" },
      });
      return err({ code: "CONSTITUTION_VIOLATION", message });
    }
  }

  return ok(undefined);
}

/**
 * Lightweight check: returns true if the path is constitutionally protected.
 * Useful for UI highlighting or pre-flight warnings.
 */
export function isConstitutionallyProtected(filePath: string): boolean {
  const fullPath = resolve(CACHED_PROJECT_ROOT, filePath);
  return isImmutablePath(fullPath) || isUnderCore(fullPath);
}
