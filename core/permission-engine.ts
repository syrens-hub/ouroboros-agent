/**
 * Permission Engine v2
 * ====================
 * Multi-source rule engine with project-level persistence.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ToolPermissionLevel } from "../types/index.ts";

export interface PermissionRule {
  source: "cli" | "project" | "session" | "settings";
  behavior: "allow" | "deny" | "ask";
  pattern: string; // exact tool name or glob like "file_*"
  toolPattern?: string;
}

export interface PermissionEngineConfig {
  mode: "interactive" | "autonomous" | "bypass" | "readOnly" | "plan";
  rules: PermissionRule[];
}

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

export function evaluatePermissionRules(
  toolName: string,
  rules: PermissionRule[]
): ToolPermissionLevel | null {
  // Rules are evaluated in order; first match wins.
  // Caller should order from most specific to least specific.
  for (const rule of rules) {
    if (rule.toolPattern && !matchPattern(toolName, rule.toolPattern)) continue;
    if (matchPattern(toolName, rule.pattern)) {
      return rule.behavior;
    }
  }
  return null;
}

export function loadProjectRules(projectRoot: string): PermissionRule[] {
  const path = join(projectRoot, ".ouroboros", "permissions.json");
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { rules?: PermissionRule[] };
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch {
    return [];
  }
}

export function buildPermissionEngineConfig(
  projectRoot: string,
  sessionRules: PermissionRule[] = [],
  mode: PermissionEngineConfig["mode"] = "interactive"
): PermissionEngineConfig {
  const projectRules = loadProjectRules(projectRoot);
  return {
    mode,
    rules: [
      ...sessionRules,
      ...projectRules,
    ],
  };
}
