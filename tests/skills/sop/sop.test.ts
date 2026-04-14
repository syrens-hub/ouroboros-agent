import { describe, it, expect } from "vitest";
import {
  SOPWorkflow,
  run_sop_workflow,
  defaultSOPTemplates,
} from "../../../skills/sop/index.ts";
import type { SOPDefinition } from "../../../skills/sop/index.ts";
import type { ToolCallContext } from "../../../types/index.ts";

describe("SOPWorkflow", () => {
  it("executes a linear SOP", async () => {
    const definition: SOPDefinition = {
      id: "linear_test",
      name: "linear_test",
      roles: ["user"],
      steps: [
        {
          id: "step1",
          type: "input",
          role: "user",
          description: "First step",
          next: "step2",
        },
        {
          id: "step2",
          type: "process",
          role: "user",
          description: "Second step",
          next: "step3",
        },
        {
          id: "step3",
          type: "output",
          role: "user",
          description: "Final step",
        },
      ],
    };

    const workflow = new SOPWorkflow(definition);
    const compiled = workflow.compile();
    const result = await compiled.invoke({ outputs: {} });

    expect(result.outputs.step1).toMatchObject({
      role: "user",
      description: "First step",
      completed: true,
    });
    expect(result.outputs.step2).toMatchObject({
      role: "user",
      description: "Second step",
      completed: true,
    });
    expect(result.outputs.step3).toMatchObject({
      role: "user",
      description: "Final step",
      completed: true,
    });
  });

  it("follows conditional branching", async () => {
    const definition: SOPDefinition = {
      id: "conditional_test",
      name: "conditional_test",
      roles: ["user"],
      steps: [
        {
          id: "start",
          type: "process",
          role: "user",
          description: "Start",
          next: "branch",
        },
        {
          id: "branch",
          type: "conditional",
          role: "user",
          description: "Branch point",
          condition: (outputs) =>
            (outputs.start as { path?: string })?.path ?? "left",
          next: { left: "left", right: "right" },
        },
        {
          id: "left",
          type: "process",
          role: "user",
          description: "Left path",
        },
        {
          id: "right",
          type: "process",
          role: "user",
          description: "Right path",
        },
      ],
    };

    const workflow = new SOPWorkflow(definition);

    const leftResult = await workflow.compile().invoke({
      outputs: { start: { path: "left" } },
    });
    expect(leftResult.outputs.left).toBeDefined();
    expect(leftResult.outputs.right).toBeUndefined();

    const rightResult = await workflow.compile().invoke({
      outputs: { start: { path: "right" } },
    });
    expect(rightResult.outputs.right).toBeDefined();
    expect(rightResult.outputs.left).toBeUndefined();
  });

  it("runs parallel steps concurrently", async () => {
    const definition: SOPDefinition = {
      id: "parallel_test",
      name: "parallel_test",
      roles: ["user"],
      steps: [
        {
          id: "start",
          type: "process",
          role: "user",
          description: "Start",
          next: "parallel_parent",
        },
        {
          id: "parallel_parent",
          type: "parallel",
          role: "user",
          description: "Parallel split",
          next: ["branch_a", "branch_b"],
        },
        {
          id: "branch_a",
          type: "process",
          role: "user",
          description: "Branch A",
          next: "end",
        },
        {
          id: "branch_b",
          type: "process",
          role: "user",
          description: "Branch B",
          next: "end",
        },
        {
          id: "end",
          type: "output",
          role: "user",
          description: "End",
        },
      ],
    };

    const workflow = new SOPWorkflow(definition);
    const compiled = workflow.compile();
    const result = await compiled.invoke({ outputs: {} });

    expect(result.outputs.branch_a).toMatchObject({
      role: "user",
      description: "Branch A",
      completed: true,
    });
    expect(result.outputs.branch_b).toMatchObject({
      role: "user",
      description: "Branch B",
      completed: true,
    });
    expect(result.outputs.end).toMatchObject({
      role: "user",
      description: "End",
      completed: true,
    });
  });
});

describe("run_sop_workflow tool", () => {
  it("compiles and runs an SOP via the tool", async () => {
    const definition: SOPDefinition = {
      id: "tool_test",
      name: "tool_test",
      roles: ["user"],
      steps: [
        {
          id: "a",
          type: "input",
          role: "user",
          description: "Step A",
          next: "b",
        },
        {
          id: "b",
          type: "output",
          role: "user",
          description: "Step B",
        },
      ],
    };

    const ctx: ToolCallContext<unknown> = {
      taskId: "test-task",
      abortSignal: new AbortController().signal,
      reportProgress: () => {},
      invokeSubagent: (async () => ({})) as unknown as ToolCallContext<unknown>["invokeSubagent"],
    };

    const result = await run_sop_workflow.call(
      { definition, initialState: { outputs: {} } },
      ctx,
    );

    expect(result).toEqual({
      success: true,
      outputs: expect.objectContaining({
        a: expect.objectContaining({ completed: true }),
        b: expect.objectContaining({ completed: true }),
      }),
    });
  });
});

describe("defaultSOPTemplates", () => {
  it("includes code_review template", () => {
    const template = defaultSOPTemplates.find((t) => t.name === "code_review");
    expect(template).toBeDefined();
    expect(template?.roles).toContain("developer");
    expect(template?.roles).toContain("reviewer");
  });

  it("includes customer_support_handoff template", () => {
    const template = defaultSOPTemplates.find(
      (t) => t.name === "customer_support_handoff",
    );
    expect(template).toBeDefined();
    expect(template?.roles).toContain("bot");
    expect(template?.roles).toContain("agent");
  });
});
