import { z } from "zod";
import { StateGraph } from "../../core/state-graph.ts";
import { buildTool } from "../../core/tool-framework.ts";

export interface CrewAgentRole {
  name: string;
  backstory: string;
  goal: string;
  allowDelegation: boolean;
  toolsWhitelist: string[];
  systemPrompt?: string;
}

export interface CrewTask {
  id: string;
  description: string;
  expectedOutput: string;
  agentRole: string;
  dependencies?: string[];
  toolsWhitelist?: string[];
}

export type CrewProcess = "sequential" | "hierarchical" | "parallel";

interface CrewState {
  results: Record<string, string>;
  context: string;
  loopCount: number;
  finalOutput: string;
  revise?: boolean;
}

function topologicalSort(tasks: CrewTask[]): CrewTask[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    adj.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependencies ?? []) {
      if (!adj.has(dep)) {
        adj.set(dep, []);
      }
      adj.get(dep)!.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const queue = tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id);
  const result: CrewTask[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(taskMap.get(id)!);
    for (const next of adj.get(id)!) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  if (result.length !== tasks.length) {
    throw new Error("Circular dependency detected in tasks");
  }

  return result;
}

function computeDepths(tasks: CrewTask[]): Map<string, number> {
  const sorted = topologicalSort(tasks);
  const depths = new Map<string, number>();

  for (const task of sorted) {
    const deps = task.dependencies ?? [];
    if (deps.length === 0) {
      depths.set(task.id, 0);
    } else {
      const maxDepDepth = Math.max(...deps.map((d) => depths.get(d) ?? 0));
      depths.set(task.id, maxDepDepth + 1);
    }
  }

  return depths;
}

export class Crew {
  private roles: Map<string, CrewAgentRole>;
  private tasks: CrewTask[];
  private process: CrewProcess;
  private executeTaskImpl: (
    task: CrewTask,
    context: string,
    role: CrewAgentRole,
  ) => Promise<string>;
  private managerReviewImpl: (
    state: CrewState,
  ) => { revise: boolean; finalOutput: string };

  constructor(
    roles: CrewAgentRole[],
    tasks: CrewTask[],
    process: CrewProcess,
    opts?: {
      llmCaller?: unknown;
      executeTask?: (
        task: CrewTask,
        context: string,
        role: CrewAgentRole,
      ) => Promise<string>;
      managerReview?: (
        state: CrewState,
      ) => { revise: boolean; finalOutput: string };
    },
  ) {
    this.roles = new Map(roles.map((r) => [r.name, r]));
    this.tasks = tasks;
    this.process = process;
    this.executeTaskImpl =
      opts?.executeTask ?? (async (task) => `Result for ${task.id}`);
    this.managerReviewImpl =
      opts?.managerReview ??
      ((state) => {
        const finalOutput = Object.entries(state.results)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        return { revise: false, finalOutput };
      });
  }

  async run(
    context: string,
  ): Promise<{ results: Record<string, string>; finalOutput: string }> {
    const graph = this.buildGraph();
    const compiled = graph.compile();
    const finalState = await compiled.invoke({
      results: {},
      context,
      loopCount: 0,
      finalOutput: "",
    });
    return {
      results: finalState.results,
      finalOutput: finalState.finalOutput,
    };
  }

  private buildGraph(): StateGraph<CrewState> {
    switch (this.process) {
      case "sequential":
        return this.buildSequentialGraph();
      case "parallel":
        return this.buildParallelGraph();
      case "hierarchical":
        return this.buildHierarchicalGraph();
      default: {
        const _exhaustive: never = this.process;
        throw new Error(`Unknown process: ${_exhaustive}`);
      }
    }
  }

  private buildSequentialGraph(): StateGraph<CrewState> {
    const sorted = topologicalSort(this.tasks);
    const graph = new StateGraph<CrewState>();

    if (sorted.length === 0) {
      graph.addNode("__start__", (s) => s);
      return graph;
    }

    graph.addNode("__start__", (s) => s);
    graph.addEdge("__start__", sorted[0]!.id);

    for (let i = 0; i < sorted.length; i++) {
      const task = sorted[i]!;
      this.addTaskNode(graph, task);
      if (i < sorted.length - 1) {
        graph.addEdge(task.id, sorted[i + 1]!.id);
      }
    }

    graph.addNode("__finalize__", (state) => {
      const review = this.managerReviewImpl(state);
      return { ...state, finalOutput: review.finalOutput };
    });
    graph.addEdge(sorted[sorted.length - 1]!.id, "__finalize__");

    return graph;
  }

  private buildParallelGraph(): StateGraph<CrewState> {
    const depths = computeDepths(this.tasks);
    const levelMap = new Map<number, CrewTask[]>();

    for (const task of this.tasks) {
      const level = depths.get(task.id)!;
      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }
      levelMap.get(level)!.push(task);
    }

    const levels = Array.from(levelMap.keys()).sort((a, b) => a - b);
    const graph = new StateGraph<CrewState>();

    if (levels.length === 0) {
      graph.addNode("__start__", (s) => s);
      return graph;
    }

    graph.addNode("__start__", (s) => s);

    let prevNodes: string[] = ["__start__"];

    for (const level of levels) {
      const levelTasks = levelMap.get(level)!;

      for (const prev of prevNodes) {
        for (const task of levelTasks) {
          graph.addEdge(prev, task.id);
        }
      }

      for (const task of levelTasks) {
        this.addTaskNode(graph, task);
      }

      if (levelTasks.length > 1) {
        graph.addParallel(
          levelTasks.map((t) => t.id),
          (states) => {
            const base = states[0]!;
            const mergedResults = states.reduce<Record<string, string>>(
              (acc, s) => ({ ...acc, ...s.results }),
              {},
            );
            return {
              ...base,
              results: mergedResults,
            };
          },
        );
      }

      prevNodes = levelTasks.map((t) => t.id);
    }

    graph.addNode("__finalize__", (state) => {
      const review = this.managerReviewImpl(state);
      return { ...state, finalOutput: review.finalOutput };
    });
    for (const prev of prevNodes) {
      graph.addEdge(prev, "__finalize__");
    }

    return graph;
  }

  private buildHierarchicalGraph(): StateGraph<CrewState> {
    const sorted = topologicalSort(this.tasks);
    const graph = new StateGraph<CrewState>();

    if (sorted.length === 0) {
      graph.addNode("__start__", (s) => s);
      return graph;
    }

    graph.addNode("__start__", (s) => s);
    graph.addEdge("__start__", sorted[0]!.id);

    for (let i = 0; i < sorted.length; i++) {
      const task = sorted[i]!;
      this.addTaskNode(graph, task);
      if (i < sorted.length - 1) {
        graph.addEdge(task.id, sorted[i + 1]!.id);
      }
    }

    const lastTaskId = sorted[sorted.length - 1]!.id;

    graph.addNode("__manager__", (state) => {
      const review = this.managerReviewImpl(state);
      return {
        ...state,
        loopCount: state.loopCount + 1,
        finalOutput: review.finalOutput,
        revise: review.revise,
      };
    });

    graph.addEdge(lastTaskId, "__manager__");

    graph.addConditionalEdge(
      "__manager__",
      (state) => {
        if (state.revise && state.loopCount < 3) {
          return "revise";
        }
        return "finish";
      },
      { revise: sorted[0]!.id, finish: "__end__" },
    );

    graph.addNode("__end__", (s) => s);

    return graph;
  }

  private addTaskNode(graph: StateGraph<CrewState>, task: CrewTask): void {
    graph.addNode(task.id, async (state) => {
      const role = this.roles.get(task.agentRole);
      if (!role) {
        throw new Error(
          `Role '${task.agentRole}' not found for task '${task.id}'`,
        );
      }
      const result = await this.executeTaskImpl(task, state.context, role);
      return {
        ...state,
        results: { ...state.results, [task.id]: result },
      };
    });
  }
}

export const runCrewTaskTool = buildTool({
  name: "run_crew_task",
  description:
    "Creates a crew of specialized agents and runs them to complete a task.",
  inputSchema: z.object({
    task: z.string(),
    roles: z.array(
      z.object({
        name: z.string(),
        backstory: z.string(),
        goal: z.string(),
        allowDelegation: z.boolean(),
        toolsWhitelist: z.array(z.string()),
        systemPrompt: z.string().optional(),
      }),
    ),
    process: z.enum(["sequential", "hierarchical", "parallel"]).optional(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  costProfile: { latency: "variable", cpuIntensity: "medium", externalCost: "high", tokenEstimate: 4096 },
  async call({ task, roles, process }) {
    const tasks: CrewTask[] = roles.map((role, i) => ({
      id: `task_${i + 1}`,
      description: task,
      expectedOutput: `Deliverable from ${role.name}`,
      agentRole: role.name,
    }));

    const crew = new Crew(roles, tasks, process ?? "sequential");
    const result = await crew.run(task);
    return {
      success: true,
      results: result.results,
      finalOutput: result.finalOutput,
    };
  },
});

export {
  initCrewHistoryTables,
  recordCrewRun,
  recordCrewTask,
  getCrewRunHistory,
  getCrewRunTasks,
  getCrewRunMetrics,
  type CrewRunRecord,
  type CrewTaskRecord,
} from "./crew-history.ts";

export {
  runConsensus,
  type AgentAnswer,
  type ConsensusResult,
} from "./consensus-engine.ts";

export {
  createHandoff,
  applyHandoff,
  serializeHandoff,
  deserializeHandoff,
  type HandoffContext,
} from "./handoff.ts";
