import { describe, it, expect } from "vitest";
import { runWorkerDag, createDelegateDagTool } from "../../../skills/orchestrator/dag.ts";
import type { DagTask, WorkerResult } from "../../../skills/orchestrator/index.ts";

describe("runWorkerDag", () => {
  async function fakeRunTask(task: DagTask, injectedDescription: string): Promise<WorkerResult> {
    return {
      success: true,
      finalAnswer: `Done: ${task.id} with "${injectedDescription.slice(0, 30)}"`,
      executionLog: [],
      metrics: { durationMs: 100, turnCount: 1 },
      status: "completed",
    };
  }

  it("executes a single task", async () => {
    const result = await runWorkerDag("session-1", [{ id: "a", taskName: "a", taskDescription: "Do A" }], fakeRunTask);
    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe("a");
  });

  it("executes linear dependencies in order", async () => {
    const order: string[] = [];
    const result = await runWorkerDag(
      "session-1",
      [
        { id: "a", taskName: "a", taskDescription: "Do A" },
        { id: "b", taskName: "b", taskDescription: "Do B: {{result:a}}", dependsOn: ["a"] },
        { id: "c", taskName: "c", taskDescription: "Do C: {{result:b}}", dependsOn: ["b"] },
      ],
      async (task, injected) => {
        order.push(task.id);
        return {
          success: true,
          finalAnswer: injected,
          executionLog: [],
          metrics: { durationMs: 10, turnCount: 1 },
          status: "completed",
        };
      }
    );
    expect(result.success).toBe(true);
    expect(order).toEqual(["a", "b", "c"]);
    const bTask = result.tasks.find((t) => t.id === "b")!;
    expect(bTask.result.finalAnswer).toContain("Do A"); // upstream result injected
  });

  it("executes parallel tasks when no dependencies", async () => {
    const starts: number[] = [];
    const result = await runWorkerDag(
      "session-1",
      [
        { id: "a", taskName: "a", taskDescription: "Do A" },
        { id: "b", taskName: "b", taskDescription: "Do B" },
        { id: "c", taskName: "c", taskDescription: "Do C" },
      ],
      async (task) => {
        starts.push(Date.now());
        // Tiny delay to ensure overlap
        await new Promise((r) => setTimeout(r, 10));
        return {
          success: true,
          finalAnswer: `result-${task.id}`,
          executionLog: [],
          metrics: { durationMs: 10, turnCount: 1 },
          status: "completed",
        };
      }
    );
    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(3);
    // All three started within a tight window (parallel)
    const spread = Math.max(...starts) - Math.min(...starts);
    expect(spread).toBeLessThan(50);
  });

  it("injects dependency results into placeholders", async () => {
    const result = await runWorkerDag(
      "session-1",
      [
        { id: "research", taskName: "research", taskDescription: "Research topic" },
        { id: "write", taskName: "write", taskDescription: "Write based on: {{result:research}}", dependsOn: ["research"] },
      ],
      async (task, injected) => {
        return {
          success: true,
          finalAnswer: injected,
          executionLog: [],
          metrics: { durationMs: 10, turnCount: 1 },
          status: "completed",
        };
      }
    );
    const writeTask = result.tasks.find((t) => t.id === "write")!;
    expect(writeTask.result.finalAnswer).toContain("Research topic");
  });

  it("detects cycles and throws", async () => {
    await expect(
      runWorkerDag(
        "session-1",
        [
          { id: "a", taskName: "a", taskDescription: "Do A", dependsOn: ["b"] },
          { id: "b", taskName: "b", taskDescription: "Do B", dependsOn: ["a"] },
        ],
        fakeRunTask
      )
    ).rejects.toThrow("Cycle detected");
  });

  it("detects unknown dependencies", async () => {
    await expect(
      runWorkerDag(
        "session-1",
        [{ id: "a", taskName: "a", taskDescription: "Do A", dependsOn: ["missing"] }],
        fakeRunTask
      )
    ).rejects.toThrow("Unknown dependency");
  });

  it("marks overall success false when any task fails", async () => {
    const result = await runWorkerDag(
      "session-1",
      [
        { id: "a", taskName: "a", taskDescription: "Do A" },
        { id: "b", taskName: "b", taskDescription: "Do B", dependsOn: ["a"] },
      ],
      async (task) => {
        if (task.id === "a") {
          throw new Error("Task A failed");
        }
        return {
          success: true,
          finalAnswer: "ok",
          executionLog: [],
          metrics: { durationMs: 10, turnCount: 1 },
          status: "completed",
        };
      }
    );
    expect(result.success).toBe(false);
    expect(result.tasks.find((t) => t.id === "a")!.success).toBe(false);
  });

  it("returns empty success for empty tasks", async () => {
    const result = await runWorkerDag("session-1", [], fakeRunTask);
    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(0);
  });
});

describe("createDelegateDagTool", () => {
  it("creates tool with correct metadata", () => {
    const tool = createDelegateDagTool({
      getGlobalTools: () => [],
      getLLMConfig: () => undefined,
      runWorker: async () => ({
        success: true,
        finalAnswer: "ok",
        executionLog: [],
        metrics: { durationMs: 10, turnCount: 1 },
        status: "completed",
      }),
    });
    expect(tool.name).toBe("delegate_dag");
    expect(tool.isReadOnly).toBe(false);
    expect(tool.costProfile).toBeDefined();
  });
});
