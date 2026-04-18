/**
 * Safety Controls
 * ===============
 * Evolution safety mechanisms:
 * - EvolutionLock: mutex to prevent concurrent evolution
 * - ChangeFreezePeriod: cooldown after evolution
 * - BudgetController: daily/monthly spending caps
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { getBudgetStatus } from "../budget-guard/index.ts";

// ─── Evolution Lock ─────────────────────────────────────────────────────────

export class EvolutionLock {
  private locked = false;
  private owner: string | null = null;

  acquire(ownerId: string): boolean {
    if (this.locked) return false;
    this.locked = true;
    this.owner = ownerId;
    return true;
  }

  release(ownerId: string): boolean {
    if (!this.locked || this.owner !== ownerId) return false;
    this.locked = false;
    this.owner = null;
    return true;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getOwner(): string | null {
    return this.owner;
  }
}

export const evolutionLock = new EvolutionLock();

// ─── Change Freeze Period ───────────────────────────────────────────────────

export interface FreezeState {
  frozen: boolean;
  lastEvolutionAt: number | null;
  remainingHours: number;
}

export class ChangeFreezePeriod {
  private freezeHours: number;
  private lastEvolutionAt: number | null = null;

  constructor(freezeHours = 24) {
    this.freezeHours = freezeHours;
  }

  recordEvolution(): void {
    this.lastEvolutionAt = Date.now();
  }

  isFrozen(): boolean {
    if (!this.lastEvolutionAt) return false;
    const elapsedHours = (Date.now() - this.lastEvolutionAt) / (1000 * 60 * 60);
    return elapsedHours < this.freezeHours;
  }

  getState(): FreezeState {
    if (!this.lastEvolutionAt) {
      return { frozen: false, lastEvolutionAt: null, remainingHours: 0 };
    }
    const elapsedHours = (Date.now() - this.lastEvolutionAt) / (1000 * 60 * 60);
    const remaining = Math.max(0, this.freezeHours - elapsedHours);
    return {
      frozen: remaining > 0,
      lastEvolutionAt: this.lastEvolutionAt,
      remainingHours: Math.round(remaining * 100) / 100,
    };
  }

  setFreezeHours(hours: number): void {
    this.freezeHours = hours;
  }

  reset(): void {
    this.lastEvolutionAt = null;
  }
}

export const changeFreezePeriod = new ChangeFreezePeriod();

// ─── Budget Controller ──────────────────────────────────────────────────────

export interface BudgetControllerConfig {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

export function initSafetyControlTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_spending (
      date TEXT PRIMARY KEY,
      spent REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS monthly_spending (
      month TEXT PRIMARY KEY,
      spent REAL NOT NULL DEFAULT 0
    );
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initSafetyControlTables(db);
}

export class BudgetController {
  private dailyLimit: number;
  private monthlyLimit: number;

  constructor(config?: Partial<BudgetControllerConfig>) {
    this.dailyLimit = config?.dailyLimitUsd ?? 5.0;
    this.monthlyLimit = config?.monthlyLimitUsd ?? 50.0;
  }

  /** Record a spending event and check if within budget. */
  recordSpend(amountUsd: number): boolean {
    if (!this.checkBudget(amountUsd)) return false;

    ensureInitialized();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    // Upsert daily
    db.prepare(
      `INSERT INTO daily_spending (date, spent) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET spent = spent + excluded.spent`
    ).run(today, amountUsd);

    // Upsert monthly
    db.prepare(
      `INSERT INTO monthly_spending (month, spent) VALUES (?, ?)
       ON CONFLICT(month) DO UPDATE SET spent = spent + excluded.spent`
    ).run(thisMonth, amountUsd);

    return true;
  }

  /** Check if a proposed operation would exceed budget. */
  checkBudget(proposedCost = 0): boolean {
    ensureInitialized();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    const dailyRow = db.prepare(`SELECT spent FROM daily_spending WHERE date = ?`).get(today) as { spent: number } | undefined;
    const monthlyRow = db.prepare(`SELECT spent FROM monthly_spending WHERE month = ?`).get(thisMonth) as { spent: number } | undefined;

    const dailySpent = dailyRow?.spent ?? 0;
    const monthlySpent = monthlyRow?.spent ?? 0;

    return dailySpent + proposedCost <= this.dailyLimit && monthlySpent + proposedCost <= this.monthlyLimit;
  }

  getStatus(): {
    dailyLimit: number;
    monthlyLimit: number;
    dailySpent: number;
    monthlySpent: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    withinBudget: boolean;
  } {
    ensureInitialized();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    const dailyRow = db.prepare(`SELECT spent FROM daily_spending WHERE date = ?`).get(today) as { spent: number } | undefined;
    const monthlyRow = db.prepare(`SELECT spent FROM monthly_spending WHERE month = ?`).get(thisMonth) as { spent: number } | undefined;

    const dailySpent = dailyRow?.spent ?? 0;
    const monthlySpent = monthlyRow?.spent ?? 0;

    return {
      dailyLimit: this.dailyLimit,
      monthlyLimit: this.monthlyLimit,
      dailySpent,
      monthlySpent,
      dailyRemaining: Math.max(0, this.dailyLimit - dailySpent),
      monthlyRemaining: Math.max(0, this.monthlyLimit - monthlySpent),
      withinBudget: dailySpent <= this.dailyLimit && monthlySpent <= this.monthlyLimit,
    };
  }

  setLimits(config: Partial<BudgetControllerConfig>): void {
    if (config.dailyLimitUsd !== undefined) this.dailyLimit = config.dailyLimitUsd;
    if (config.monthlyLimitUsd !== undefined) this.monthlyLimit = config.monthlyLimitUsd;
  }
}

export const budgetController = new BudgetController();
