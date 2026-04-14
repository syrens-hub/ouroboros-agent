import { z } from "zod";
import { StateGraph, CompiledStateGraph } from "../../core/state-graph.ts";
import { buildTool } from "../../core/tool-framework.ts";

export type SOPStepType =
  | "input"
  | "process"
  | "review"
  | "output"
  | "conditional"
  | "parallel";

export type SOPStep = {
  id: string;
  type: SOPStepType;
  role: string;
  description: string;
  expectedOutputSchema?: Record<string, unknown>;
  next?: string | string[] | Record<string, string>;
  condition?: (outputs: Record<string, unknown>) => string;
};

export type SOPDefinition = {
  id: string;
  name: string;
  roles: string[];
  steps: SOPStep[];
  defaultStep?: string;
};

export type SOPState = {
  outputs: Record<string, unknown>;
};

export class SOPWorkflow {
  private definition: SOPDefinition;

  constructor(definition: SOPDefinition) {
    this.definition = definition;
  }

  compile(): CompiledStateGraph<SOPState> {
    const graph = new StateGraph<SOPState>();

    for (const step of this.definition.steps) {
      graph.addNode(step.id, this.createStepFn(step));
    }

    for (const step of this.definition.steps) {
      if (step.type === "conditional" && step.condition) {
        const mappings = step.next as Record<string, string> | undefined;
        if (mappings) {
          graph.addConditionalEdge(
            step.id,
            (state) => step.condition!(state.outputs),
            mappings,
          );
        }
      } else if (step.type === "parallel" && Array.isArray(step.next)) {
        const childIds = step.next as string[];
        for (const childId of childIds) {
          graph.addEdge(step.id, childId);
        }
        graph.addParallel(childIds, (states) => ({
          outputs: states.reduce<Record<string, unknown>>(
            (acc, s) => ({ ...acc, ...s.outputs }),
            {},
          ),
        }));
      } else if (typeof step.next === "string") {
        graph.addEdge(step.id, step.next);
      }
    }

    const entryStepId = this.definition.defaultStep ?? this.definition.steps[0]?.id;
    if (!entryStepId) {
      throw new Error("SOP has no steps");
    }

    graph.addNode("__start__", (state) => state);
    graph.addEdge("__start__", entryStepId);

    return graph.compile();
  }

  private createStepFn(step: SOPStep): (state: SOPState) => SOPState {
    return (state) => {
      const existing = (state.outputs[step.id] as Record<string, unknown>) ?? {};
      const result = {
        ...existing,
        role: step.role,
        description: step.description,
        completed: true,
        timestamp: Date.now(),
      };
      return {
        outputs: {
          ...state.outputs,
          [step.id]: result,
        },
      };
    };
  }
}

const RunSOPWorkflowInputSchema = z.object({
  definition: z.custom<SOPDefinition>(),
  initialState: z.record(z.unknown()).optional(),
});

export const run_sop_workflow = buildTool({
  name: "run_sop_workflow",
  description: "Compile and execute a Standard Operating Procedure workflow",
  inputSchema: RunSOPWorkflowInputSchema,
  call: async ({ definition, initialState }) => {
    const workflow = new SOPWorkflow(definition);
    const compiled = workflow.compile();
    const result = await compiled.invoke({
      outputs: {},
      ...(initialState ?? {}),
    });
    return {
      success: true,
      outputs: result.outputs,
    };
  },
});

export const defaultSOPTemplates: SOPDefinition[] = [
  {
    id: "code_review",
    name: "code_review",
    roles: ["developer", "reviewer"],
    steps: [
      {
        id: "submit",
        type: "input",
        role: "developer",
        description: "Submit code for review",
        next: "review",
      },
      {
        id: "review",
        type: "process",
        role: "reviewer",
        description: "Review the submitted code",
        next: "decision",
      },
      {
        id: "decision",
        type: "conditional",
        role: "reviewer",
        description: "Approve or request changes",
        condition: (outputs) =>
          (outputs.decision as { approved?: boolean })?.approved
            ? "approve"
            : "reject",
        next: { approve: "merge", reject: "revise" },
      },
      {
        id: "revise",
        type: "process",
        role: "developer",
        description: "Address review feedback",
        next: "review",
      },
      {
        id: "merge",
        type: "output",
        role: "reviewer",
        description: "Merge approved code",
      },
    ],
  },
  {
    id: "customer_support_handoff",
    name: "customer_support_handoff",
    roles: ["bot", "agent", "supervisor"],
    steps: [
      {
        id: "intake",
        type: "input",
        role: "bot",
        description: "Collect customer issue details",
        next: "triage",
      },
      {
        id: "triage",
        type: "conditional",
        role: "bot",
        description: "Route issue to appropriate resolver",
        condition: (outputs) =>
          (outputs.triage as { route?: string })?.route ?? "agent",
        next: {
          bot: "resolve_bot",
          agent: "resolve_agent",
          supervisor: "resolve_supervisor",
        },
      },
      {
        id: "resolve_bot",
        type: "process",
        role: "bot",
        description: "Attempt automated resolution",
        next: "confirm",
      },
      {
        id: "resolve_agent",
        type: "process",
        role: "agent",
        description: "Agent resolves the issue",
        next: "confirm",
      },
      {
        id: "resolve_supervisor",
        type: "process",
        role: "supervisor",
        description: "Supervisor resolves the issue",
        next: "confirm",
      },
      {
        id: "confirm",
        type: "output",
        role: "bot",
        description: "Confirm resolution with customer",
      },
    ],
  },
];
