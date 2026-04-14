/**
 * Ouroboros Self-Modification Skill
 * =================================
 * The gateway through which the system modifies itself.
 * EVERY mutation of code or loop logic must pass through the Rule Engine.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { defaultRuleEngine } from "../../core/rule-engine.ts";
import type { ModificationRequest, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync } from "fs";
import { dirname, join, resolve } from "path";

const PROJECT_ROOT = resolve(process.cwd());

function resolveAndGuard(inputPath: string): string {
  const full = resolve(inputPath);
  if (!full.startsWith(PROJECT_ROOT)) {
    throw new Error("Path traversal detected: access outside project root is not allowed.");
  }
  return full;
}
import { createHash } from "crypto";
import { logModification, isModificationFingerprintRecent } from "../../core/session-db.ts";

function normalizeForFingerprint(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

// =============================================================================
// Self-Modification Registry
// =============================================================================

/** Human confirmation callback. In CLI mode this can be a prompt; in headless, a policy hook. */
export type ConfirmCallback = (req: ModificationRequest) => Promise<boolean>;

let globalConfirmCallback: ConfirmCallback | null = null;

export function setSelfModifyConfirmCallback(cb: ConfirmCallback): void {
  globalConfirmCallback = cb;
}

// =============================================================================
// Core Mutation Functions
// =============================================================================

export function applyPatch(original: string, oldStr: string, newStr: string): Result<string> {
  if (!original.includes(oldStr)) {
    return err({ code: "PATCH_NO_MATCH", message: "Old string not found in target file." });
  }
  return ok(original.split(oldStr).join(newStr));
}

export function mutateFile(filePath: string, operation: { type: "write"; content: string } | { type: "patch"; old: string; new: string }): Result<void> {
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
// Self-Modify Tool
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

    // Deduplication: generate fingerprint for patch operations
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

    // Execute mutation
    if (changes.targetPath && (changes.operation === "write" || changes.operation === "patch")) {
      const op =
        changes.operation === "patch"
          ? { type: "patch" as const, old: changes.old as string, new: changes.new as string }
          : { type: "write" as const, content: changes.content as string };
      const result = mutateFile(changes.targetPath as string, op);
      if (!result.success) throw new Error(result.error.message);
    }

    // Audit log to DB
    await logModification(ctx.taskId as string | undefined, req, decision.data, true, fingerprint);

    // Append to local audit log (non-fatal)
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

// =============================================================================
// Rule Engine Override Tool (Emergency Only)
// =============================================================================

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
    return ok("ask"); // always ask
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
