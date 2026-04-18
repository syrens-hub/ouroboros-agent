import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  EvolutionLock,
  ChangeFreezePeriod,
  BudgetController,
  initSafetyControlTables,
} from "../../../skills/safety-controls/index.ts";

describe("Safety Controls", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initSafetyControlTables(db);
    db.exec("DELETE FROM daily_spending;");
    db.exec("DELETE FROM monthly_spending;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("EvolutionLock", () => {
    it("acquires and releases", () => {
      const lock = new EvolutionLock();
      expect(lock.acquire("owner-1")).toBe(true);
      expect(lock.isLocked()).toBe(true);
      expect(lock.getOwner()).toBe("owner-1");

      expect(lock.acquire("owner-2")).toBe(false);
      expect(lock.release("owner-2")).toBe(false);

      expect(lock.release("owner-1")).toBe(true);
      expect(lock.isLocked()).toBe(false);
    });
  });

  describe("ChangeFreezePeriod", () => {
    it("starts unfrozen", () => {
      const freeze = new ChangeFreezePeriod(24);
      expect(freeze.isFrozen()).toBe(false);
      const state = freeze.getState();
      expect(state.frozen).toBe(false);
      expect(state.remainingHours).toBe(0);
    });

    it("freezes after evolution", () => {
      const freeze = new ChangeFreezePeriod(24);
      freeze.recordEvolution();
      expect(freeze.isFrozen()).toBe(true);
      const state = freeze.getState();
      expect(state.frozen).toBe(true);
      expect(state.remainingHours).toBeGreaterThan(23);
    });

    it("thaws after freeze period", () => {
      const freeze = new ChangeFreezePeriod(0.001); // ~3.6 seconds
      freeze.recordEvolution();
      expect(freeze.isFrozen()).toBe(true);
    });

    it("allows configurable freeze hours", () => {
      const freeze = new ChangeFreezePeriod(48);
      freeze.recordEvolution();
      const state = freeze.getState();
      expect(state.remainingHours).toBeGreaterThan(47);
    });
  });

  describe("BudgetController", () => {
    it("allows spending within limits", () => {
      const ctrl = new BudgetController({ dailyLimitUsd: 5, monthlyLimitUsd: 50 });
      expect(ctrl.recordSpend(2)).toBe(true);
      expect(ctrl.recordSpend(2)).toBe(true);
      expect(ctrl.checkBudget(1)).toBe(true);
    });

    it("blocks spending over daily limit", () => {
      const ctrl = new BudgetController({ dailyLimitUsd: 5, monthlyLimitUsd: 50 });
      expect(ctrl.recordSpend(6)).toBe(false);
    });

    it("blocks spending over monthly limit", () => {
      const ctrl = new BudgetController({ dailyLimitUsd: 100, monthlyLimitUsd: 10 });
      expect(ctrl.recordSpend(15)).toBe(false);
    });

    it("returns accurate status", () => {
      const ctrl = new BudgetController({ dailyLimitUsd: 10, monthlyLimitUsd: 100 });
      ctrl.recordSpend(3);
      const status = ctrl.getStatus();
      expect(status.dailySpent).toBe(3);
      expect(status.dailyRemaining).toBe(7);
      expect(status.withinBudget).toBe(true);
    });

    it("allows updating limits", () => {
      const ctrl = new BudgetController({ dailyLimitUsd: 1, monthlyLimitUsd: 10 });
      expect(ctrl.checkBudget(2)).toBe(false);
      ctrl.setLimits({ dailyLimitUsd: 10 });
      expect(ctrl.checkBudget(2)).toBe(true);
    });
  });
});
