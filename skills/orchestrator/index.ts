/**
 * Orchestrator Skill v2
 * ======================
 * Orchestrator-Worker architecture with:
 *   - Session-scoped worker pools (no global singleton pollution)
 *   - Structured worker results (not just raw strings)
 *   - Dynamic agent personality injection via agency-agents
 *   - Resilience v2 health tracking integration
 *   - Permission engine v2 ACL checks
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
import { recordHealthSuccess, recordHealthFailure } from "../../core/resilience-v2.ts";
// Permission v2 integration ready for future use
// import { checkPermissionV2 } from "../../core/permission-engine-v2.ts";
import { getAgentRegistry, buildSystemPrompt, type AgentDefinition } from "../agency-agents/index.ts";
import { evaluateTaskPriority, type TaskPoolType } from "./scheduler.ts";
import { recordTaskMetrics } from "./metrics.ts";
import { writeShortTermMemory } from "../../core/memory-tiered.ts";

import { WORKER_TIMEOUT_MS } from "../../web/routes/constants.ts";

// =============================================================================
// Types
// =============================================================================

export interface WorkerResult {
  success: boolean;
  finalAnswer: string;
  executionLog: string[];
  metrics: {
    durationMs: number;
    turnCount: number;
    tokenUsage?: number;
  };
  status: "completed" | "failed" | "timeout" | "aborted";
  error?: string;
  agentId?: string;
  agentName?: string;
}

// =============================================================================
// Priority Semaphore
// =============================================================================

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

  getActiveCount(maxPermits: number): number {
    return maxPermits - this.permits;
  }
}

// =============================================================================
// Worker Pool (session-scoped)
// =============================================================================

class WorkerPool {
  private semaphore: PrioritySemaphore;
  private runners = new Map<string, ReturnType<typeof createAgentLoopRunner>>();
  private lastUsed = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxConcurrent: number;
  private readonly idleTimeoutMs: number;

  constructor(
    readonly parentSessionId: string,
    opts: { maxConcurrentWorkers?: number; idleTimeoutMs?: number } = {}
  ) {
    this.maxConcurrent = opts.maxConcurrentWorkers ?? 5;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 10 * 60 * 1000;
    this.semaphore = new PrioritySemaphore(this.maxConcurrent);
  }

  private getOrCreateRunner(
    workerSessionId: string,
    tools: Tool<unknown, unknown, unknown>[],
    llmCfg?: LLMConfig,
    overrideSystemPrompt?: string
  ): ReturnType<typeof createAgentLoopRunner> {
    this.lastUsed.set(workerSessionId, Date.now());
    if (this.runners.has(workerSessionId)) {
      return this.runners.get(workerSessionId)!;
    }

    const llmCaller = llmCfg && llmCfg.apiKey
      ? createRealLLMCaller(llmCfg)
      : createMockLLMCaller();

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
      overrideSystemPrompt,
    });

    this.runners.set(workerSessionId, runner);
    return runner;
  }

  async execute(
    workerSessionId: string,
    taskDescription: string,
    tools: Tool<unknown, unknown, unknown>[],
    llmCfg?: LLMConfig,
    opts?: {
      existingTaskId?: number;
      allowedTools?: string[];
      taskName?: string;
      priority?: number;
      retries?: number;
      maxRetries?: number;
      timeoutMs?: number;
      agent?: AgentDefinition;
    }
  ): Promise<WorkerResult> {
    const priority = opts?.priority ?? 0;
    const retries = opts?.retries ?? 0;
    const maxRetries = opts?.maxRetries ?? 3;
    const timeoutMs = opts?.timeoutMs ?? WORKER_TIMEOUT_MS;
    const agent = opts?.agent;
    const startTime = Date.now();

    let taskId = opts?.existingTaskId;
    if (!taskId) {
      const insertResult = insertWorkerTask({
        parent_session_id: this.parentSessionId,
        worker_session_id: workerSessionId,
        task_name: opts?.taskName ?? "worker",
        task_description: taskDescription,
        allowed_tools: opts?.allowedTools ? JSON.stringify(opts.allowedTools) : null,
        status: "queued",
        result: null,
        error: null,
        priority,
        retries,
        max_retries: maxRetries,
        timeout_ms: timeoutMs,
      });
      if (insertResult.success) {
        taskId = insertResult.id;
      }
    }

    await this.semaphore.acquire(priority);
    try {
      if (taskId) {
        updateWorkerTask(taskId, { status: "running", started_at: Date.now() });
      }
      this.lastUsed.set(workerSessionId, Date.now());
      notificationBus.emitEvent({
        type: "audit",
        title: "Worker 启动",
        message: `Worker ${workerSessionId}${agent ? ` (${agent.name})` : ""} 开始执行任务`,
        timestamp: Date.now(),
        meta: { parentSessionId: this.parentSessionId, workerSessionId, taskDescription: taskDescription.slice(0, 200), agent: agent?.name },
      });

      // Build system prompt with agent personality if matched
      let overrideSystemPrompt: string | undefined;
      if (agent) {
        const prompt = buildSystemPrompt(agent);
        overrideSystemPrompt = prompt.content;
      }

      const runner = this.getOrCreateRunner(workerSessionId, tools, llmCfg, overrideSystemPrompt);
      // If retrying, reset the runner context for a fresh start
      if (retries > 0) {
        runner.injectSystemPrompt(overrideSystemPrompt || "You are Ouroboros, a self-modifying agent.");
      }

      const outputs: string[] = [];
      let executionError = false;
      let errorMessage: string | undefined;
      let turnCount = 0;
      const abortController = new AbortController();
      runner.setAbortSignal(abortController.signal);
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      try {
        for await (const msg of runner.run(taskDescription)) {
          if (abortController.signal.aborted) {
            outputs.push("[Worker Timeout] Task exceeded time limit and was aborted.");
            executionError = true;
            errorMessage = "timeout";
            break;
          }
          if ("role" in msg && msg.role === "assistant") {
            const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            outputs.push(text);
            turnCount++;
          } else if ("type" in msg && msg.type === "tool_result") {
            outputs.push(`[Tool Result] ${msg.toolUseId}: ${msg.content}`);
          }
        }
      } catch (e) {
        logger.error("Worker execution failed", { workerSessionId, error: String(e) });
        outputs.push(`[Worker Error] ${String(e)}`);
        executionError = true;
        errorMessage = String(e);
      } finally {
        clearTimeout(timeoutId);
      }

      const durationMs = Date.now() - startTime;
      const finalAnswer = outputs.join("\n\n").slice(0, 8000);
      const status: WorkerResult["status"] = executionError
        ? (errorMessage === "timeout" ? "timeout" : "failed")
        : "completed";

      // Resilience v2 health tracking
      if (executionError) {
        recordHealthFailure("tool", agent?.name || workerSessionId, errorMessage);
      } else {
        recordHealthSuccess("tool", agent?.name || workerSessionId, durationMs);
      }

      if (taskId) {
        if (executionError && retries < maxRetries) {
          updateWorkerTask(taskId, {
            status: "queued",
            result: finalAnswer,
            error: errorMessage || finalAnswer,
            retries: retries + 1,
          });
          logger.warn("Worker task failed, re-queued for persistent retry", { taskId, retries: retries + 1, maxRetries });
          return {
            success: false,
            finalAnswer,
            executionLog: outputs,
            metrics: { durationMs, turnCount },
            status: "failed",
            error: errorMessage,
            agentId: agent?.id,
            agentName: agent?.name,
          };
        }
        updateWorkerTask(taskId, {
          status: executionError ? "failed" : "completed",
          result: finalAnswer,
          error: executionError ? (errorMessage || finalAnswer) : null,
          completed_at: Date.now(),
        });
      }

      notificationBus.emitEvent({
        type: "audit",
        title: "Worker 完成",
        message: `Worker ${workerSessionId}${agent ? ` (${agent.name})` : ""} 已完成`,
        timestamp: Date.now(),
        meta: { parentSessionId: this.parentSessionId, workerSessionId, status, durationMs },
      });

      return {
        success: !executionError,
        finalAnswer,
        executionLog: outputs,
        metrics: { durationMs, turnCount },
        status,
        error: errorMessage,
        agentId: agent?.id,
        agentName: agent?.name,
      };
    } finally {
      this.semaphore.release();
    }
  }

  removeRunner(workerSessionId: string): boolean {
    this.lastUsed.delete(workerSessionId);
    return this.runners.delete(workerSessionId);
  }

  getStats(): {
    totalRunners: number;
    activeWorkers: number;
    queuedWorkers: number;
    ids: string[];
  } {
    return {
      totalRunners: this.runners.size,
      activeWorkers: this.semaphore.getActiveCount(this.maxConcurrent),
      queuedWorkers: this.semaphore.getQueueLength(),
      ids: Array.from(this.runners.keys()),
    };
  }

  startIdleCleanup(intervalMs = 60000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, lastUsed] of this.lastUsed) {
        if (now - lastUsed > this.idleTimeoutMs) {
          this.removeRunner(sessionId);
        }
      }
    }, intervalMs);
  }

  stopIdleCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  dispose(): void {
    this.stopIdleCleanup();
    this.runners.clear();
    this.lastUsed.clear();
  }
}

// =============================================================================
// Worker Pool Manager (sharded by task type)
// =============================================================================

interface PoolConfig {
  maxConcurrentWorkers: number;
  idleTimeoutMs: number;
}

const DEFAULT_POOL_CONFIGS: Record<TaskPoolType, PoolConfig> = {
  cpu: { maxConcurrentWorkers: 5, idleTimeoutMs: 10 * 60 * 1000 },
  io: { maxConcurrentWorkers: 3, idleTimeoutMs: 10 * 60 * 1000 },
  llm: { maxConcurrentWorkers: 3, idleTimeoutMs: 10 * 60 * 1000 },
  fallback: { maxConcurrentWorkers: 5, idleTimeoutMs: 10 * 60 * 1000 },
};

class WorkerPoolManager {
  private pools = new Map<string, Map<TaskPoolType, WorkerPool>>();
  private globalCleanupTimer: ReturnType<typeof setInterval> | null = null;
  readonly globalIdleTimeoutMs = 30 * 60 * 1000;

  getPool(parentSessionId: string, poolType: TaskPoolType): WorkerPool {
    let sessionPools = this.pools.get(parentSessionId);
    if (!sessionPools) {
      sessionPools = new Map();
      this.pools.set(parentSessionId, sessionPools);
    }
    if (!sessionPools.has(poolType)) {
      const cfg = DEFAULT_POOL_CONFIGS[poolType];
      const pool = new WorkerPool(parentSessionId, {
        maxConcurrentWorkers: cfg.maxConcurrentWorkers,
        idleTimeoutMs: cfg.idleTimeoutMs,
      });
      pool.startIdleCleanup();
      sessionPools.set(poolType, pool);
    }
    return sessionPools.get(poolType)!;
  }

  getStats() {
    let total = 0;
    let activeWorkers = 0;
    let queuedWorkers = 0;
    const ids: string[] = [];
    const perPool: Record<TaskPoolType, { runners: number; active: number; queued: number }> = {
      cpu: { runners: 0, active: 0, queued: 0 },
      io: { runners: 0, active: 0, queued: 0 },
      llm: { runners: 0, active: 0, queued: 0 },
      fallback: { runners: 0, active: 0, queued: 0 },
    };
    for (const [, sessionPools] of this.pools) {
      for (const [type, pool] of sessionPools) {
        const stats = pool.getStats();
        total += stats.totalRunners;
        activeWorkers += stats.activeWorkers;
        queuedWorkers += stats.queuedWorkers;
        ids.push(...stats.ids);
        perPool[type].runners += stats.totalRunners;
        perPool[type].active += stats.activeWorkers;
        perPool[type].queued += stats.queuedWorkers;
      }
    }
    return { total, ids, activeWorkers, queuedWorkers, pools: this.pools.size, perPool };
  }

  removeRunner(workerSessionId: string): boolean {
    for (const [, sessionPools] of this.pools) {
      for (const [, pool] of sessionPools) {
        if (pool.getStats().ids.includes(workerSessionId)) {
          return pool.removeRunner(workerSessionId);
        }
      }
    }
    return false;
  }

  startIdleCleanup(intervalMs = 60000): void {
    for (const [, sessionPools] of this.pools) {
      for (const [, pool] of sessionPools) {
        pool.startIdleCleanup(intervalMs);
      }
    }
    if (this.globalCleanupTimer) return;
    this.globalCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, sessionPools] of this.pools) {
        let hasActivity = false;
        for (const [, pool] of sessionPools) {
          const stats = pool.getStats();
          if (stats.totalRunners > 0 || stats.activeWorkers > 0) {
            hasActivity = true;
            break;
          }
          const lastActivity = Array.from(pool["lastUsed"].values()).sort((a, b) => b - a)[0];
          if (lastActivity && now - lastActivity < this.globalIdleTimeoutMs) {
            hasActivity = true;
            break;
          }
        }
        if (!hasActivity) {
          for (const [, pool] of sessionPools) {
            pool.dispose();
          }
          this.pools.delete(sessionId);
          logger.info("Disposed idle worker pool manager session", { sessionId });
        }
      }
    }, intervalMs);
  }

  stopIdleCleanup(): void {
    for (const [, sessionPools] of this.pools) {
      for (const [, pool] of sessionPools) {
        pool.stopIdleCleanup();
      }
    }
    if (this.globalCleanupTimer) {
      clearInterval(this.globalCleanupTimer);
      this.globalCleanupTimer = null;
    }
  }

  dispose(): void {
    this.stopIdleCleanup();
    for (const [, sessionPools] of this.pools) {
      for (const [, pool] of sessionPools) {
        pool.dispose();
      }
    }
    this.pools.clear();
  }
}

const poolManager = new WorkerPoolManager();

export function removeWorkerRunner(workerSessionId: string): boolean {
  return poolManager.removeRunner(workerSessionId);
}

export function getWorkerRunnerStats(): { total: number; ids: string[]; activeWorkers: number; queuedWorkers: number; pools: number } {
  const stats = poolManager.getStats();
  return {
    total: stats.total,
    ids: stats.ids,
    activeWorkers: stats.activeWorkers,
    queuedWorkers: stats.queuedWorkers,
    pools: stats.pools,
  };
}

export function startWorkerIdleCleanup(intervalMs = 60000): void {
  poolManager.startIdleCleanup(intervalMs);
}

export function stopWorkerIdleCleanup(): void {
  poolManager.stopIdleCleanup();
}

// =============================================================================
// Worker Execution (pool-routed)
// =============================================================================

export async function runWorkerAgent(
  parentSessionId: string,
  workerSessionId: string,
  taskDescription: string,
  tools: Tool<unknown, unknown, unknown>[],
  llmCfg?: LLMConfig,
  opts?: { existingTaskId?: number; allowedTools?: string[]; taskName?: string; priority?: number; retries?: number; maxRetries?: number; timeoutMs?: number }
): Promise<WorkerResult> {
  const scheduling = evaluateTaskPriority(taskDescription, opts?.taskName);
  const pool = poolManager.getPool(parentSessionId, scheduling.targetPool);

  // Match agent personality for the task (async LLM classification with keyword fallback)
  const registry = getAgentRegistry();
  const matchedAgent = (await registry.matchForTaskAsync(taskDescription)) || undefined;

  const queueStart = Date.now();
  const result = await pool.execute(workerSessionId, taskDescription, tools, llmCfg, {
    ...opts,
    agent: matchedAgent,
    priority: opts?.priority ?? scheduling.level,
  });

  const queuedMs = Date.now() - queueStart - result.metrics.durationMs;
  recordTaskMetrics({
    pool: scheduling.targetPool,
    durationMs: result.metrics.durationMs,
    success: result.success,
    complexity: scheduling.estimatedComplexity,
    queuedMs: Math.max(0, queuedMs),
    timestamp: Date.now(),
    agentName: matchedAgent?.name,
  });

  // Feature 4: Persist worker result to tiered memory (STM)
  const memoryImportance = result.success
    ? Math.min(0.9, 0.5 + scheduling.estimatedComplexity * 0.04)
    : 0.3;
  writeShortTermMemory(
    `Worker [${opts?.taskName ?? "worker"}] result:\n${result.finalAnswer.slice(0, 3000)}`,
    {
      sessionId: parentSessionId,
      summary: `${opts?.taskName ?? "worker"}: ${result.success ? "success" : result.status} (${result.metrics.durationMs}ms)`,
      importance: memoryImportance,
      sourcePath: `worker:${workerSessionId}`,
    }
  );

  return result;
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

    const allTools = deps.getGlobalTools().filter((t) => t.name !== "delegate_task");
    let tools = allTools;
    if (task.allowed_tools) {
      const allowed = safeJsonParse<string[]>(task.allowed_tools, "worker allowed tools");
      if (Array.isArray(allowed) && allowed.length > 0) {
        tools = allTools.filter((t) => allowed.includes(t.name));
      }
    }

    const scheduling = evaluateTaskPriority(task.task_description || "", task.task_name || undefined);
    const pool = poolManager.getPool(task.parent_session_id, scheduling.targetPool);
    pool.execute(
      task.worker_session_id,
      task.task_description || "",
      tools,
      deps.getLLMConfig(),
      { existingTaskId: task.id, taskName: task.task_name || undefined, priority: task.priority }
    ).catch((err: unknown) => {
      logger.error("Resumed worker task failed", { workerSessionId: task.worker_session_id, error: String(err) });
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
      const workerTools = allTools.filter((t) => t.name !== "delegate_task");
      const filteredTools = input.allowed_tools && input.allowed_tools.length > 0
        ? workerTools.filter((t) => input.allowed_tools!.includes(t.name))
        : workerTools;

      const llmCfg = deps.getLLMConfig();
      const workerResult = await runWorkerAgent(parentSessionId, workerSessionId, taskDesc, filteredTools, llmCfg, { allowedTools: input.allowed_tools, taskName, priority: input.priority ?? 0 });

      return {
        success: workerResult.success,
        workerSessionId,
        result: workerResult.finalAnswer,
        status: workerResult.status,
        metrics: workerResult.metrics,
        agentName: workerResult.agentName,
      };
    },
  });
}

// Re-export DAG primitives
export { createDelegateDagTool, runWorkerDag } from "./dag.ts";
export type { DagTask, DagTaskResult, DagExecutionResult } from "./dag.ts";
