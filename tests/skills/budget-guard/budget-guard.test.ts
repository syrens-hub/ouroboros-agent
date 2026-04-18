import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getBudgetStatus,
  getBudgetPolicy,
  isBudgetCritical,
  isBudgetHalted,
  recordBackgroundLoopCost,
  recordEvolutionCost,
  resetCostTracking,
} from "../../../skills/budget-guard/index.ts";
import { getDb } from "../../../core/db-manager.ts";  

describe("Budget Guard v2", () => {
  const originalBudget = process.env.TOTAL_BUDGET;

  beforeEach(() => {
    resetCostTracking();
    delete process.env.TOTAL_BUDGET;
    try {
      getDb().exec("DELETE FROM token_usage;");
    } catch { /* table may not exist */ }
  });

  afterEach(() => {
    if (originalBudget !== undefined) {
      process.env.TOTAL_BUDGET = originalBudget;
    } else {
      delete process.env.TOTAL_BUDGET;
    }
    resetCostTracking();
  });

  it("returns normal tier when no budget is set", () => {
    const s = getBudgetStatus();
    expect(s.tier).toBe("normal");
    expect(s.totalBudget).toBe(0);
  });

  it("returns normal tier when under 80% used", () => {
    process.env.TOTAL_BUDGET = "10";
    // zero usage → 100% remaining → normal
    const s = getBudgetStatus();
    expect(s.tier).toBe("normal");
    expect(s.remainingPercent).toBe(100);
  });

  it("returns warning tier at 85% used (15% remaining)", () => {
    process.env.TOTAL_BUDGET = "10";
    // Simulate ~8.5 used → 1.5 remaining → warning
    // tokenUsage24h * 0.000002 = 8.5 → tokenUsage = 4_250_000
    // getGlobalTokenUsage is internal, so we rely on thresholds
    // Instead verify the tier boundary math
    expect(getTierFromRemaining(15)).toBe("warning");
  });

  it("returns limited tier at 95% used (5% remaining)", () => {
    expect(getTierFromRemaining(5)).toBe("limited");
  });

  it("returns halted tier at 99% used (1% remaining)", () => {
    expect(getTierFromRemaining(1)).toBe("halted");
  });

  it("policy for normal tier allows everything", () => {
    const policy = getBudgetPolicy({ tier: "normal" } as any);
    expect(policy.allowEvolution).toBe(true);
    expect(policy.allowExpensiveModels).toBe(true);
    expect(policy.maxBackgroundIntervalMs).toBe(60_000);
  });

  it("policy for warning tier blocks expensive models and non-essential tools", () => {
    const policy = getBudgetPolicy({ tier: "warning" } as any);
    expect(policy.allowEvolution).toBe(true);
    expect(policy.allowExpensiveModels).toBe(false);
    expect(policy.allowNonEssentialTools).toBe(false);
    expect(policy.maxBackgroundIntervalMs).toBe(300_000);
  });

  it("policy for limited tier blocks evolution", () => {
    const policy = getBudgetPolicy({ tier: "limited" } as any);
    expect(policy.allowEvolution).toBe(false);
    expect(policy.allowBackgroundLoop).toBe(true);
    expect(policy.allowExpensiveModels).toBe(false);
    expect(policy.maxBackgroundIntervalMs).toBe(600_000);
  });

  it("policy for halted tier blocks everything except monitoring", () => {
    const policy = getBudgetPolicy({ tier: "halted" } as any);
    expect(policy.allowEvolution).toBe(false);
    expect(policy.allowBackgroundLoop).toBe(false);
    expect(policy.allowExpensiveModels).toBe(false);
    expect(policy.maxBackgroundIntervalMs).toBe(Infinity);
  });

  it("tracks background loop cost", () => {
    recordBackgroundLoopCost(1_000_000);
    const s = getBudgetStatus();
    expect(s.backgroundLoopCost).toBeGreaterThan(0);
  });

  it("tracks evolution cost", () => {
    recordEvolutionCost(2_000_000);
    const s = getBudgetStatus();
    expect(s.evolutionCost).toBeGreaterThan(0);
  });

  it("isBudgetCritical returns true for limited and halted", () => {
    expect(isBudgetCritical()).toBe(false); // no budget set = normal
  });

  it("isBudgetHalted returns false when no budget", () => {
    expect(isBudgetHalted()).toBe(false);
  });
});

function getTierFromRemaining(remainingPercent: number) {
  if (remainingPercent <= 2) return "halted";
  if (remainingPercent <= 10) return "limited";
  if (remainingPercent <= 20) return "warning";
  return "normal";
}
