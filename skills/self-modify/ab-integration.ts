/**
 * A/B Test Integration for Self-Modification
 * ==========================================
 * Hooks the A/B test framework into the evolution pipeline so that every
 * approved code mutation is automatically canaried with a small traffic
 * split before full rollout.
 *
 * Usage:
 *   import { createEvolutionABTest } from "./ab-integration.ts";
 *   const test = createEvolutionABTest(evolutionId, targetModule, abTestFramework);
 */

import type { ABTestFramework } from "../../core/ab-test.ts";
import { abTestingConfig } from "../../core/config-extension.ts";

export interface EvolutionABTestInput {
  evolutionId: string;
  targetModule?: string;
  controlVersion?: string;
  treatmentVersion?: string;
  trafficSplit?: number;
}

export function createEvolutionABTest(
  input: EvolutionABTestInput,
  framework: ABTestFramework
): { testId: string; started: boolean } | null {
  if (!abTestingConfig.enabled) {
    return null;
  }

  const test = framework.createTest({
    name: `Evolution ${input.evolutionId}`,
    controlVersion: input.controlVersion || "v0.9.0",
    treatmentVersion: input.treatmentVersion || `v0.9.0-${input.evolutionId}`,
    trafficSplit: input.trafficSplit ?? abTestingConfig.defaultTrafficSplit,
    targetModule: input.targetModule,
  });

  framework.startTest(test.id);

  return { testId: test.id, started: true };
}

/**
 * Check whether a running A/B test should be auto-rolled back based on
 * error-rate differential.
 */
export function checkAutoRollback(
  testId: string,
  framework: ABTestFramework
): { shouldRollback: boolean; reason?: string } {
  if (!abTestingConfig.enabled) {
    return { shouldRollback: false };
  }

  const test = framework.getTest(testId);
  if (!test || test.status !== "running") {
    return { shouldRollback: false };
  }

  const controlErrorRate = test.metrics.controlRequests > 0
    ? test.metrics.controlErrors / test.metrics.controlRequests
    : 0;
  const treatmentErrorRate = test.metrics.treatmentRequests > 0
    ? test.metrics.treatmentErrors / test.metrics.treatmentRequests
    : 0;

  const diff = treatmentErrorRate - controlErrorRate;
  if (diff > abTestingConfig.autoRollbackThreshold) {
    return {
      shouldRollback: true,
      reason: `Treatment error rate (${treatmentErrorRate.toFixed(3)}) exceeds control (${controlErrorRate.toFixed(3)}) by ${diff.toFixed(3)} > threshold ${abTestingConfig.autoRollbackThreshold}`,
    };
  }

  return { shouldRollback: false };
}
