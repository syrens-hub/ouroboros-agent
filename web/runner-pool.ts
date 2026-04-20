/**
 * Ouroboros Web UI Runner Pool
 * =============================
 * Manages AgentLoopRunner instances per session for the web backend.
 */

import { createToolPool, type Tool, type ToolPool } from "../core/tool-framework.ts";
import { appConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { notificationBus } from "../skills/notification/index.ts";
import { CONFIRM_TIMEOUT_MS } from "./routes/constants.ts";
import {
  compressTrajectoryTool,
  discoverSkillsTool,
  writeSkillTool,
  readSkillTool,
  listSkillVersionsTool,
  restoreSkillVersionTool,
  pruneSkillVersionsTool,
} from "../skills/learning/index.ts";
import { selfModifyTool, ruleEngineOverrideTool } from "../skills/self-modify/index.ts";
import { agentLoopTool, createAgentLoopRunner } from "../skills/agent-loop/index.ts";
import { readFileTool, writeFileTool } from "../skills/file-tools.ts";
import { listSessions, getMessages, getSkillRegistry, upsertSkillRegistry } from "../core/session-db.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import { installSkillTool } from "../skills/marketplace/index.ts";
import { mcpBridgeTool } from "../skills/mcp-bridge/index.ts";
import { llmTaskTool } from "../skills/llm-task/index.ts";
import { multiAgentOrchestratorTool } from "../skills/multi-agent/index.ts";
import { createDelegateTaskTool, createDelegateDagTool } from "../skills/orchestrator/index.ts";
import { runCrewTaskTool } from "../skills/crewai/index.ts";
import { run_sop_workflow } from "../skills/sop/index.ts";
import { webAgentTool } from "../skills/web-agent/index.ts";
import { BrowserController, createBrowserTools } from "../skills/browser/index.ts";
import { canvas_draw, canvas_export } from "../skills/canvas/index.ts";
import { createGenerateSkillTool, loadSkillModule, extractToolsFromModule } from "../skills/skill-factory/index.ts";
import { runCodeTool } from "../skills/code-execution/index.ts";
import { createSecurityFramework } from "../core/security-framework.ts";
import { existsSync } from "fs";
import { join } from "path";
import type { LLMConfig } from "../core/llm-router.ts";
import type { AgentLoopRunner } from "../skills/agent-loop/index.ts";
import type { BaseMessage, ContentBlock, ToolProgressEvent } from "../types/index.ts";
import { autonomousEvolutionLoop, type AutonomousState } from "../skills/autonomous-evolution/index.ts";
import { KnowledgeBase } from "../skills/knowledge-base/index.ts";
import { onToolsReloaded } from "../core/tool-registry.ts";
import { initMcpTools } from "../tools/mcp-client/index.ts";

// =============================================================================
// Global Tool Pool (assembled once)
// =============================================================================

const globalPool = createToolPool();
globalPool.register(compressTrajectoryTool);
globalPool.register(discoverSkillsTool);
globalPool.register(writeSkillTool);
globalPool.register(readSkillTool);
globalPool.register(listSkillVersionsTool);
globalPool.register(restoreSkillVersionTool);
globalPool.register(pruneSkillVersionsTool);
globalPool.register(selfModifyTool);
globalPool.register(ruleEngineOverrideTool);
globalPool.register(agentLoopTool);
globalPool.register(readFileTool);
globalPool.register(writeFileTool);
globalPool.register(installSkillTool);
globalPool.register(mcpBridgeTool);
globalPool.register(multiAgentOrchestratorTool);
globalPool.register(runCrewTaskTool);
globalPool.register(run_sop_workflow);
globalPool.register(webAgentTool);
const browserController = new BrowserController({ headless: true });
// browser tools registered after llmCfg is defined below

const securityFramework = createSecurityFramework();
const knowledgeBase = new KnowledgeBase({ embedding: { provider: "xenova", model: "Xenova/all-MiniLM-L6-v2" } });

// =============================================================================
// LLM Config
// =============================================================================

const llmCfg: LLMConfig | undefined =
  appConfig.llm.apiKey && appConfig.llm.provider !== "local"
    ? {
        provider: appConfig.llm.provider,
        model: appConfig.llm.model,
        apiKey: appConfig.llm.apiKey,
        baseUrl: appConfig.llm.baseUrl,
        temperature: appConfig.llm.temperature,
        maxTokens: appConfig.llm.maxTokens,
      }
    : undefined;

for (const tool of createBrowserTools(browserController, llmCfg)) {
  globalPool.register(tool);
}
globalPool.register(canvas_draw);
globalPool.register(canvas_export);
globalPool.register(runCodeTool);
globalPool.register(llmTaskTool);
globalPool.register(createDelegateTaskTool({
  getGlobalTools: () => globalPool.all(),
  getLLMConfig: () => llmCfg,
}));
globalPool.register(createDelegateDagTool({
  getGlobalTools: () => globalPool.all(),
  getLLMConfig: () => llmCfg,
  runWorker: async (parentSessionId, workerSessionId, taskDescription, tools, llmCfg, opts) => {
    // Import at runtime to avoid circular dependency
    const { runWorkerAgent } = await import("../skills/orchestrator/index.ts");
    return runWorkerAgent(parentSessionId, workerSessionId, taskDescription, tools, llmCfg, opts);
  },
}));
globalPool.register(createGenerateSkillTool({
  getLLMConfig: () => llmCfg,
  getGlobalTools: () => globalPool.all(),
  onToolsLoaded: (tools) => reloadSkillTools(tools),
}));

onToolsReloaded((tools) => reloadSkillTools(tools));

// Initialize MCP tools asynchronously (optional dependency, fail-open)
initMcpTools((tool) => {
  if (!globalPool.get(tool.name)) {
    globalPool.register(tool);
  }
}).catch(() => {});

// =============================================================================
// Confirm Deferred Map
// =============================================================================

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const confirmMap = new Map<string, Deferred<boolean>>();
export const confirmRequestHandlers = new Map<string, (toolName: string, input: unknown) => void>();

// =============================================================================
// Runner Pool
// =============================================================================

const runners = new Map<string, AgentLoopRunner>();
const runnerPools = new Map<string, ToolPool>();
const runnerLastUsed = new Map<string, number>();
let maxRunners = 50;
let runnerIdleTimeoutMs = 30 * 60 * 1000;
let idleCleanupTimer: ReturnType<typeof setInterval> | null = null;

function createSessionPool(): ToolPool {
  const pool = createToolPool();
  for (const tool of globalPool.all()) {
    pool.register(tool);
  }
  return pool;
}

export function reloadSkillTools(skillTools: Tool<unknown, unknown, unknown>[]): number {
  let reloaded = 0;
  for (const tool of skillTools) {
    if (globalPool.reload(tool.name, tool)) {
      reloaded++;
    } else {
      globalPool.register(tool);
      reloaded++;
    }
    // Also propagate to active session pools
    for (const pool of runnerPools.values()) {
      if (pool.reload(tool.name, tool)) {
        // already existed, reloaded
      } else {
        pool.register(tool);
      }
    }
  }
  return reloaded;
}

export async function loadAndRegisterSkillTools(skillName: string): Promise<number> {
  const skillDir = join(process.cwd(), "skills", skillName);
  if (!existsSync(skillDir)) return 0;
  const mod = await loadSkillModule(skillDir);
  const tools = extractToolsFromModule(mod);
  return reloadSkillTools(tools);
}

export function getOrCreateRunner(sessionId: string): AgentLoopRunner {
  runnerLastUsed.set(sessionId, Date.now());
  if (runners.has(sessionId)) {
    return runners.get(sessionId)!;
  }

  // True LRU eviction if needed
  if (runners.size >= maxRunners) {
    let lruKey: string | undefined;
    let lruTime = Infinity;
    for (const [key, lastUsed] of runnerLastUsed) {
      if (lastUsed < lruTime) {
        lruTime = lastUsed;
        lruKey = key;
      }
    }
    if (lruKey) {
      runners.delete(lruKey);
      runnerPools.delete(lruKey);
      confirmMap.delete(lruKey);
      confirmRequestHandlers.delete(lruKey);
      runnerLastUsed.delete(lruKey);
    }
  }

  const skills = discoverSkills();
  const skillPrompts = skills.map((s) => `${s.name}: ${s.frontmatter.description}`);
  const sessionPool = createSessionPool();
  runnerPools.set(sessionId, sessionPool);

  const runner = createAgentLoopRunner({
    sessionId,
    tools: sessionPool.all(),
    llm: llmCfg,
    mode: "orchestrator",
    enableBackgroundReview: !!llmCfg,
    skillPrompts,
    enableActiveMemory: true,
    activeMemoryTopK: 3,
    activeMemoryMinScore: 0.6,
    knowledgeBase,
    askConfirmCallback: async (toolName, input) => {
      const handler = confirmRequestHandlers.get(sessionId);
      if (handler) {
        handler(toolName, input);
      }
      const deferred = createDeferred<boolean>();
      confirmMap.set(sessionId, deferred);
      // Web UI has 60 seconds to respond
      const timeout = setTimeout(() => {
        deferred.resolve(false);
        confirmMap.delete(sessionId);
      }, CONFIRM_TIMEOUT_MS);
      const result = await deferred.promise;
      clearTimeout(timeout);
      confirmMap.delete(sessionId);
      return result;
    },
  });

  runners.set(sessionId, runner);
  return runner;
}

export function resolveConfirm(sessionId: string, allowed: boolean): boolean {
  const deferred = confirmMap.get(sessionId);
  if (!deferred) return false;
  deferred.resolve(allowed);
  confirmMap.delete(sessionId);
  notificationBus.emitEvent({
    type: "audit",
    title: "权限确认",
    message: allowed ? `Session ${sessionId}: 用户允许工具调用` : `Session ${sessionId}: 用户拒绝工具调用`,
    timestamp: Date.now(),
    meta: { sessionId, allowed },
  });
  return true;
}

export function removeRunner(sessionId: string): boolean {
  confirmMap.delete(sessionId);
  confirmRequestHandlers.delete(sessionId);
  runnerLastUsed.delete(sessionId);
  runnerPools.delete(sessionId);
  return runners.delete(sessionId);
}

export async function* safeRun(
  sessionId: string,
  input: string | ContentBlock[]
): AsyncGenerator<
  | BaseMessage
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | ToolProgressEvent,
  void,
  unknown
> {
  runnerLastUsed.set(sessionId, Date.now());
  const runner = getOrCreateRunner(sessionId);
  try {
    for await (const msg of runner.run(input)) {
      if ("type" in msg && msg.type === "tool_result") {
        const decision = msg.isError ? "deny" : "allow";
        securityFramework.securityAuditor.logDecision(sessionId, "unknown", { toolUseId: msg.toolUseId, content: msg.content }, decision, msg.isError ? "tool_error" : "success");
      }
      yield msg;
    }
  } catch (e) {
    removeRunner(sessionId);
    securityFramework.securityAuditor.logDecision(sessionId, "runner", { input: String(input).slice(0, 500) }, "deny", String(e));
    notificationBus.emitEvent({
      type: "audit",
      title: "Runner 错误",
      message: `Session ${sessionId}: ${String(e)}`,
      timestamp: Date.now(),
      meta: { sessionId, error: String(e) },
    });
    throw e;
  }
}

export function startRunnerIdleCleanup(intervalMs = 60000): void {
  if (idleCleanupTimer) return;
  idleCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, lastUsed] of runnerLastUsed) {
      if (now - lastUsed > runnerIdleTimeoutMs) {
        removeRunner(sessionId);
        runnerLastUsed.delete(sessionId);
      }
    }
  }, intervalMs);
}

export function stopRunnerIdleCleanup(): void {
  if (idleCleanupTimer) {
    clearInterval(idleCleanupTimer);
    idleCleanupTimer = null;
  }
}

// =============================================================================
// Autonomous Evolution Daemon
// =============================================================================

export function getDaemonStatus(): { running: boolean; state?: AutonomousState } {
  return {
    running: autonomousEvolutionLoop.isRunning(),
    state: autonomousEvolutionLoop.getState(),
  };
}

export function startDaemon(): boolean {
  if (autonomousEvolutionLoop.isRunning()) return false;
  autonomousEvolutionLoop.start();
  return true;
}

export function stopDaemon(): boolean {
  if (!autonomousEvolutionLoop.isRunning()) return false;
  autonomousEvolutionLoop.stop();
  return true;
}

export async function reconcileSkillRegistry(): Promise<void> {
  const fsSkills = discoverSkills();
  const dbRes = await getSkillRegistry();
  const dbNames = new Set(dbRes.success ? dbRes.data.map((r) => r.name) : []);

  // Upsert filesystem skills missing from DB
  for (const skill of fsSkills) {
    if (!dbNames.has(skill.name)) {
      await upsertSkillRegistry(skill.name, skill.directory, skill.frontmatter, skill.frontmatter.autoLoad ?? false);
      logger.info("Reconciled skill into registry", { name: skill.name, directory: skill.directory });
    }
  }

  // Optionally log orphaned DB entries (do not auto-delete to avoid data loss)
  const fsNames = new Set(fsSkills.map((s) => s.name));
  if (dbRes.success) {
    for (const row of dbRes.data) {
      if (!fsNames.has(row.name) && !existsSync(row.directory)) {
        logger.warn("Skill registry entry has no filesystem counterpart", { name: row.name, directory: row.directory });
      }
    }
  }
}

export function setRunnerPoolLimits(opts: { maxRunners?: number; idleTimeoutMs?: number }): void {
  if (opts.maxRunners !== undefined) maxRunners = opts.maxRunners;
  if (opts.idleTimeoutMs !== undefined) runnerIdleTimeoutMs = opts.idleTimeoutMs;
}

export function getRunnerPoolStats(): { size: number; maxRunners: number; idleTimeoutMs: number } {
  return { size: runners.size, maxRunners, idleTimeoutMs: runnerIdleTimeoutMs };
}

export function resetRunnerPool(): void {
  runners.clear();
  runnerPools.clear();
  confirmMap.clear();
  confirmRequestHandlers.clear();
  runnerLastUsed.clear();
  stopRunnerIdleCleanup();
}

export function getSessionToolCount(sessionId: string): number {
  return runnerPools.get(sessionId)?.all().length ?? 0;
}

export { llmCfg, globalPool, discoverSkills, listSessions, getMessages, installSkillTool };
