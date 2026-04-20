/**
 * Multi-Agent Collaboration DAG
 * =============================
 * Execute a directed acyclic graph of worker tasks with dependency resolution.
 * Dependencies are expressed via task IDs; upstream results are injected into
 * downstream task descriptions via {{result:<taskId>}} template variables.
 */

import { z } from "zod";
import { buildTool, type Tool } from "../../core/tool-framework.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import type { WorkerResult } from "./index.ts";
import { logger } from "../../core/logger.ts";

export interface DagTask {
  id: string;
  taskName: string;
  taskDescription: string;
  dependsOn?: string[];
  allowedTools?: string[];
  priority?: number;
}

export interface DagTaskResult {
  id: string;
  success: boolean;
  result: WorkerResult;
  completedAt: number;
}

export interface DagExecutionResult {
  success: boolean;
  tasks: DagTaskResult[];
  summary: string;
}

function topologicalSort(tasks: DagTask[]): DagTask[] {
  const idToTask = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: DagTask[] = [];

  function visit(task: DagTask): void {
    if (temp.has(task.id)) throw new Error(`Cycle detected in DAG at task "${task.id}"`);
    if (visited.has(task.id)) return;

    temp.add(task.id);
    for (const depId of task.dependsOn ?? []) {
      const dep = idToTask.get(depId);
      if (!dep) throw new Error(`Unknown dependency "${depId}" for task "${task.id}"`);
      visit(dep);
    }
    temp.delete(task.id);
    visited.add(task.id);
    order.push(task);
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) visit(task);
  }

  return order;
}

function groupByReadyLevel(sorted: DagTask[]): DagTask[][] {
  const completed = new Set<string>();
  const remaining = new Set(sorted);
  const levels: DagTask[][] = [];

  while (remaining.size > 0) {
    const ready = Array.from(remaining).filter((t) =>
      (t.dependsOn ?? []).every((d) => completed.has(d))
    );
    if (ready.length === 0) {
      throw new Error("DAG deadlock: no tasks ready to execute");
    }
    levels.push(ready);
    for (const t of ready) {
      completed.add(t.id);
      remaining.delete(t);
    }
  }

  return levels;
}

function injectDependencyResults(description: string, results: Map<string, DagTaskResult>): string {
  return description.replace(/\{\{result:([a-zA-Z0-9_-]+)\}\}/g, (_match, taskId) => {
    const res = results.get(taskId);
    if (!res) return "[result pending]";
    return res.result.finalAnswer.slice(0, 2000);
  });
}

export async function runWorkerDag(
  parentSessionId: string,
  tasks: DagTask[],
  runTask: (task: DagTask, injectedDescription: string) => Promise<WorkerResult>
): Promise<DagExecutionResult> {
  if (tasks.length === 0) {
    return { success: true, tasks: [], summary: "No tasks to execute." };
  }

  const sorted = topologicalSort(tasks);
  const levels = groupByReadyLevel(sorted);
  const results = new Map<string, DagTaskResult>();

  for (const level of levels) {
    // Execute each level in parallel
    const levelResults = await Promise.all(
      level.map(async (task) => {
        const injectedDesc = injectDependencyResults(task.taskDescription, results);
        const start = Date.now();
        try {
          const result = await runTask(task, injectedDesc);
          return {
            id: task.id,
            success: result.success,
            result,
            completedAt: Date.now(),
          };
        } catch (e) {
          const errorMsg = String(e);
          logger.error("DAG task failed", { taskId: task.id, error: errorMsg });
          const failedResult: WorkerResult = {
            success: false,
            finalAnswer: `[DAG Error] ${errorMsg}`,
            executionLog: [errorMsg],
            metrics: { durationMs: Date.now() - start, turnCount: 0 },
            status: "failed",
            error: errorMsg,
          };
          return {
            id: task.id,
            success: false,
            result: failedResult,
            completedAt: Date.now(),
          };
        }
      })
    );

    for (const r of levelResults) {
      results.set(r.id, r);
    }
  }

  const allSuccess = Array.from(results.values()).every((r) => r.success);
  const summary = Array.from(results.values())
    .map((r) => `- ${r.id}: ${r.success ? "✓" : "✗"} ${r.result.status} (${r.result.metrics.durationMs}ms)`)
    .join("\n");

  return {
    success: allSuccess,
    tasks: Array.from(results.values()),
    summary,
  };
}

export function createDelegateDagTool(deps: {
  getGlobalTools: () => Tool<unknown, unknown, unknown>[];
  getLLMConfig: () => LLMConfig | undefined;
  runWorker: (parentSessionId: string, workerSessionId: string, taskDescription: string, tools: Tool<unknown, unknown, unknown>[], llmCfg?: LLMConfig, opts?: { allowedTools?: string[]; taskName?: string; priority?: number }) => Promise<WorkerResult>;
}): Tool<unknown, unknown, unknown> {
  return buildTool({
    name: "delegate_dag",
    description:
      "Delegate multiple interdependent subtasks as a DAG (directed acyclic graph). " +
      "Each task can depend on others via `dependsOn`. Upstream results are injected into downstream " +
      "task descriptions via {{result:<taskId>}} placeholders. Tasks within the same level execute in parallel. " +
      "Example: [{\"id\":\"research\",\"taskName\":\"research\",\"taskDescription\":\"Research X\"},{\"id\":\"write\",\"taskName\":\"write\",\"taskDescription\":\"Write report based on: {{result:research}}\",\"dependsOn\":[\"research\"]}]",
    inputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string().describe("Unique identifier for this task"),
        taskName: z.string().describe("Short name for the subtask"),
        taskDescription: z.string().describe("Detailed directive; use {{result:upstreamId}} to inject upstream results"),
        dependsOn: z.array(z.string()).optional().describe("List of task IDs this task depends on"),
        allowedTools: z.array(z.string()).optional().describe("Optional whitelist of tool names"),
        priority: z.number().optional().describe("Higher values are scheduled earlier (default 0)"),
      })).describe("Array of DAG tasks"),
    }),
    isReadOnly: false,
    isConcurrencySafe: false,
    costProfile: { latency: "variable", cpuIntensity: "medium", externalCost: "high", tokenEstimate: 4096 },
    async call(input, ctx) {
      const parentSessionId = String(ctx.taskId || "unknown");
      const llmCfg = deps.getLLMConfig();

      const allTools = deps.getGlobalTools();
      const workerTools = allTools.filter((t) => t.name !== "delegate_dag" && t.name !== "delegate_task");

      const dagResult = await runWorkerDag(
        parentSessionId,
        input.tasks,
        async (task, injectedDescription) => {
          const filteredTools = task.allowedTools && task.allowedTools.length > 0
            ? workerTools.filter((t) => task.allowedTools!.includes(t.name))
            : workerTools;

          const workerSessionId = `${parentSessionId}_dag_${task.id}_${Date.now()}`;
          return deps.runWorker(parentSessionId, workerSessionId, injectedDescription, filteredTools, llmCfg, {
            allowedTools: task.allowedTools,
            taskName: task.taskName,
            priority: task.priority ?? 0,
          });
        }
      );

      return {
        success: dagResult.success,
        taskCount: dagResult.tasks.length,
        completedTasks: dagResult.tasks.filter((t) => t.success).length,
        failedTasks: dagResult.tasks.filter((t) => !t.success).length,
        summary: dagResult.summary,
        results: dagResult.tasks.map((t) => ({
          id: t.id,
          success: t.success,
          finalAnswer: t.result.finalAnswer.slice(0, 2000),
          status: t.result.status,
          durationMs: t.result.metrics.durationMs,
        })),
      };
    },
  });
}
