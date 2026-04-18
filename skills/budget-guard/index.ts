/**
 * Ouroboros Budget Guard v2
 * ==========================
 * Tiered budget protection with four levels:
 *   normal  (<80%): full speed
 *   warning (80-90%): reduce frequency, block non-essential
 *   limited (90-98%): force cheap models, block evolution
 *   halted  (>98%): pause all, keep monitor only
 */

import { getGlobalTokenUsage } from "../../core/repositories/token-usage.ts";
import { getLLMMetrics } from "../../core/llm-metrics.ts";

// Simplified price estimate: $0.000002 per token (~$2 / 1M tokens)
const AVG_USD_PER_TOKEN = 0.000002;

export type BudgetTier = "normal" | "warning" | "limited" | "halted";

export interface BudgetStatus {
  totalBudget: number;
  usedEstimate: number;
  remainingPercent: number;
  tier: BudgetTier;
  /** @deprecated Use `tier` instead. Kept for backward compatibility. */
  status: "ok" | "warning" | "critical";
  llmCalls24h: number;
  tokenUsage24h: number;
  backgroundLoopCost: number;
  evolutionCost: number;
}

export interface BudgetPolicy {
  allowEvolution: boolean;
  allowBackgroundLoop: boolean;
  allowExpensiveModels: boolean;
  allowNonEssentialTools: boolean;
  maxBackgroundIntervalMs: number;
}

const _TIER_THRESHOLDS: Record<BudgetTier, number> = {
  normal: 80,
  warning: 90,
  limited: 98,
  halted: 100,
};

function getTier(remainingPercent: number): BudgetTier {
  if (remainingPercent <= 2) return "halted";
  if (remainingPercent <= 10) return "limited";
  if (remainingPercent <= 20) return "warning";
  return "normal";
}

/** In-memory cost tracker for background loops and evolution. */
let backgroundLoopCostAccumulated = 0;
let evolutionCostAccumulated = 0;

export function recordBackgroundLoopCost(tokens: number): void {
  backgroundLoopCostAccumulated += tokens * AVG_USD_PER_TOKEN;
}

export function recordEvolutionCost(tokens: number): void {
  evolutionCostAccumulated += tokens * AVG_USD_PER_TOKEN;
}

export function resetCostTracking(): void {
  backgroundLoopCostAccumulated = 0;
  evolutionCostAccumulated = 0;
}

export function getBudgetStatus(): BudgetStatus {
  const totalBudget = parseFloat(process.env.TOTAL_BUDGET || "0") || 0;
  const tokenUsage24h = getGlobalTokenUsage(Date.now() - 24 * 60 * 60 * 1000);
  const llmMetrics = getLLMMetrics();
  const usedEstimate = tokenUsage24h * AVG_USD_PER_TOKEN;

  let remainingPercent = 100;
  if (totalBudget > 0) {
    remainingPercent = Math.max(0, Math.min(100, 100 - (usedEstimate / totalBudget) * 100));
  }

  const tier = getTier(remainingPercent);
  const status: "ok" | "warning" | "critical" =
    tier === "normal" ? "ok" : tier === "warning" ? "warning" : "critical";

  return {
    totalBudget,
    usedEstimate: Math.round(usedEstimate * 100) / 100,
    remainingPercent: Math.round(remainingPercent * 100) / 100,
    tier,
    status,
    llmCalls24h: llmMetrics.callCount,
    tokenUsage24h,
    backgroundLoopCost: Math.round(backgroundLoopCostAccumulated * 100) / 100,
    evolutionCost: Math.round(evolutionCostAccumulated * 100) / 100,
  };
}

export function getBudgetPolicy(status?: BudgetStatus): BudgetPolicy {
  const s = status || getBudgetStatus();
  switch (s.tier) {
    case "normal":
      return {
        allowEvolution: true,
        allowBackgroundLoop: true,
        allowExpensiveModels: true,
        allowNonEssentialTools: true,
        maxBackgroundIntervalMs: 60_000,
      };
    case "warning":
      return {
        allowEvolution: true,
        allowBackgroundLoop: true,
        allowExpensiveModels: false,
        allowNonEssentialTools: false,
        maxBackgroundIntervalMs: 300_000,
      };
    case "limited":
      return {
        allowEvolution: false,
        allowBackgroundLoop: true,
        allowExpensiveModels: false,
        allowNonEssentialTools: false,
        maxBackgroundIntervalMs: 600_000,
      };
    case "halted":
      return {
        allowEvolution: false,
        allowBackgroundLoop: false,
        allowExpensiveModels: false,
        allowNonEssentialTools: false,
        maxBackgroundIntervalMs: Infinity,
      };
  }
}

/** Legacy compat: true when halted or limited (blocks non-readonly ops). */
export function isBudgetCritical(): boolean {
  const tier = getBudgetStatus().tier;
  return tier === "limited" || tier === "halted";
}

/** True when halted — everything except monitoring should stop. */
export function isBudgetHalted(): boolean {
  return getBudgetStatus().tier === "halted";
}
