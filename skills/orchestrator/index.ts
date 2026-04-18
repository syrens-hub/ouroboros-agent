/**
 * Orchestrator Skill
 * ==================
 * Implements the Orchestrator-Worker architecture.
 * The Orchestrator agent delegates concrete work to worker sub-agents.
 */

import { z } from "zod";
import { buildTool, type Tool } from "../../core/tool-framework.ts";
import { createAgentLoopRunner, createRealLLMCaller, createMockLLMCaller } from "../agent-loop/index.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import type { ToolPermissionContext } from "../../types/index.ts";
import { notificationBus } from "../notification/index.ts";
import { logger } from "../../core/logger.ts";
import { getMessages } from "../../core/session-db.ts";
import { insertWorkerTask, updateWorkerTask, listPendingWorkerTasks } from "../../core/repositories/worker-tasks.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

import { WORKER_TIMEOUT_MS } from "../../web/routes/constants.ts";
// 1 minute hard timeout for worker execution
const MAX_CONCURRENT_WORKERS = 5;

interface QueueEntry {
  resolve: () => void;
  priority: number;
}

class PrioritySemaphore {
  private permits: number;
  private queue: QueueEntry[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(priority = 0): Promise<void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.queue.push({ resolve, priority });
        // Sort by priority descending (higher priority first)
        this.queue.sort((a, b) => b.priority - a.priority);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.permits++;
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return MAX_CONCURRENT_WORKERS - this.permits;
  }
}

const workerSemaphore = new PrioritySemaphore(MAX_CONCURRENT_WORKERS);

// =============================================================================
// Worker Runner Registry
// =============================================================================

const workerRunners = new Map<string, ReturnType<typeof createAgentLoopRunner>>();

function getOrCreateWorkerRunner(
  workerSessionId: string,
  tools: Tool<unknown, unknown, unknown>[],
  llmCfg?: LLMConfig
): ReturnType<typeof createAgentLoopRunner> {
  workerLastUsed.set(workerSessionId, Date.now());
  if (workerRunners.has(workerSessionId)) {
    return workerRunners.get(workerSessionId)!;
  }

  const llmCaller = llmCfg && llmCfg.apiKey
    ? createRealLLMCaller(llmCfg)
    : createMockLLMCaller();

  // Worker permission context: more restrictive than orchestrator
  const workerPermCtx: ToolPermissionContext = {
    alwaysAllowRules: ["read_file", "read_skill", "discover_skills", "compress_trajectory"],
    alwaysDenyRules: ["self_modify", "rule_engine_override"],
    alwaysAskRules: ["write_file", "write_skill", "browser_launch", "install_skill"],
    mode: "interactive",
    source: "worker",
  };

  const runner = createAgentLoopRunner({
    sessionId: workerSessionId,
    tools,
    llm: llmCfg,
    llmCaller,
    mode: "worker",
    enableBackgroundReview: false,
    skillPrompts: [],
    permissionCtx: workerPermCtx,
  });

  workerRunners.set(workerSessionId, runner);
  return runner;
}

export function removeWorkerRunner(workerSessionId: string): boolean {
  return workerRunners.delete(workerSessionId);
}

export function getWorkerRunnerStats(): { total: number; ids: string[]; activeWorkers: number; queuedWorkers: number } {
  return { total: workerRunners.size, ids: Array.from(workerRunners.keys()), activeWorkers: workerSemaphore.getActiveCount(), queuedWorkers: workerSemaphore.getQueueLength() };
}

// =============================================================================
// Worker Idle Cleanup
// =============================================================================

const workerLastUsed = new Map<string, number>();
const WORKER_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let workerCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startWorkerIdleCleanup(intervalMs = 60000): void {
  if (workerCleanupTimer) return;
  workerCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, lastUsed] of workerLastUsed) {
      if (now - lastUsed > WORKER_IDLE_TIMEOUT_MS) {
        removeWorkerRunner(sessionId);
        workerLastUsed.delete(sessionId);
      }
    }
  }, intervalMs);
}

export function stopWorkerIdleCleanup(): void {
  if (workerCleanupTimer) {
    clearInterval(workerCleanupTimer);
    workerCleanupTimer = null;
  }
}

// =============================================================================
// Worker Execution
// =============================================================================

async function runWorkerAgent(
  parentSessionId: string,
  workerSessionId: string,
  taskDescription: string,
  tools: Tool<unknown, unknown, unknown>[],
  llmCfg?: LLMConfig,
  opts?: { existingTaskId?: number; allowedTools?: string[]; taskName?: string; priority?: number }
): Promise<string> {
  const priority = opts?.priority ?? 0;
  let taskId = opts?.existingTaskId;
  if (!taskId) {
    const insertResult = insertWorkerTask({
      parent_session_id: parentSessionId,
      worker_session_id: workerSessionId,
      task_name: opts?.taskName ?? "worker",
      task_description: taskDescription,
      allowed_tools: opts?.allowedTools ? JSON.stringify(opts.allowedTools) : null,
      status: "queued",
      result: null,
      error: null,
      priority,
    });
    if (insertResult.success) {
      taskId = insertResult.id;
    }
  }

  await workerSemaphore.acquire(priority);
  try {
    if (taskId) {
      updateWorkerTask(taskId, { status: "running", started_at: Date.now() });
    }
    workerLastUsed.set(workerSessionId, Date.now());
    notificationBus.emitEvent({
      type: "audit",
      title: "Worker 启动",
      message: `Worker ${workerSessionId} 开始执行任务`,
      timestamp: Date.now(),
      meta: { parentSessionId, workerSessionId, taskDescription: taskDescription.slice(0, 200) },
    });

    const runner = getOrCreateWorkerRunner(workerSessionId, tools, llmCfg);
    const outputs: string[] = [];
    let executionError = false;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, WORKER_TIMEOUT_MS);

    try {
      for await (const msg of runner.run(taskDescription)) {
        if (abortController.signal.aborted) {
          outputs.push("[Worker Timeout] Task exceeded 60 seconds and was aborted.");
          executionError = true;
          break;
        }
        if ("role" in msg && msg.role === "assistant") {
          const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          outputs.push(text);
        } else if ("type" in msg && msg.type === "tool_result") {
          outputs.push(`[Tool Result] ${msg.toolUseId}: ${msg.content}`);
        }
      }
    } catch (e) {
      logger.error("Worker execution failed", { workerSessionId, error: String(e) });
      outputs.push(`[Worker Error] ${String(e)}`);
      executionError = true;
    } finally {
      clearTimeout(timeoutId);
    }

    const result = outputs.join("\n\n").slice(0, 8000);

    if (taskId) {
      updateWorkerTask(taskId, {
        status: executionError ? "failed" : "completed",
        result,
        error: executionError ? result : null,
        completed_at: Date.now(),
      });
    }

    notificationBus.emitEvent({
      type: "audit",
      title: "Worker 完成",
      message: `Worker ${workerSessionId} 已完成`,
      timestamp: Date.now(),
      meta: { parentSessionId, workerSessionId },
    });

    return result;
  } finally {
    workerSemaphore.release();
  }
}

export async function resumeQueuedWorkerTasks(deps: {
  getGlobalTools: () => Tool<unknown, unknown, unknown>[];
  getLLMConfig: () => LLMConfig | undefined;
}): Promise<void> {
  const pending = listPendingWorkerTasks();
  if (!pending.success || pending.data.length === 0) return;

  logger.info("Resuming queued worker tasks after restart", { count: pending.data.length });

  for (const task of pending.data) {
    if (task.status === "running") {
      // Process crashed while task was running; mark it failed
      updateWorkerTask(task.id, {
        status: "failed",
        error: "Process restarted while task was running",
        completed_at: Date.now(),
      });
      notificationBus.emitEvent({
        type: "audit",
        title: "Worker 任务恢复失败",
        message: `任务 ${task.worker_session_id} 因进程重启而失败`,
        timestamp: Date.now(),
        meta: { parentSessionId: task.parent_session_id, workerSessionId: task.worker_session_id },
      });
      continue;
    }

    // Reconstruct tool list
    const allTools = deps.getGlobalTools().filter((t) => t.name !== "delegate_task");
    let tools = allTools;
    if (task.allowed_tools) {
      const allowed = safeJsonParse<string[]>(task.allowed_tools, "worker allowed tools");
      if (Array.isArray(allowed) && allowed.length > 0) {
        tools = allTools.filter((t) => allowed.includes(t.name));
      }
    }

    // Execute in background without blocking startup
    runWorkerAgent(
      task.parent_session_id,
      task.worker_session_id,
      task.task_description || "",
      tools,
      deps.getLLMConfig(),
      { existingTaskId: task.id, taskName: task.task_name || undefined, priority: task.priority }
    ).catch((e) => {
      logger.error("Resumed worker task failed", { workerSessionId: task.worker_session_id, error: String(e) });
    });
  }
}

// =============================================================================
// Delegate Task Tool Factory
// =============================================================================

export function createDelegateTaskTool(deps: {
  getGlobalTools: () => Tool<unknown, unknown, unknown>[];
  getLLMConfig: () => LLMConfig | undefined;
}): Tool<unknown, unknown, unknown> {
  return buildTool({
    name: "delegate_task",
    description:
      "Delegate a concrete subtask to a specialized worker agent. " +
      "The worker will execute the task using available tools and return a result summary. " +
      "Use this for ALL concrete work (file I/O, web search, code generation, analysis). " +
      "You may call this tool multiple times for independent subtasks. " +
      "Example: {\"task_name\":\"write-fibonacci\",\"task_description\":\"Write a Python function...\"}",
    inputSchema: z.object({
      task_name: z.string().optional().describe("Short identifier for the subtask (e.g., 'write-fibonacci')"),
      task_description: z.string().optional().describe("Detailed directive for the worker agent"),
      allowed_tools: z.array(z.string()).optional().describe("Optional whitelist of tool names"),
      priority: z.number().optional().describe("Higher values are scheduled earlier (default 0)"),
    }),
    isReadOnly: false,
    isConcurrencySafe: false,
    async call(input, ctx) {
      const parentSessionId = String(ctx.taskId || "unknown");
      const taskName = input.task_name || "worker";
      let taskDesc = input.task_description || "";

      // Fallback: if LLM sends empty params (common with MiniMax), infer from parent session history
      if (!taskDesc) {
        try {
          const history = await getMessages(parentSessionId, { limit: 5 });
          if (history.success && history.data && history.data.length > 0) {
            const lastUser = history.data.slice().reverse().find((m: { role: string; content?: unknown }) => m.role === "user");
            if (lastUser && typeof lastUser.content === "string") {
              taskDesc = lastUser.content;
            }
          }
        } catch {
          // ignore
        }
        if (!taskDesc) {
          taskDesc = "Execute the user's request to the best of your ability.";
        }
      }

      const workerSessionId = `${parentSessionId}_worker_${taskName}_${Date.now()}`;

      const allTools = deps.getGlobalTools();
      // Exclude delegate_task from worker to prevent infinite recursion
      const workerTools = allTools.filter((t) => t.name !== "delegate_task");
      const filteredTools = input.allowed_tools && input.allowed_tools.length > 0
        ? workerTools.filter((t) => input.allowed_tools!.includes(t.name))
        : workerTools;

      const llmCfg = deps.getLLMConfig();
      const result = await runWorkerAgent(parentSessionId, workerSessionId, taskDesc, filteredTools, llmCfg, { allowedTools: input.allowed_tools, taskName, priority: input.priority ?? 0 });

      return {
        success: true,
        workerSessionId,
        result,
      };
    },
  });
}
