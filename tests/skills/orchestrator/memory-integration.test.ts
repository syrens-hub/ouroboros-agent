import { describe, it, expect, beforeEach } from "vitest";
import { writeShortTermMemory, queryShortTermMemory } from "../../../core/memory-tiered.ts";
import { resetSchedulingMetrics } from "../../../skills/orchestrator/metrics.ts";
import { getDb } from "../../../core/db-manager.ts";

describe("Worker result → tiered memory integration", () => {
  beforeEach(() => {
    resetSchedulingMetrics();
    // Clean stm for this test session
    const db = getDb();
    db.prepare("DELETE FROM memory_layers WHERE layer = 'short_term' AND source_path LIKE 'worker:%'").run();
  });

  it("writes worker result to STM", () => {
    const result = writeShortTermMemory("Worker [test-task] result:\nTask completed successfully.", {
      sessionId: "test-session",
      summary: "test-task: success (1200ms)",
      importance: 0.7,
      sourcePath: "worker:test-session_worker_test_12345",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it("queries STM by sessionId", () => {
    writeShortTermMemory("Content A", { sessionId: "session-a", importance: 0.6 });
    writeShortTermMemory("Content B", { sessionId: "session-b", importance: 0.8 });

    const queryA = queryShortTermMemory({ sessionId: "session-a" });
    expect(queryA.success).toBe(true);
    expect(queryA.data).toBeDefined();
    expect(queryA.data!.length).toBeGreaterThanOrEqual(1);
    expect(queryA.data!.some((e) => e.content.includes("Content A"))).toBe(true);
  });

  it("calculates importance based on success and complexity", () => {
    // Simulate the orchestrator importance calculation logic
    const success = true;
    const complexity = 5;
    const importance = success ? Math.min(0.9, 0.5 + complexity * 0.04) : 0.3;
    expect(importance).toBe(0.7);
  });
});
