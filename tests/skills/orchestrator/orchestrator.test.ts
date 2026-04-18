import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getWorkerRunnerStats,
  startWorkerIdleCleanup,
  stopWorkerIdleCleanup,
  createDelegateTaskTool,
} from "../../../skills/orchestrator/index.ts";

describe("Orchestrator", () => {
  afterEach(() => {
    stopWorkerIdleCleanup();
    vi.useRealTimers();
  });

  describe("Worker Runner Stats", () => {
    it("returns empty stats initially", () => {
      const stats = getWorkerRunnerStats();
      expect(stats.total).toBe(0);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.queuedWorkers).toBe(0);
      expect(stats.ids).toHaveLength(0);
    });
  });

  describe("Idle Cleanup", () => {
    it("starts and stops cleanup timer", () => {
      startWorkerIdleCleanup(1000);
      // Should not throw
      stopWorkerIdleCleanup();
      // Double stop should be safe
      stopWorkerIdleCleanup();
    });

    it("idempotent start", () => {
      startWorkerIdleCleanup(1000);
      startWorkerIdleCleanup(1000); // second call should be no-op
      stopWorkerIdleCleanup();
    });
  });

  describe("Delegate Task Tool", () => {
    it("creates delegate task tool with correct metadata", () => {
      const tool = createDelegateTaskTool({
        getGlobalTools: () => [],
        getLLMConfig: () => undefined,
      });
      expect(tool.name).toBe("delegate_task");
      expect(tool.isReadOnly).toBe(false);
      expect(typeof tool.isConcurrencySafe).toBe("function");
      expect((tool.isConcurrencySafe as (input: unknown) => boolean)({})).toBe(false);
    });
  });
});
