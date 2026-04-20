/**
 * Semantic Constitution Checker
 * =============================
 * Extends path-based constitution guard with:
 * - Case-insensitive protected path detection + distortion detection
 * - Impact chain analysis (config → infrastructure, auth → security)
 * - Change size limits (lines/files)
 * - Dangerous code pattern detection
 */

import { basename } from "path";
import { evaluateConstitutionGuard } from "../../core/constitution-guard.ts";

export type ViolationLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface ConstitutionViolation {
  article: string;
  level: ViolationLevel;
  message: string;
  location: string;
  autoFixable: boolean;
}

export interface SafetyCheckResult {
  passed: boolean;
  riskScore: number;
  violations: ConstitutionViolation[];
}

export interface CodeChange {
  filePath: string;
  operation: "write" | "patch" | "delete";
  content?: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface EvolutionSuggestion {
  filesChanged: string[];
  description: string;
  linesAdded: number;
  linesRemoved: number;
}

/** Protected paths (case-insensitive). */
const PROTECTED_PATHS: Record<string, string> = {
  bible: "constitution.self",
  constitution: "constitution.self",
  "rule-engine": "infrastructure.core",
  "permission-gate": "infrastructure.core",
  "tool-framework": "infrastructure.core",
};

/** Impact chain rules. */
const IMPACT_RULES = [
  {
    sources: ["config", "settings", "appConfig"],
    targets: ["event-bus", "event_bus", "hook", "supervisor", "orchestrator"],
    level: "HIGH" as ViolationLevel,
    message: "Config changes may affect core infrastructure",
  },
  {
    sources: ["auth", "permission", "security"],
    targets: ["security", "guard", "gate"],
    level: "CRITICAL" as ViolationLevel,
    message: "Auth changes may bypass security checks",
  },
  {
    sources: ["budget", "cost", "token"],
    targets: ["budget-guard", "evolution"],
    level: "HIGH" as ViolationLevel,
    message: "Budget changes may affect evolution safety",
  },
];

/** Dangerous code patterns (regex). */
const DANGEROUS_PATTERNS: Array<{ name: string; level: ViolationLevel; regex: RegExp; message: string }> = [
  {
    name: "eval",
    level: "CRITICAL",
    regex: /\beval\s*\(/i,
    message: "Dangerous eval() call detected",
  },
  {
    name: "exec",
    level: "CRITICAL",
    regex: /\bexec\s*\(/i,
    message: "Dangerous exec() call detected",
  },
  {
    name: "Function_constructor",
    level: "CRITICAL",
    regex: /\bnew\s+Function\s*\(/i,
    message: "Dynamic code execution via Function constructor",
  },
  {
    name: "shell_true",
    level: "HIGH",
    regex: /shell\s*:\s*true/i,
    message: "Shell=true in subprocess call",
  },
  {
    name: "auth_bypass",
    level: "CRITICAL",
    regex: /return\s+true\s*;?\s*\/\/.*skip.*auth|return\s+true\s*;?\s*\/\/.*bypass/i,
    message: "Possible auth bypass pattern",
  },
  {
    name: "disable_logging",
    level: "HIGH",
    regex: /logger\.disabled\s*=\s*true|logging\s*=\s*false/i,
    message: "Logging disabled",
  },
];


function isDistortedBibleName(path: string): boolean {
  const base = basename(path);
  const withoutExt = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const name = withoutExt.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["bible", "b1ble", "constitution"].includes(name);
}

export class SemanticConstitutionChecker {
  private maxLinesPerChange = 500;
  private maxFilesPerChange = 10;

  check(codeChange: CodeChange): SafetyCheckResult {
    const violations: ConstitutionViolation[] = [];

    // 1. Base constitution guard (path rules)
    const baseResult = evaluateConstitutionGuard(
      codeChange.filePath,
      codeChange.operation,
      codeChange.content
    );
    if (!baseResult.success) {
      violations.push({
        article: "Base Constitution",
        level: "CRITICAL",
        message: baseResult.error?.message ?? "Constitution violation",
        location: codeChange.filePath,
        autoFixable: false,
      });
    }

    // 2. Protected path checks (case-insensitive + distortion)
    violations.push(...this._checkProtectedPaths(codeChange));

    // 3. Dangerous pattern detection
    if (codeChange.content) {
      violations.push(...this._checkDangerousPatterns(codeChange));
    }

    // 4. Change size limits
    violations.push(...this._checkChangeSize(codeChange));

    const riskScore = this._calculateRiskScore(violations);
    const critical = violations.filter((v) => v.level === "CRITICAL");

    return {
      passed: critical.length === 0,
      riskScore,
      violations,
    };
  }

  checkEvolution(suggestion: EvolutionSuggestion): SafetyCheckResult {
    const violations: ConstitutionViolation[] = [];

    // Check all changed files
    for (const file of suggestion.filesChanged) {
      const change: CodeChange = {
        filePath: file,
        operation: "patch",
        linesAdded: suggestion.linesAdded,
        linesRemoved: suggestion.linesRemoved,
      };
      const result = this.check(change);
      violations.push(...result.violations);
    }

    // 5. Impact chain analysis
    violations.push(...this._checkImpactChain(suggestion));

    // 6. Aggregate change size
    const totalLines = suggestion.linesAdded + suggestion.linesRemoved;
    if (totalLines > this.maxLinesPerChange) {
      violations.push({
        article: "Change Control",
        level: "HIGH",
        message: `Total change ${totalLines} lines exceeds threshold (${this.maxLinesPerChange})`,
        location: "aggregate",
        autoFixable: false,
      });
    }
    if (suggestion.filesChanged.length > this.maxFilesPerChange) {
      violations.push({
        article: "Change Control",
        level: "MEDIUM",
        message: `${suggestion.filesChanged.length} files changed, recommend splitting`,
        location: "aggregate",
        autoFixable: false,
      });
    }

    // Deduplicate by message
    const seen = new Set<string>();
    const unique = violations.filter((v) => {
      if (seen.has(v.message)) return false;
      seen.add(v.message);
      return true;
    });

    const riskScore = this._calculateRiskScore(unique);
    const critical = unique.filter((v) => v.level === "CRITICAL");

    return {
      passed: critical.length === 0,
      riskScore,
      violations: unique,
    };
  }

  private _checkProtectedPaths(change: CodeChange): ConstitutionViolation[] {
    const violations: ConstitutionViolation[] = [];
    const pathLower = change.filePath.toLowerCase();

    for (const [protectedName, reason] of Object.entries(PROTECTED_PATHS)) {
      if (pathLower.includes(protectedName)) {
        violations.push({
          article: "Article 3: Constitution is Immutable",
          level: "CRITICAL",
          message: `Protected path detected: ${change.filePath} (${reason})`,
          location: change.filePath,
          autoFixable: false,
        });
      }
    }

    if (isDistortedBibleName(change.filePath)) {
      violations.push({
        article: "Article 3: Constitution is Immutable",
        level: "CRITICAL",
        message: `Distorted protected name detected: ${change.filePath}`,
        location: change.filePath,
        autoFixable: false,
      });
    }

    return violations;
  }

  private _checkDangerousPatterns(change: CodeChange): ConstitutionViolation[] {
    const violations: ConstitutionViolation[] = [];
    if (!change.content) return violations;

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.regex.test(change.content)) {
        violations.push({
          article: "Security Baseline",
          level: pattern.level,
          message: pattern.message,
          location: `${change.filePath}:pattern`,
          autoFixable: false,
        });
      }
    }

    return violations;
  }

  private _checkChangeSize(change: CodeChange): ConstitutionViolation[] {
    const violations: ConstitutionViolation[] = [];
    const total = change.linesAdded + change.linesRemoved;

    if (total > this.maxLinesPerChange) {
      violations.push({
        article: "Change Control",
        level: "HIGH",
        message: `Change size ${total} lines exceeds threshold (${this.maxLinesPerChange})`,
        location: change.filePath,
        autoFixable: false,
      });
    }

    return violations;
  }

  private _checkImpactChain(suggestion: EvolutionSuggestion): ConstitutionViolation[] {
    const violations: ConstitutionViolation[] = [];
    const filesLower = suggestion.filesChanged.map((f) => f.toLowerCase());

    for (const rule of IMPACT_RULES) {
      const sourcesFound = rule.sources.filter((s) => filesLower.some((f) => f.includes(s)));
      const targetsFound = rule.targets.filter((t) => filesLower.some((f) => f.includes(t)));

      if (sourcesFound.length > 0 && targetsFound.length > 0) {
        violations.push({
          article: "Security Baseline",
          level: rule.level,
          message: rule.message,
          location: sourcesFound.join(", "),
          autoFixable: false,
        });
      }
    }

    return violations;
  }

  private _calculateRiskScore(violations: ConstitutionViolation[]): number {
    const weights: Record<ViolationLevel, number> = { CRITICAL: 100, HIGH: 50, MEDIUM: 20, LOW: 5 };
    let score = 0;
    for (const v of violations) {
      score += weights[v.level] ?? 0;
    }
    return Math.min(1000, score);
  }
}

export const semanticConstitutionChecker = new SemanticConstitutionChecker();
