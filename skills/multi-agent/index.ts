/**
 * Multi-Agent Collaboration Framework
 * =====================================
 * Orchestrates a pool of specialized agent runners to solve complex tasks.
 * Includes task dispatching and result aggregation.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import type { AgentRole, SubTask, TaskResult, BaseMessage } from "../../types/index.ts";
import { createAgentLoopRunner, type LLMCaller } from "../agent-loop/index.ts";

export interface AgentPoolEntry {
  role: AgentRole;
  runner: ReturnType<typeof createAgentLoopRunner>;
}

export class AgentPool {
  private agents = new Map<string, AgentPoolEntry>();

  register(role: AgentRole, runner: ReturnType<typeof createAgentLoopRunner>): void {
    this.agents.set(role.name, { role, runner });
  }

  get(roleName: string): AgentPoolEntry | undefined {
    return this.agents.get(roleName);
  }

  list(): AgentRole[] {
    return Array.from(this.agents.values()).map((a) => a.role);
  }

  remove(roleName: string): boolean {
    return this.agents.delete(roleName);
  }
}

export interface TaskDispatcher {
  dispatch(task: string, pool: AgentPool): Promise<SubTask[]>;
}

export function createPlannerDispatcher(llmCaller: LLMCaller): TaskDispatcher {
  return {
    async dispatch(task) {
      const messages: BaseMessage[] = [
        {
          role: "system",
          content:
            "You are a task planner. Break the user's task into subtasks. " +
            "Each subtask must have a role (planner, executor, reviewer) and a concise prompt. " +
            "Respond ONLY with a JSON array: [{\"role\":\"executor\",\"prompt\":\"...\"}]",
        },
        { role: "user", content: task },
      ];
      const reply = await llmCaller.call(messages, []);
      const text = typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content);
      try {
        const parsed = JSON.parse(text) as { role: string; prompt: string }[];
        return parsed.map((p, idx) => ({
          taskId: `subtask_${idx}`,
          role: p.role,
          prompt: p.prompt,
        }));
      } catch {
        // Fallback: single executor task
        return [{ taskId: "subtask_0", role: "executor", prompt: task }];
      }
    },
  };
}

export class ResultAggregator {
  async aggregate(results: TaskResult[]): Promise<string> {
    if (results.length === 0) return "No results.";
    if (results.length === 1) return results[0].output;

    const successOutputs = results.filter((r) => r.status === "success").map((r) => `### ${r.role}\n${r.output}`);
    const failureOutputs = results.filter((r) => r.status === "failure").map((r) => `### ${r.role} (FAILED)\n${r.output}`);

    return [
      "## Multi-Agent Results",
      ...successOutputs,
      ...failureOutputs,
      `\n*Total subtasks: ${results.length} | Success: ${successOutputs.length} | Failed: ${failureOutputs.length}*`,
    ].join("\n\n");
  }
}

export async function runMultiAgentTask(
  task: string,
  pool: AgentPool,
  dispatcher: TaskDispatcher,
  aggregator: ResultAggregator
): Promise<string> {
  const subTasks = await dispatcher.dispatch(task, pool);
  const results: TaskResult[] = [];

  for (const st of subTasks) {
    const entry = pool.get(st.role);
    if (!entry) {
      results.push({ taskId: st.taskId, role: st.role, output: `Role '${st.role}' not found in agent pool.`, status: "failure" });
      continue;
    }
    try {
      let output = "";
      for await (const msg of entry.runner.run(st.prompt)) {
        if ("role" in msg && msg.role === "assistant" && typeof msg.content === "string") {
          output += msg.content + "\n";
        }
      }
      results.push({ taskId: st.taskId, role: st.role, output: output.trim(), status: "success" });
    } catch (e) {
      results.push({ taskId: st.taskId, role: st.role, output: String(e), status: "failure" });
    }
  }

  return aggregator.aggregate(results);
}

export const multiAgentOrchestratorTool = buildTool({
  name: "multi_agent_orchestrate",
  description:
    "Break a complex task into subtasks and dispatch them to a pool of specialized agents (planner, executor, reviewer). " +
    "Returns an aggregated result.",
  inputSchema: z.object({
    task: z.string().describe("The high-level task to solve"),
    roles: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          allowedTools: z.array(z.string()).default([]),
          systemPrompt: z.string().optional(),
        })
      )
      .optional()
      .describe("Custom agent roles; defaults to executor-only"),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ task, roles }, _ctx) {
    // This is a simplified synchronous orchestrator that builds an in-memory pool
    // using a mock LLM caller (for tool-level invocation without real LLM config).
    // In production, the pool should be managed by the web backend lifecycle.
    const { createMockLLMCaller } = await import("../agent-loop/index.ts");
    const mockCaller = createMockLLMCaller();

    const pool = new AgentPool();
    const defaultRoles: AgentRole[] = (roles || [{ name: "executor", description: "General task executor", allowedTools: ["read_file", "write_file"] }]).map(
      (r) => ({ ...r, allowedTools: r.allowedTools || [] })
    );

    for (const role of defaultRoles) {
      const runner = createAgentLoopRunner({
        sessionId: `multi_agent_${role.name}_${Date.now()}`,
        tools: [], // In real usage, globalPool.all() would be injected
        llmCaller: mockCaller,
        skillPrompts: role.systemPrompt ? [role.systemPrompt] : [],
      });
      pool.register(role, runner);
    }

    const dispatcher = createPlannerDispatcher(mockCaller);
    const aggregator = new ResultAggregator();
    const result = await runMultiAgentTask(task, pool, dispatcher, aggregator);

    return {
      success: true,
      result,
      rolesUsed: defaultRoles.map((r) => r.name),
    };
  },
});
