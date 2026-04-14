import { describe, it, expect } from "vitest";
import { Crew, runCrewTaskTool } from "../../../skills/crewai/index.ts";
import type { CrewAgentRole, CrewTask } from "../../../skills/crewai/index.ts";

describe("CrewAI Framework", () => {
  it("runs sequential process with 3 tasks", async () => {
    const roles: CrewAgentRole[] = [
      {
        name: "researcher",
        backstory: "A researcher",
        goal: "Research",
        allowDelegation: false,
        toolsWhitelist: [],
      },
      {
        name: "writer",
        backstory: "A writer",
        goal: "Write",
        allowDelegation: false,
        toolsWhitelist: [],
      },
      {
        name: "editor",
        backstory: "An editor",
        goal: "Edit",
        allowDelegation: false,
        toolsWhitelist: [],
      },
    ];

    const tasks: CrewTask[] = [
      {
        id: "task_1",
        description: "Research topic",
        expectedOutput: "Research output",
        agentRole: "researcher",
      },
      {
        id: "task_2",
        description: "Write article",
        expectedOutput: "Article draft",
        agentRole: "writer",
        dependencies: ["task_1"],
      },
      {
        id: "task_3",
        description: "Edit article",
        expectedOutput: "Final article",
        agentRole: "editor",
        dependencies: ["task_2"],
      },
    ];

    const crew = new Crew(roles, tasks, "sequential");
    const result = await crew.run("Create an article");

    expect(result.results.task_1).toBe("Result for task_1");
    expect(result.results.task_2).toBe("Result for task_2");
    expect(result.results.task_3).toBe("Result for task_3");
    expect(result.finalOutput).toBe(
      "task_1: Result for task_1\ntask_2: Result for task_2\ntask_3: Result for task_3",
    );
  });

  it("runs parallel process with 2 independent tasks", async () => {
    const roles: CrewAgentRole[] = [
      {
        name: "agent_a",
        backstory: "Agent A",
        goal: "Do A",
        allowDelegation: false,
        toolsWhitelist: [],
      },
      {
        name: "agent_b",
        backstory: "Agent B",
        goal: "Do B",
        allowDelegation: false,
        toolsWhitelist: [],
      },
    ];

    const tasks: CrewTask[] = [
      {
        id: "task_a",
        description: "Task A",
        expectedOutput: "Output A",
        agentRole: "agent_a",
      },
      {
        id: "task_b",
        description: "Task B",
        expectedOutput: "Output B",
        agentRole: "agent_b",
      },
    ];

    const crew = new Crew(roles, tasks, "parallel");
    const result = await crew.run("Do both tasks");

    expect(result.results.task_a).toBe("Result for task_a");
    expect(result.results.task_b).toBe("Result for task_b");
  });

  it("runs hierarchical process with manager revision loop", async () => {
    const roles: CrewAgentRole[] = [
      {
        name: "worker",
        backstory: "A worker",
        goal: "Work",
        allowDelegation: false,
        toolsWhitelist: [],
      },
    ];

    const tasks: CrewTask[] = [
      {
        id: "task_1",
        description: "Do work",
        expectedOutput: "Work output",
        agentRole: "worker",
      },
    ];

    let reviewCount = 0;
    const crew = new Crew(roles, tasks, "hierarchical", {
      managerReview: () => {
        reviewCount++;
        if (reviewCount < 3) {
          return { revise: true, finalOutput: "Needs revision" };
        }
        return { revise: false, finalOutput: "Approved" };
      },
    });

    const result = await crew.run("Do work");
    expect(reviewCount).toBe(3);
    expect(result.results.task_1).toBe("Result for task_1");
    expect(result.finalOutput).toBe("Approved");
  });

  it("run_crew_task tool creates and runs a crew", async () => {
    const roles: CrewAgentRole[] = [
      {
        name: "analyzer",
        backstory: "An analyzer",
        goal: "Analyze",
        allowDelegation: false,
        toolsWhitelist: [],
      },
    ];

    const result = await runCrewTaskTool.call(
      { task: "Analyze data", roles, process: "sequential" },
      {
        taskId: "test-task",
        abortSignal: new AbortController().signal,
        reportProgress: () => {},
        invokeSubagent: async () => ({}) as never,
      },
    );

    expect(result.success).toBe(true);
    expect(result.finalOutput).toContain("Result for task_1");
  });
});
