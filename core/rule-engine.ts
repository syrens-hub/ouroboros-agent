/**
 * Ouroboros Rule Engine
 * =====================
 * THE ONLY IMMUTABLE COMPONENT IN THE SYSTEM.
 *
 * This file guards the single meta-rule:
 *   "The system is allowed to modify itself, but every modification
 *    must pass through the Rule Engine's boundary checks."
 *
 * Nothing else in core/ or skills/ is sacred. Even the agent loop is a Skill.
 * But this file is the floor. If you change it, you break the ouroboros.
 */

import { resolve, sep } from "path";
import type {
  Result,
  ModificationRequest,
  ModificationType,
  ToolPermissionLevel,
} from "../types/index.ts";
import { ok, err } from "../types/index.ts";

// =============================================================================
// Immutable Meta-Rules
// =============================================================================

/** The single axiom of the system. */
export const META_RULE_AXIOM =
  "The system is allowed to modify itself, but every modification must pass through the Rule Engine's boundary checks.";

/** Core files that require extra scrutiny (can be evolved, but never silently). */
const CORE_PROTECTED_PATHS = [
  "core/rule-engine.ts",
  "core/tool-framework.ts",
  "core/permission-gate.ts",
];

function normalizePath(p: string): string {
  try {
    return resolve(p);
  } catch (e) {
    // Fail-closed: an unresolvable path is invalid and must not bypass checks.
    throw new Error(`Invalid path provided to Rule Engine: ${p}. ${String(e)}`);
  }
}

function pathEndsWith(p: string, suffix: string): boolean {
  const normalized = normalizePath(p);
  const suffixParts = suffix.split("/");
  const parts = normalized.split(sep);
  if (parts.length < suffixParts.length) return false;
  for (let i = 0; i < suffixParts.length; i++) {
    if (parts[parts.length - suffixParts.length + i] !== suffixParts[i]) {
      return false;
    }
  }
  return true;
}

/** Modification types that are permitted without human confirmation under safe conditions. */
const AUTO_PERMITTED_TYPES: ModificationType[] = [
  "skill_create",
  "skill_patch",
  "skill_delete",
];

/** Modification types that ALWAYS require human confirmation, no matter the estimated risk. */
const ALWAYS_HUMAN_CONFIRM_TYPES: ModificationType[] = [
  "loop_replace",
  "rule_engine_override",
];

/** The rule engine itself can only be overridden in emergency, and only with human confirmation. */
const IMMUTABLE_PATH = "core/rule-engine.ts";

// =============================================================================
// Rule Engine Interface
// =============================================================================

export interface RuleEngine {
  /**
   * Evaluate a self-modification request.
   * Returns the decision: allow, ask, or deny.
   * This is the ONLY gate through which the system may mutate its own code.
   */
  evaluateModification(req: ModificationRequest): Result<ToolPermissionLevel>;

  /**
   * Check if a file path touches the immutable rule engine.
   */
  isImmutablePath(filePath: string): boolean;

  /**
   * Serialize the current rule set for persistence/audit.
   */
  exportRules(): string;
}

// =============================================================================
// Default Rule Engine Implementation
// =============================================================================

export function createRuleEngine(): RuleEngine {
  return {
    evaluateModification(req): Result<ToolPermissionLevel> {
      // --- Axiom enforcement -------------------------------------------------
      // Any request that bypasses this engine is denied.
      // The engine itself is the sole arbiter.

      // --- Type-based routing ------------------------------------------------
      if (ALWAYS_HUMAN_CONFIRM_TYPES.includes(req.type)) {
        return ok("ask");
      }

      if (!AUTO_PERMITTED_TYPES.includes(req.type) && req.type !== "core_evolve") {
        return err({
          code: "RULE_UNKNOWN_TYPE",
          message: `Modification type '${req.type}' is not recognized by the Rule Engine.`,
        });
      }

      // --- Risk-based gating -------------------------------------------------
      if (req.estimatedRisk === "critical") {
        return ok("ask");
      }

      if (req.estimatedRisk === "high" && req.type === "core_evolve") {
        return ok("ask");
      }

      // --- Path-based gating -------------------------------------------------
      const targetPath = req.targetPath || (req.proposedChanges?.targetPath as string | undefined);
      if (targetPath && pathEndsWith(targetPath, IMMUTABLE_PATH)) {
        // The immutable path can only be touched via "rule_engine_override".
        if (req.type !== "rule_engine_override") {
          return err({
            code: "RULE_IMMUTABLE",
            message: `The path '${targetPath}' is immutable. Use 'rule_engine_override' only in emergency.`,
          });
        }
        return ok("ask");
      }

      // --- Content-based safety heuristics -----------------------------------
      const rationale = req.rationale.toLowerCase();
      const forbiddenPatterns = [
        "delete all",
        "wipe",
        "disable rule engine",
        "bypass rule engine",
        "remove safety checks",
      ];
      // Exact word/token matching instead of loose substring to reduce false positives
      const tokens = rationale.split(/[^a-z0-9\u4e00-\u9fff]+/);
      const tokenSet = new Set(tokens);
      for (const pattern of forbiddenPatterns) {
        const patternTokens = pattern.split(/[^a-z0-9\u4e00-\u9fff]+/);
        // For multi-word patterns, check contiguous token sequence
        if (patternTokens.length > 1) {
          for (let i = 0; i <= tokens.length - patternTokens.length; i++) {
            if (patternTokens.every((pt, idx) => tokens[i + idx] === pt)) {
              return ok("ask");
            }
          }
        } else if (tokenSet.has(patternTokens[0])) {
          return ok("ask");
        }
      }

      // --- Auto-allow safe modifications -------------------------------------
      return ok("allow");
    },

    isImmutablePath(filePath: string): boolean {
      return pathEndsWith(filePath, IMMUTABLE_PATH);
    },

    exportRules(): string {
      return JSON.stringify(
        {
          axiom: META_RULE_AXIOM,
          immutablePath: IMMUTABLE_PATH,
          autoPermittedTypes: AUTO_PERMITTED_TYPES,
          alwaysHumanConfirmTypes: ALWAYS_HUMAN_CONFIRM_TYPES,
          coreProtectedPaths: CORE_PROTECTED_PATHS,
          version: "1.0.0",
        },
        null,
        2
      );
    },
  };
}

/** Global singleton rule engine instance. */
export const defaultRuleEngine: RuleEngine = createRuleEngine();
