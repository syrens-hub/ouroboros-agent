import { describe, it, expect } from "vitest";
import { AgentPool, ResultAggregator, createPlannerDispatcher, runMultiAgentTask } from "../../skills/multi-agent/index.ts";
import { createAgentLoopRunner, createMockLLMCaller } from "../../skills/agent-loop/index.ts";
import type { AgentRole } from "../../types/index.ts";

describe("Multi-Agent Framework", () => {
  it("AgentPool registers and retrieves agents", () => {
    const pool = new AgentPool();
    const role: AgentRole = { name: "executor", description: "Exec", allowedTools: [] };
    const runner = createAgentLoopRunner({ sessionId: "test", tools: [], llmCaller: createMockLLMCaller() });
    pool.register(role, runner);
    expect(pool.get("executor")?.role.name).toBe("executor");
    expect(pool.list().length).toBe(1);
    expect(pool.remove("executor")).toBe(true);
    expect(pool.remove("executor")).toBe(false);
  });

  it("ResultAggregator joins multiple results", async () => {
    const agg = new ResultAggregator();
    const result = await agg.aggregate([
      { taskId: "t1", role: "executor", output: "Step 1 done", status: "success" },
      { taskId: "t2", role: "reviewer", output: "Looks good", status: "success" },
      { taskId: "t3", role: "planner", output: "OOM", status: "failure" },
    ]);
    expect(result).toContain("Step 1 done");
    expect(result).toContain("Looks good");
    expect(result).toContain("OOM");
    expect(result).toContain("Total subtasks: 3");
  });

  it("PlannerDispatcher returns subtasks from LLM JSON", async () => {
    const dispatcher = createPlannerDispatcher(createMockLLMCaller());
    const pool = new AgentPool();
    const tasks = await dispatcher.dispatch("hello", pool);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].role).toBeTruthy();
    expect(tasks[0].prompt).toBeTruthy();
  });

  it("runMultiAgentTask executes with mock runners", async () => {
    const pool = new AgentPool();
    const role: AgentRole = { name: "executor", description: "Exec", allowedTools: [] };
    const runner = createAgentLoopRunner({ sessionId: "ma_test", tools: [], llmCaller: createMockLLMCaller() });
    pool.register(role, runner);

    const dispatcher = createPlannerDispatcher(createMockLLMCaller());
    const agg = new ResultAggregator();
    const result = await runMultiAgentTask("hello", pool, dispatcher, agg);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
