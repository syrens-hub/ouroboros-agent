/**
 * Permission Engine v2
 * ====================
 * 4-Level ACL with immutable rule stacking:
 *   L0 System  — hard-coded, non-bypassable safety rules
 *   L1 Policy  — project-level .ouroboros/permissions-v2.json
 *   L2 Session — ephemeral session overrides
 *   L3 Tool    — individual tool checkPermissions()
 *
 * Evaluation: L0 → L1 → L2 → L3. Most restrictive wins.
 * deny > ask > allow.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Tool, ToolPermissionContext, ToolPermissionLevel } from "../types/index.ts";
import { safeJsonParse } from "./safe-utils.ts";
import { logger } from "./logger.ts";
import { getDb } from "./db-manager.ts";
import { hookRegistry } from "./hook-system.ts";
import { incCounter } from "../skills/telemetry-v2/metrics-registry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionLevel = 0 | 1 | 2 | 3;

export interface ACLRule {
  level: PermissionLevel;
  pattern: string; // exact name or glob
  behavior: ToolPermissionLevel;
  condition?: {
    path: string;
    operator: "equals" | "contains" | "startsWith" | "endsWith" | "regex" | "gt" | "lt";
    value: string | number;
  };
  reason?: string;
}

export interface PermissionAuditEntry {
  id?: number;
  timestamp: number;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  decision: ToolPermissionLevel;
  level: PermissionLevel;
  reason: string;
}

export interface PermissionCheckResult {
  decision: ToolPermissionLevel;
  level: PermissionLevel;
  reason: string;
  rule?: ACLRule;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export function initPermissionV2Tables(db = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_audit_log_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input_json TEXT,
      decision TEXT NOT NULL,
      level INTEGER NOT NULL,
      reason TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perm_audit_session ON permission_audit_log_v2(session_id);
    CREATE INDEX IF NOT EXISTS idx_perm_audit_timestamp ON permission_audit_log_v2(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_perm_audit_tool ON permission_audit_log_v2(tool_name);
  `);
}

function logPermissionAudit(entry: PermissionAuditEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO permission_audit_log_v2 (session_id, tool_name, tool_input_json, decision, level, reason, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.sessionId,
    entry.toolName,
    JSON.stringify(entry.toolInput),
    entry.decision,
    entry.level,
    entry.reason ?? null,
    entry.timestamp
  );
}

// ---------------------------------------------------------------------------
// Glob Matching
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const regexStr = "^" + escapeRegExp(pattern).replace(/\\\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

function matchPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;
  return globToRegex(pattern).test(toolName);
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

function evaluateCondition(actual: unknown, operator: NonNullable<ACLRule["condition"]>["operator"], expected: string | number): boolean {
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
      try {
        const regex = new RegExp(expectedStr, "i");
        return regex.test(actualStr);
      } catch {
        return false;
      }
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

// ---------------------------------------------------------------------------
// Level 0: System Rules (non-bypassable)
// ---------------------------------------------------------------------------

const SYSTEM_RULES: ACLRule[] = [
  { level: 0, pattern: "self_modify", behavior: "deny", reason: "System rule: self-modification restricted" },
  { level: 0, pattern: "rule_engine_override", behavior: "deny", reason: "System rule: rule override prohibited" },
  {
    level: 0,
    pattern: "bash",
    behavior: "deny",
    condition: { path: "command", operator: "regex", value: "rm +-rf +/" },
    reason: "System rule: destructive recursive delete blocked",
  },
  {
    level: 0,
    pattern: "shell",
    behavior: "deny",
    condition: { path: "command", operator: "regex", value: "rm +-rf +/" },
    reason: "System rule: destructive recursive delete blocked",
  },
  {
    level: 0,
    pattern: "write_file",
    behavior: "deny",
    condition: { path: "path", operator: "regex", value: "/etc/(passwd|shadow|sudoers)" },
    reason: "System rule: system credential files protected",
  },
  {
    level: 0,
    pattern: "write_file",
    behavior: "deny",
    condition: { path: "path", operator: "regex", value: "/\\.ssh/id_(rsa|dsa|ecdsa|ed25519)" },
    reason: "System rule: SSH keys protected",
  },
  {
    level: 0,
    pattern: "write_file",
    behavior: "deny",
    condition: { path: "path", operator: "regex", value: "/\\.aws/credentials" },
    reason: "System rule: AWS credentials protected",
  },
];

export function getSystemRules(): readonly ACLRule[] {
  return SYSTEM_RULES;
}

// ---------------------------------------------------------------------------
// Level 1: Policy Rules (project-level file)
// ---------------------------------------------------------------------------

let _policyRules: ACLRule[] = [];
let _policyRulesLoaded = false;

export function loadPolicyRules(projectRoot: string): ACLRule[] {
  const path = join(projectRoot, ".ouroboros", "permissions-v2.json");
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = safeJsonParse<{ rules?: ACLRule[] }>(raw, "load policy rules");
    if (Array.isArray(parsed?.rules)) {
      // Validate levels are within 1-2 (policy/session)
      return parsed.rules.filter((r) => r.level >= 1 && r.level <= 2);
    }
    return [];
  } catch (e) {
    logger.warn("Failed to load policy rules", { path, error: String(e) });
    return [];
  }
}

export function refreshPolicyRules(projectRoot: string): void {
  _policyRules = loadPolicyRules(projectRoot).map((r) => ({ ...r, level: 1 }));
  _policyRulesLoaded = true;
  logger.info("Permission policy rules refreshed", { count: _policyRules.length });
}

export function getPolicyRules(): readonly ACLRule[] {
  return _policyRules;
}

// ---------------------------------------------------------------------------
// Level 2: Session Rules (in-memory, ephemeral)
// ---------------------------------------------------------------------------

const sessionRules = new Map<string, ACLRule[]>();

export function setSessionRules(sessionId: string, rules: ACLRule[]): void {
  sessionRules.set(sessionId, rules.map((r) => ({ ...r, level: 2 })));
}

export function clearSessionRules(sessionId: string): void {
  sessionRules.delete(sessionId);
}

export function getSessionRules(sessionId: string): readonly ACLRule[] {
  return sessionRules.get(sessionId) ?? [];
}

// ---------------------------------------------------------------------------
// Rule Evaluation
// ---------------------------------------------------------------------------

function evaluateRule(toolName: string, toolInput: unknown, rule: ACLRule): boolean {
  if (!matchPattern(toolName, rule.pattern)) return false;
  if (rule.condition) {
    const actual = getValueByPath(toolInput, rule.condition.path);
    return evaluateCondition(actual, rule.condition.operator, rule.condition.value);
  }
  return true;
}

function evaluateLevel(
  level: PermissionLevel,
  rules: readonly ACLRule[],
  toolName: string,
  toolInput: unknown
): PermissionCheckResult | null {
  for (const rule of rules) {
    if (evaluateRule(toolName, toolInput, rule)) {
      return {
        decision: rule.behavior,
        level,
        reason: rule.reason || `Matched ${rule.pattern} at level ${level}`,
        rule,
      };
    }
  }
  return null;
}

function mostRestrictive(a: ToolPermissionLevel, b: ToolPermissionLevel): ToolPermissionLevel {
  const order: Record<ToolPermissionLevel, number> = { allow: 0, ask: 1, deny: 2 };
  return order[a] >= order[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Permission Engine v2 — Main Entry Point
// ---------------------------------------------------------------------------

export interface PermissionEngineV2Input {
  tool: Tool<unknown, unknown, unknown>;
  toolInput: unknown;
  sessionId: string;
  projectRoot: string;
  mode?: ToolPermissionContext["mode"];
  readOnly?: boolean;
}

/**
 * Run the full 4-level permission check.
 * Returns the final decision with metadata about which level made it.
 */
export function checkPermissionV2(input: PermissionEngineV2Input): PermissionCheckResult {
  const { tool, toolInput, sessionId, projectRoot, mode = "interactive", readOnly = false } = input;

  // Lazy-load policy rules
  if (!_policyRulesLoaded) {
    refreshPolicyRules(projectRoot);
  }

  // Layer 0: System rules (non-bypassable)
  const systemResult = evaluateLevel(0, SYSTEM_RULES, tool.name, toolInput);
  if (systemResult) {
    if (systemResult.decision === "deny") {
      logAndMetrics(input, systemResult);
      return systemResult;
    }
  }

  // Read-only sandbox (overrides everything except system deny)
  if (readOnly) {
    if (tool.isReadOnly) {
      const roResult: PermissionCheckResult = { decision: "allow", level: 0, reason: "Read-only sandbox: read tools allowed" };
      logAndMetrics(input, roResult);
      return roResult;
    }
    const roDeny: PermissionCheckResult = { decision: "deny", level: 0, reason: "Read-only sandbox: write tools denied" };
    logAndMetrics(input, roDeny);
    return roDeny;
  }

  // Start with tool's own decision as default (L3)
  const toolCheck = tool.checkPermissions(toolInput, {
    alwaysAllowRules: [],
    alwaysDenyRules: [],
    alwaysAskRules: [],
    mode,
    source: "session",
    readOnly,
  });

  if (!toolCheck.success) {
    const failResult: PermissionCheckResult = { decision: "deny", level: 3, reason: `Tool check failed: ${toolCheck.error.message}` };
    logAndMetrics(input, failResult);
    return failResult;
  }

  let result: PermissionCheckResult = {
    decision: toolCheck.data,
    level: 3,
    reason: "Tool-specific check",
  };

  // Layer 1: Policy rules can upgrade/downgrade
  const policyResult = evaluateLevel(1, _policyRules, tool.name, toolInput);
  if (policyResult) {
    result = {
      decision: mostRestrictive(result.decision, policyResult.decision),
      level: 1,
      reason: policyResult.reason,
      rule: policyResult.rule,
    };
    if (result.decision === "deny") {
      logAndMetrics(input, result);
      return result;
    }
  }

  // Layer 2: Session rules can upgrade/downgrade
  const sessionResult = evaluateLevel(2, getSessionRules(sessionId), tool.name, toolInput);
  if (sessionResult) {
    result = {
      decision: mostRestrictive(result.decision, sessionResult.decision),
      level: 2,
      reason: sessionResult.reason,
      rule: sessionResult.rule,
    };
    if (result.decision === "deny") {
      logAndMetrics(input, result);
      return result;
    }
  }

  // Apply system allow result if it was the only match at L0
  if (systemResult) {
    result = {
      decision: mostRestrictive(result.decision, systemResult.decision),
      level: 0,
      reason: systemResult.reason,
      rule: systemResult.rule,
    };
  }

  // Mode overrides (bypass/plan) — but never override system deny
  if (mode === "bypass" && result.level !== 0) {
    result = { decision: "allow", level: result.level, reason: "Bypass mode override" };
  } else if (mode === "plan" && result.level !== 0) {
    result = {
      decision: tool.isReadOnly ? "allow" : mostRestrictive(result.decision, "ask"),
      level: result.level,
      reason: "Plan mode override",
    };
  }

  logAndMetrics(input, result);
  return result;
}

function logAndMetrics(input: PermissionEngineV2Input, result: PermissionCheckResult): void {
  logPermissionAudit({
    sessionId: input.sessionId,
    toolName: input.tool.name,
    toolInput: input.toolInput,
    decision: result.decision,
    level: result.level,
    reason: result.reason,
    timestamp: Date.now(),
  });

  incCounter("ouroboros_permission_checks_total", {
    tool: input.tool.name,
    decision: result.decision,
    level: String(result.level),
  });
}

// ---------------------------------------------------------------------------
// Permission Audit Query
// ---------------------------------------------------------------------------

export function getPermissionAudits(
  filter?: { sessionId?: string; toolName?: string; limit?: number }
): Array<{
  id: number;
  session_id: string;
  tool_name: string;
  tool_input_json: string | null;
  decision: string;
  level: number;
  reason: string | null;
  timestamp: number;
}> {
  const db = getDb();
  const limit = filter?.limit ?? 50;

  if (filter?.sessionId && filter?.toolName) {
    return rowsAs(
      db
        .prepare(
          `SELECT * FROM permission_audit_log_v2 WHERE session_id = ? AND tool_name = ? ORDER BY timestamp DESC LIMIT ?`
        )
        .all(filter.sessionId, filter.toolName, limit)
    );
  }
  if (filter?.sessionId) {
    return rowsAs(
      db.prepare(`SELECT * FROM permission_audit_log_v2 WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`).all(filter.sessionId, limit)
    );
  }
  if (filter?.toolName) {
    return rowsAs(
      db.prepare(`SELECT * FROM permission_audit_log_v2 WHERE tool_name = ? ORDER BY timestamp DESC LIMIT ?`).all(filter.toolName, limit)
    );
  }
  return rowsAs(db.prepare(`SELECT * FROM permission_audit_log_v2 ORDER BY timestamp DESC LIMIT ?`).all(limit));
}

export function prunePermissionAudits(olderThanMs: number): number {
  const db = getDb();
  const cutoff = Date.now() - olderThanMs;
  return rowCount(db.prepare("DELETE FROM permission_audit_log_v2 WHERE timestamp < ?").run(cutoff));
}

// ---------------------------------------------------------------------------
// Hook Integration
// ---------------------------------------------------------------------------

export function initPermissionV2Hooks(): void {
  hookRegistry.register("session:create", (_event, ctx) => {
    const sessionId = ctx.sessionId;
    if (sessionId) {
      // Initialize empty session rules on creation
      setSessionRules(sessionId, []);
    }
  });

  hookRegistry.register("session:close", (_event, ctx) => {
    const sessionId = ctx.sessionId;
    if (sessionId) {
      clearSessionRules(sessionId);
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initPermissionEngineV2(projectRoot: string): void {
  initPermissionV2Tables();
  refreshPolicyRules(projectRoot);
  initPermissionV2Hooks();
  logger.info("Permission Engine v2 initialized", { projectRoot, systemRules: SYSTEM_RULES.length });
}

// Import helpers at bottom to avoid circular issues
import { rowsAs, rowCount } from "./db-utils.ts";
