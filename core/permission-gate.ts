/**
 * Ouroboros Permission Gate
 * =========================
 * Three-layer permission pipeline inspired by Claude Code:
 *   1. Rule matching (deny → ask → allow)
 *   2. Tool-specific checkPermissions()
 *   3. Mode layer (bypass / auto / interactive)
 */

import type {
  ConditionalRule,
  Result,
  Tool,
  ToolPermissionContext,
  ToolPermissionLevel,
} from "../types/index.ts";
import { ok } from "../types/index.ts";
import { safeFailClosed } from "../core/safe-utils.ts";
import { classifyBashCommand } from "./bash-classifier.ts";

// =============================================================================
// Rule Matching
// =============================================================================

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchRule(toolName: string, rules: string[]): boolean {
  for (const rule of rules) {
    if (rule === toolName) return true;
    if (rule === "*") return true;
    // support simple wildcard like "file_*"
    const regex = new RegExp("^" + escapeRegExp(rule).replace(/\\\*/g, ".*") + "$");
    if (regex.test(toolName)) return true;
  }
  return false;
}

export function evaluateRules(
  toolName: string,
  ctx: ToolPermissionContext
): ToolPermissionLevel {
  if (matchRule(toolName, ctx.alwaysDenyRules)) return "deny";
  if (matchRule(toolName, ctx.alwaysAskRules)) return "ask";
  if (matchRule(toolName, ctx.alwaysAllowRules)) return "allow";
  return "ask"; // default conservative
}

function getValueByPath(obj: unknown, path: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function evaluateCondition(actual: unknown, operator: ConditionalRule["operator"], expected: unknown): boolean {
  if (actual === undefined || actual === null) return false;

  const actualStr = String(actual);
  const expectedStr = String(expected);

  switch (operator) {
    case "equals":
      return actual === expected || actualStr === expectedStr;
    case "contains":
      return actualStr.includes(expectedStr);
    case "startsWith":
      return actualStr.startsWith(expectedStr);
    case "endsWith":
      return actualStr.endsWith(expectedStr);
    case "regex": {
      return safeFailClosed(() => {
        const regex = new RegExp(expectedStr, "i");
        return regex.test(actualStr);
      }, `Invalid regex in permission rule: ${expectedStr}`, false);
    }
    case "gt": {
      const actualNum = typeof actual === "number" ? actual : Number(actualStr);
      const expectedNum = typeof expected === "number" ? expected : Number(expectedStr);
      return !Number.isNaN(actualNum) && !Number.isNaN(expectedNum) && actualNum > expectedNum;
    }
    case "lt": {
      const actualNum = typeof actual === "number" ? actual : Number(actualStr);
      const expectedNum = typeof expected === "number" ? expected : Number(expectedStr);
      return !Number.isNaN(actualNum) && !Number.isNaN(expectedNum) && actualNum < expectedNum;
    }
    default:
      return false;
  }
}

export function evaluateConditionalRules(
  toolName: string,
  toolInput: unknown,
  conditionalRules: ConditionalRule[] | undefined
): ToolPermissionLevel | null {
  if (!conditionalRules || conditionalRules.length === 0) return null;

  for (const rule of conditionalRules) {
    if (!matchRule(toolName, [rule.toolPattern])) continue;

    const actual = getValueByPath(toolInput, rule.path);
    if (evaluateCondition(actual, rule.operator, rule.value)) {
      return rule.action;
    }
  }

  return null;
}

// =============================================================================
// Full Permission Pipeline
// =============================================================================

export interface PermissionPipelineInput {
  tool: Tool<unknown, unknown, unknown>;
  toolInput: unknown;
  ctx: ToolPermissionContext;
}

export function runPermissionPipeline(
  input: PermissionPipelineInput
): Result<ToolPermissionLevel> {
  // Layer 0: Sandbox read-only enforcement
  if (input.ctx.readOnly) {
    return ok(input.tool.isReadOnly ? "allow" : "deny");
  }

  // Layer 1a: Conditional rule matching (more specific than name-based rules)
  const conditionalDecision = evaluateConditionalRules(
    input.tool.name,
    input.toolInput,
    input.ctx.conditionalRules
  );
  if (conditionalDecision !== null) {
    if (conditionalDecision === "deny") return ok("deny");
    // For ask/allow from conditional rules, still proceed through tool-specific and mode checks
    // so that bypass/plan modes and tool checks can still apply.
    const toolCheck = input.tool.checkPermissions(input.toolInput, input.ctx);
    if (!toolCheck.success) return toolCheck;

    let modeDecision: ToolPermissionLevel = conditionalDecision;
    if (input.ctx.mode === "bypass") {
      modeDecision = "allow";
    } else if (input.ctx.mode === "plan") {
      modeDecision = input.tool.isReadOnly ? "allow" : "ask";
    }

    const levels: ToolPermissionLevel[] = [modeDecision, toolCheck.data, conditionalDecision];
    if (levels.includes("deny")) return ok("deny");
    if (levels.includes("ask")) return ok("ask");
    return ok("allow");
  }

  // Layer 1b: Name-based rule matching
  const decision = evaluateRules(input.tool.name, input.ctx);
  if (decision === "deny") return ok("deny");

  // Layer 2: Tool-specific check
  const toolCheck = input.tool.checkPermissions(input.toolInput, input.ctx);
  if (!toolCheck.success) return toolCheck;

  // Layer 3: Mode override (applied before merging so bypass/plan can lift defaults)
  let modeDecision: ToolPermissionLevel = decision;
  if (input.ctx.mode === "bypass") {
    modeDecision = "allow";
  } else if (input.ctx.mode === "plan") {
    modeDecision = input.tool.isReadOnly ? "allow" : "ask";
  }

  // Layer 3a: Bash classifier safety net (downgrades allow -> ask for dangerous commands)
  let bashDecision: ToolPermissionLevel | null = null;
  const toolNameLower = input.tool.name.toLowerCase();
  if (toolNameLower === "bash" || toolNameLower === "shell") {
    const cmd = (input.toolInput as { command?: string } | undefined)?.command || "";
    const risk = classifyBashCommand(cmd);
    if (risk === "dangerous" || risk === "caution") {
      bashDecision = "ask";
    }
  }

  // Merge decisions: the most restrictive wins
  const levels: ToolPermissionLevel[] = [modeDecision, toolCheck.data];
  if (bashDecision) levels.push(bashDecision);
  if (levels.includes("deny")) return ok("deny");
  if (levels.includes("ask")) return ok("ask");

  return ok("allow");
}

// =============================================================================
// Subagent Tool Filtering (Claude Code pattern)
// =============================================================================

/** Tools that NO subagent is allowed to use. */
export const ALL_SUBAGENT_DISALLOWED_TOOLS = new Set<string>([
  "self_modify", // only the root agent can modify the system
  "rule_engine_override",
]);

/** Read-only tools safe for background/async subagents. */
export const ASYNC_SUBAGENT_ALLOWED_TOOLS = new Set<string>([
  "read_file",
  "search_web",
  "read_skill",
  "compress_trajectory",
]);

export function resolveSubagentTools(
  allTools: Tool<unknown, unknown, unknown>[],
  opts: {
    isAsync?: boolean;
    extraDenyList?: string[];
    permissionMode?: "strict" | "relaxed";
  }
): Tool<unknown, unknown, unknown>[] {
  let pool = allTools.filter((t) => !ALL_SUBAGENT_DISALLOWED_TOOLS.has(t.name));

  if (opts.isAsync) {
    pool = pool.filter(
      (t) => ASYNC_SUBAGENT_ALLOWED_TOOLS.has(t.name) || t.isReadOnly
    );
  }

  if (opts.extraDenyList) {
    pool = pool.filter((t) => !opts.extraDenyList!.includes(t.name));
  }

  if (opts.permissionMode === "strict") {
    pool = pool.filter((t) => t.isReadOnly);
  }

  return pool;
}
