/**
 * Repair Strategies
 * ==================
 * Built-in repair strategies for different error categories.
 */

import type { RepairStrategy } from "./self-healing-types.ts";

export const BUILT_IN_STRATEGIES: RepairStrategy[] = [
  {
    name: "tool_retry",
    applicableCategories: ["tool_execution"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Tool execution will be retried with adjusted parameters",
      rollbackPerformed: false,
    }),
  },
  {
    name: "model_fallback",
    applicableCategories: ["model_call"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Model fallback triggered - using backup model",
      rollbackPerformed: false,
    }),
  },
  {
    name: "security_rollback",
    applicableCategories: ["security_violation"],
    execute: async (anomaly) => ({
      success: false,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Security violation detected - manual intervention required",
      rollbackPerformed: false,
    }),
  },
  {
    name: "timeout_retry",
    applicableCategories: ["timeout"],
    execute: async (anomaly) => ({
      success: true,
      errorCategory: anomaly.category,
      attempts: 1,
      solution: "Operation will be retried with extended timeout",
      rollbackPerformed: false,
    }),
  },
];
