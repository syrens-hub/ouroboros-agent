import { createToolPool, StreamingToolExecutor } from "../../core/tool-framework.ts";
import { createSelfHealer, type SelfHealer } from "../self-healing/index.ts";
import { runPermissionPipeline } from "../../core/permission-gate.ts";
import { createSandboxContext, createSandboxToolCallContext } from "../sandbox/index.ts";
import { type LLMConfig } from "../../core/llm-resilience.ts";
import {
  createSession,
  appendMessage,
  updateSession,
} from "../../core/session-db.ts";
import { spawnBackgroundReview } from "../learning/review-agent.ts";
import { notificationBus } from "../notification/index.ts";
import { logger } from "../../core/logger.ts";
import { sanitizeUserInput } from "../../core/prompt-defense.ts";
import {
  maybeCompressMessages,
} from "./trajectory-utils.ts";
import {
  adaptiveMemoryBudget,
  estimateInjectionTokens,
  buildMemoryLayerInjection,
  buildKbInjection,
} from "./context-utils.ts";
import type {
  AgentLoopState,
  BaseMessage,
  Tool,
  ToolPermissionContext,
  ToolUseBlock,
  TaskId,
  ContentBlock,
  ToolProgressEvent,
} from "../../types/index.ts";
import { createContextManager, type ContextManager, type InjectionItem, type PruningStrategy } from "../context-management/index.ts";
import { ContextCompressor } from "../context-management/compressor.ts";
import { AdaptiveOptimizer } from "../learning/adaptive-optimizer.ts";
import { createPersonalityEvolution, buildPersonalityPrompt } from "../personality/index.ts";
import { KnowledgeBase } from "../knowledge-base/index.ts";
import { searchMemoryLayers, type MemoryLayerEntry } from "../../core/repositories/memory-layers.ts";
import { insertTokenUsage, getSessionTokenUsage } from "../../core/repositories/token-usage.ts";
import { saveTraceEvent } from "../../core/repositories/trajectory.ts";
import { hookRegistry } from "../../core/hook-system.ts";
import { getSessionState } from "../../core/session-state.ts";
import { getCachedProjectMemory } from "../../core/project-memory.ts";
import { recordDenial, recordSuccess, shouldFallbackToPrompting, buildDenialHint } from "../../core/denial-tracker.ts";
import { startTurnSpan, endTurnSpan, startToolSpan, endToolSpan } from "../telemetry/telemetry-spans.ts";
import { createAgentLoopState } from "./state.ts";
import { createRealLLMCaller, createMockLLMCaller, type LLMCaller } from "./llm-callers.ts";
import { createCheckpoint } from "../checkpoint/index.ts";

// =============================================================================
// Loop Control Config
// =============================================================================

export interface Progress {
  currentIteration: number;
  maxIterations: number;
  checkpointId?: string;
  status: "running" | "paused" | "idle" | "error";
  elapsedMs?: number;
}

export interface LoopConfig {
  max_iterations: number;       // default 100
  checkpoint_interval: number;   // default: save checkpoint every N turns
  enable_pause: boolean;          // support pause
  enable_resume: boolean;         // support resume
  progress_callback?: (progress: Progress) => void;
  on_loop_start?: () => void | Promise<void>;
  on_loop_end?: (finalProgress: Progress) => void | Promise<void>;
}

const DEFAULT_LOOP_CONFIG: LoopConfig = {
  max_iterations: 100,
  checkpoint_interval: 5,
  enable_pause: false,
  enable_resume: false,
};

// =============================================================================
// Agent Loop Runner
// =============================================================================

export interface AgentLoopRunner {
  run(userInput: string | ContentBlock[]): AsyncGenerator<BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent, void, unknown>;
  getState(): AgentLoopState;
  pause(): void;
  resume(): void;
  setAbortSignal(signal: AbortSignal): void;
  exportState(): LoopStateSnapshot;
  importState(snapshot: LoopStateSnapshot): void;
}

export interface LoopStateSnapshot {
  sessionId: string;
  turnCount: number;
  messages: BaseMessage[];
  status: string;
  loadedSkills: string[];
  checkpointId?: string;
  exportedAt: number;
}
export function createAgentLoopRunner(opts: {
  sessionId: string;
  tools: Tool<unknown, unknown, unknown>[];
  llm?: LLMConfig;
  llmCaller?: LLMCaller;
  permissionCtx?: ToolPermissionContext;
  enableBackgroundReview?: boolean;
  askConfirmCallback?: (toolName: string, input: unknown) => Promise<boolean>;
  skillPrompts?: string[];
  selfHealer?: SelfHealer;
  contextManager?: ContextManager;
  contextInjections?: InjectionItem[];
  adaptiveOptimizer?: AdaptiveOptimizer;
  onTurnEnd?: (opts: { sessionId: string; turnCount: number; success: boolean }) => void | Promise<void>;
  enablePersonality?: boolean;
  enableActiveMemory?: boolean;
  activeMemoryTopK?: number;
  activeMemoryMinScore?: number;
  knowledgeBase?: KnowledgeBase;
  enableContextCompression?: boolean;
  mode?: "orchestrator" | "worker";
  loopConfig?: Partial<LoopConfig>;
}): AgentLoopRunner {
  const state = createAgentLoopState(opts.sessionId, opts.skillPrompts, opts.mode);
  const toolPool = createToolPool();
  for (const t of opts.tools) toolPool.register(t);
  const llmCaller = opts.llmCaller || (opts.llm ? createRealLLMCaller(opts.llm) : createMockLLMCaller());
  const llmCfg: LLMConfig = opts.llm || { provider: "local" as const, model: "mock" };
  const selfHealer = opts.selfHealer || createSelfHealer();
  const contextManager = opts.contextManager || createContextManager();
  const contextCompressor = new ContextCompressor();
  const permCtx: ToolPermissionContext = opts.permissionCtx || {
    alwaysAllowRules: ["write_skill", "read_skill", "discover_skills", "compress_trajectory", "read_file", "delegate_task"],
    alwaysDenyRules: [],
    alwaysAskRules: ["self_modify", "rule_engine_override", "write_file"],
    mode: "interactive",
    source: "session",
  };

  const loopCfg: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...opts.loopConfig };
  const abortController = new AbortController();
  let externalAbortSignal: AbortSignal | undefined;
  let sessionInitialized = false;
  let pendingDenialHint: string | null = null;
  let paused = false;
  let pauseResolve: (() => void) | null = null;
  let lastCheckpointId: string | undefined;
  const loopStartMs = Date.now();

  const safeIgnore = (p: Promise<unknown>) => {
    p.catch(() => {});
  };

  const emitProgress = (overrides: Partial<Progress> = {}) => {
    if (loopCfg.progress_callback) {
      loopCfg.progress_callback({
        currentIteration: state.turnCount,
        maxIterations: loopCfg.max_iterations,
        checkpointId: lastCheckpointId,
        status: paused ? "paused" : state.status,
        elapsedMs: Date.now() - loopStartMs,
        ...overrides,
      });
    }
  };

  const saveCheckpointIfNeeded = async () => {
    if (state.turnCount > 0 && loopCfg.checkpoint_interval > 0 && state.turnCount % loopCfg.checkpoint_interval === 0) {
      const cp = createCheckpoint(process.cwd(), opts.sessionId);
      if (cp.success) {
        lastCheckpointId = cp.data.id;
        emitProgress({ checkpointId: cp.data.id });
      }
    }
  };

  return {
    pause() {
      if (loopCfg.enable_pause) {
        paused = true;
        emitProgress({ status: "paused" });
      }
    },
    resume() {
      if (loopCfg.enable_resume && paused) {
        paused = false;
        emitProgress({ status: "running" });
        if (pauseResolve) {
          pauseResolve();
          pauseResolve = null;
        }
      }
    },
    setAbortSignal(signal: AbortSignal) {
      externalAbortSignal = signal;
    },
    exportState(): LoopStateSnapshot {
      return {
        sessionId: opts.sessionId,
        turnCount: state.turnCount,
        messages: structuredClone(state.messages),
        status: state.status,
        loadedSkills: [...state.loadedSkills],
        checkpointId: lastCheckpointId,
        exportedAt: Date.now(),
      };
    },
    importState(snapshot: LoopStateSnapshot) {
      state.turnCount = snapshot.turnCount;
      state.messages = structuredClone(snapshot.messages);
      state.status = snapshot.status as AgentLoopState["status"];
      state.loadedSkills = [...snapshot.loadedSkills];
      lastCheckpointId = snapshot.checkpointId;
    },
    async *run(userInput) {
      if (!sessionInitialized) {
        await createSession(opts.sessionId, {
          model: llmCfg.model,
          provider: llmCfg.provider,
          title: "Ouroboros Session",
        });
        sessionInitialized = true;
      }

      const userMessage: BaseMessage = typeof userInput === "string"
        ? { role: "user", content: sanitizeUserInput(userInput) }
        : { role: "user", content: userInput };
      state.messages.push(userMessage);
      await appendMessage(opts.sessionId, userMessage);
      state.status = "running";

      // Pre-fetch active memory sources (injection happens per-turn via ContextManager)
      let memoryLayerHits: MemoryLayerEntry[] = [];
      let kbHits: { content: string; score: number; metadata?: Record<string, unknown> }[] = [];
      if (opts.enableActiveMemory) {
        try {
          const queryText = typeof userInput === "string"
            ? userInput
            : userInput.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text).join(" ");

          const layerResult = searchMemoryLayers({ query: queryText || "(image)", sessionId: opts.sessionId, limit: 5 });
          if (layerResult.success) memoryLayerHits = layerResult.data;

          if (opts.knowledgeBase) {
            const memResult = await opts.knowledgeBase.queryKnowledge(
              opts.sessionId,
              queryText || "(image)",
              5 // fetch a generous pool; actual injection count is adaptive
            );
            kbHits = memResult.results.filter((r) => r.score >= (opts.activeMemoryMinScore ?? 0.6));
          }
        } catch {
          // Fail-open: do not block conversation if memory lookup fails
        }
      }

      while (state.turnCount < state.maxTurns) {
        state.turnCount++;
        startTurnSpan(opts.sessionId, state.turnCount);
        await hookRegistry.emit("agent:turnStart", { sessionId: opts.sessionId, turn: state.turnCount });

        // --- pause mechanism ---
        if (paused && loopCfg.enable_pause) {
          await new Promise<void>((resolve) => {
            pauseResolve = resolve;
            emitProgress({ status: "paused" });
          });
          paused = false;
        }

        // Check max iterations
        if (loopCfg.max_iterations > 0 && state.turnCount >= loopCfg.max_iterations) {
          state.status = "idle";
          const finalProgress: Progress = {
            currentIteration: state.turnCount,
            maxIterations: loopCfg.max_iterations,
            checkpointId: lastCheckpointId,
            status: "idle",
            elapsedMs: Date.now() - loopStartMs,
          };
          if (loopCfg.on_loop_end) await loopCfg.on_loop_end(finalProgress);
          emitProgress({ status: "idle" });
          break;
        }

        // Inject project memory (OUROBOROS.md) into system prompt
        try {
          const projectMemory = getCachedProjectMemory(opts.sessionId, process.cwd());
          if (projectMemory && state.messages.length > 0 && state.messages[0]!.role === "system") {
            const sys = state.messages[0]!;
            const memorySection = "\n\n[Project context from OUROBOROS.md]\n" + projectMemory;
            sys.content = (typeof sys.content === "string" ? sys.content : "").split("\n\n[Project context from OUROBOROS.md]")[0] + memorySection;
          }
        } catch {
          // fail-open
        }

        // Inject denial fallback hint if a tool pattern was repeatedly denied
        if (pendingDenialHint) {
          const hintMsg: BaseMessage = { role: "user", content: pendingDenialHint };
          state.messages.push(hintMsg);
          await appendMessage(opts.sessionId, hintMsg);
          pendingDenialHint = null;
        }

        // Adaptive optimizer: suggest config before LLM call
        const adaptiveConfig = opts.adaptiveOptimizer ? opts.adaptiveOptimizer.suggestConfig(opts.sessionId) : null;
        const pruningStrategy = (adaptiveConfig?.pruningStrategy as PruningStrategy | undefined) || "balanced";
        const contextBudget = (adaptiveConfig?.contextBudget as number) || (state.contextBudget ?? 8000);
        if (adaptiveConfig && llmCfg.provider !== "local") {
          llmCfg.temperature = adaptiveConfig.temperature ?? llmCfg.temperature;
          llmCfg.maxTokens = adaptiveConfig.maxTokens ?? llmCfg.maxTokens;
        }

        // Adaptive context compression before pruning
        let compressedMessages = await maybeCompressMessages(state.messages, state.compressThreshold ?? 6400, state.contextBudget ?? 8000);

        // Structured LLM-based context compression (v3)
        if (opts.enableContextCompression !== false && llmCfg.provider !== "local") {
          const compressorResult = await contextCompressor.compress(compressedMessages, {
            threshold: state.compressThreshold ?? 6400,
            tailTokenBudget: Math.floor((state.contextBudget ?? 8000) * 0.5),
          });
          if (compressorResult.success) {
            compressedMessages = compressorResult.data;
          }
        }

        // Build personality injection
        const personalityInjections: InjectionItem[] = [];
        if (opts.enablePersonality !== false) {
          try {
            const pe = createPersonalityEvolution(opts.sessionId);
            const prompt = buildPersonalityPrompt(pe.getState(), pe.getAnchorMemories());
            if (prompt) {
              personalityInjections.push({
                id: "personality-system",
                content: prompt,
                tokenCount: estimateInjectionTokens(prompt),
                priority: 10,
                enabled: true,
                point: "system",
              });
            }
          } catch {
            // fail-open: do not block conversation if personality loading fails
          }
        }

        // Build active-memory injections for this turn
        let contextResult: Awaited<ReturnType<ContextManager["buildContext"]>>;
        const memoryInjections: InjectionItem[] = [];
        if (opts.enableActiveMemory && (memoryLayerHits.length > 0 || kbHits.length > 0)) {
          const { topK, maxTokens } = adaptiveMemoryBudget(contextBudget);

          if (memoryLayerHits.length > 0) {
            memoryInjections.push(buildMemoryLayerInjection(memoryLayerHits.slice(0, topK)));
          }

          if (kbHits.length > 0) {
            memoryInjections.push(buildKbInjection(kbHits.slice(0, topK)));
          }

          contextResult = await contextManager.buildContext({
            messages: compressedMessages,
            pruning: {
              strategy: pruningStrategy,
              targetTokens: contextBudget,
              minMessages: 4,
              maxMessages: 60,
              preserveSystem: true,
              preserveFirstUserMessage: true,
              preserveToolResults: true,
              preserveRecentMessages: 6,
            },
            injections: [...personalityInjections, ...memoryInjections, ...(opts.contextInjections || [])],
            maxInjectionTokens: maxTokens,
          });
        } else {
          contextResult = await contextManager.buildContext({
            messages: compressedMessages,
            pruning: {
              strategy: pruningStrategy,
              targetTokens: contextBudget,
              minMessages: 4,
              maxMessages: 60,
              preserveSystem: true,
              preserveFirstUserMessage: true,
              preserveToolResults: true,
              preserveRecentMessages: 6,
            },
            injections: [...personalityInjections, ...(opts.contextInjections || [])],
            maxInjectionTokens: 512,
          });
        }
        if (contextResult.pruningStats && contextResult.pruningStats.removedCount > 0) {
          logger.info("Agent loop context pruned", { sessionId: opts.sessionId, ...contextResult.pruningStats });
        }

        const llmTraceId = crypto.randomUUID();
        const llmStart = Date.now();
        safeIgnore(
          saveTraceEvent({
            traceId: llmTraceId,
            sessionId: opts.sessionId,
            turn: state.turnCount,
            timestamp: llmStart,
            type: "llm_call",
            actor: `${llmCfg.provider}/${llmCfg.model}`,
            input: {
              messages: contextResult.messages.map((m) => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : "[blocks]",
              })),
              tools: toolPool.all().map((t) => t.name),
            },
          })
        );

        if (externalAbortSignal?.aborted) {
          state.status = "idle";
          throw new Error("Agent loop aborted by external signal");
        }
        const assistantMsg = await llmCaller.call(contextResult.messages, toolPool.all(), externalAbortSignal);
        await hookRegistry.emit("agent:llmCall", {
          sessionId: opts.sessionId,
          turn: state.turnCount,
          latencyMs: Date.now() - llmStart,
          tokens: assistantMsg.usage?.totalTokens,
        });

        safeIgnore(
          saveTraceEvent({
            traceId: llmTraceId,
            sessionId: opts.sessionId,
            turn: state.turnCount,
            timestamp: Date.now(),
            type: "llm_call",
            actor: `${llmCfg.provider}/${llmCfg.model}`,
            output: {
              content: typeof assistantMsg.content === "string" ? assistantMsg.content : "[blocks]",
              usage: assistantMsg.usage,
            },
            latencyMs: Date.now() - llmStart,
            tokens: assistantMsg.usage?.totalTokens,
          })
        );

        endTurnSpan(opts.sessionId, true);
        await hookRegistry.emit("agent:turnEnd", { sessionId: opts.sessionId, turn: state.turnCount });

        // Save checkpoint at configured intervals
        await saveCheckpointIfNeeded();
        emitProgress();

        // Record token usage for this turn
        try {
          let estimatedTokens = 0;
          if (assistantMsg.usage && (assistantMsg.usage.promptTokens > 0 || assistantMsg.usage.completionTokens > 0)) {
            estimatedTokens = assistantMsg.usage.totalTokens;
          } else {
            const inputText = contextResult.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("");
            const outputText = typeof assistantMsg.content === "string" ? assistantMsg.content : JSON.stringify(assistantMsg.content);
            const cjk = (inputText + outputText).match(/[\u4e00-\u9fff]/g)?.length ?? 0;
            const rest = (inputText + outputText).length - cjk;
            estimatedTokens = Math.ceil(cjk / 2 + rest / 4);
          }
          if (estimatedTokens > 0) {
            insertTokenUsage(opts.sessionId, estimatedTokens);
            const sessionState = getSessionState(opts.sessionId);
            sessionState.tokenCounters.totalOutput += assistantMsg.usage?.completionTokens ?? Math.ceil(estimatedTokens / 3);
            sessionState.tokenCounters.totalInput += assistantMsg.usage?.promptTokens ?? Math.ceil(estimatedTokens * 2 / 3);
            const sessionTotal = getSessionTokenUsage(opts.sessionId);
            const TOKEN_ALERT_THRESHOLD = 100_000;
            if (sessionTotal > TOKEN_ALERT_THRESHOLD) {
              notificationBus.emitEvent({
                type: "audit",
                title: "Token 使用量告警",
                message: `会话 ${opts.sessionId} 累计 Token 估算量已突破 ${TOKEN_ALERT_THRESHOLD}（当前约 ${sessionTotal}）`,
                timestamp: Date.now(),
                meta: { sessionId: opts.sessionId, threshold: TOKEN_ALERT_THRESHOLD, estimatedTotal: sessionTotal },
              });
            }
          }
        } catch {
          // fail-open: never block conversation due to metrics recording
        }

        state.messages.push(assistantMsg as BaseMessage);

        const contentStr = typeof assistantMsg.content === "string" ? assistantMsg.content : JSON.stringify(assistantMsg.content);
        const toolCalls = Array.isArray(assistantMsg.content)
          ? assistantMsg.content.filter((b) => b.type === "tool_use")
          : [];

        await appendMessage(opts.sessionId, { role: "assistant", content: contentStr }, { toolCalls });
        yield assistantMsg as BaseMessage;

        // Extract tool uses
        const blocks: ToolUseBlock[] = [];
        if (Array.isArray(assistantMsg.content)) {
          for (const block of assistantMsg.content) {
            if (typeof block === "object" && block.type === "tool_use") {
              blocks.push(block as ToolUseBlock);
            }
          }
        }

        if (blocks.length === 0) {
          state.status = "idle";
          await updateSession(opts.sessionId, {
            turn_count: state.turnCount,
            message_count: state.messages.length,
            status: "idle",
          });

          // Trigger background review when conversation naturally ends
          if (opts.enableBackgroundReview !== false && llmCfg.provider !== "local") {
            spawnBackgroundReview(opts.sessionId, llmCfg, {
              autoApplyLowRisk: true,
              onDecision: (decision) => {
                if (decision.action !== "no_action") {
                  logger.info("Background Review decision", { action: decision.action, skillName: decision.skillName || "(none)", sessionId: opts.sessionId });
                  notificationBus.emitEvent({
                    type: "review_decision",
                    title: "后台审查决策",
                    message: decision.skillName
                      ? `${decision.action}: ${decision.skillName}`
                      : `Action: ${decision.action}`,
                    timestamp: Date.now(),
                    meta: { sessionId: opts.sessionId, decision },
                  });
                  if (decision.action === "create" && decision.skillName) {
                    notificationBus.emitEvent({
                      type: "skill_learned",
                      title: "新技能已学习",
                      message: `Background Review 自动创建技能: ${decision.skillName}`,
                      timestamp: Date.now(),
                      meta: { sessionId: opts.sessionId, skillName: decision.skillName },
                    });
                  }
                }
              },
            });
          }
          if (opts.onTurnEnd) {
            await opts.onTurnEnd({ sessionId: opts.sessionId, turnCount: state.turnCount, success: true });
          }
          break;
        }

        // Snapshot before tool execution for self-healing
        const toolSnapshot = selfHealer.createSnapshot({
          sessionId: state.sessionId,
          messages: [...state.messages],
          memoryState: { turnCount: state.turnCount, loadedSkills: [...state.loadedSkills] },
          toolStates: {},
          config: { llm: llmCfg },
        });

        // Execute tools with streaming executor
        const progressQueue: ToolProgressEvent[] = [];
        const executor = new StreamingToolExecutor(
          {
            taskId: state.sessionId as TaskId,
            abortSignal: abortController.signal,
            reportProgress: (p) => {
              progressQueue.push(p as ToolProgressEvent);
            },
            invokeSubagent: async (tool, input) => {
              // Enforce sandbox read-only for all subagent invocations
              const sandbox = createSandboxContext(
                { loopState: state, abortController },
                { readOnly: true }
              );
              const subagentCtx = createSandboxToolCallContext(sandbox);
              const subPermCtx: ToolPermissionContext = { ...permCtx, readOnly: true };
              const perm = runPermissionPipeline({ tool, toolInput: input, ctx: subPermCtx });
              if (!perm.success || perm.data === "deny") {
                throw new Error("Permission denied for subagent tool invocation.");
              }
              return tool.call(input, subagentCtx);
            },
          },
          {
            onToolError: async (tracked, error) => {
              const repair = await selfHealer.attemptRepair({
                error,
                context: { toolName: tracked.tool.name, input: tracked.input, sessionId: state.sessionId },
                currentSnapshot: toolSnapshot,
              });
              if (repair.success && !repair.rollbackPerformed) {
                return { retry: true };
              }
              if (repair.rollbackPerformed && repair.newSnapshotId) {
                const rolledBack = selfHealer.getSnapshots(state.sessionId).find((s) => s.id === repair.newSnapshotId);
                if (rolledBack) {
                  Object.assign(state, {
                    messages: rolledBack.messages,
                    turnCount: (rolledBack.memoryState.turnCount as number) || state.turnCount,
                    loadedSkills: (rolledBack.memoryState.loadedSkills as string[]) || state.loadedSkills,
                  });
                }
              }
              return { retry: false };
            },
          }
        );

        for (const block of blocks) {
          const tool = toolPool.get(block.name);
          if (!tool) {
            const msg = {
              role: "tool_result" as const,
              content: `Tool '${block.name}' not found.`,
              name: block.id,
            };
            state.messages.push(msg);
            await appendMessage(opts.sessionId, msg);
            yield { type: "tool_result", toolUseId: block.id, content: msg.content, isError: true };
            continue;
          }

          // Validate input
          const parseResult = tool.inputSchema.safeParse(block.input);
          if (!parseResult.success) {
            const msg = {
              role: "tool_result" as const,
              content: `Invalid input for ${block.name}: ${parseResult.error.message}`,
              name: block.id,
            };
            state.messages.push(msg);
            await appendMessage(opts.sessionId, msg);
            yield { type: "tool_result", toolUseId: block.id, content: msg.content, isError: true };
            continue;
          }

          // Permission check
          const perm = runPermissionPipeline({
            tool,
            toolInput: parseResult.data,
            ctx: permCtx,
          });
          if (!perm.success) {
            const msg = {
              role: "tool_result" as const,
              content: `Permission error: ${perm.error.message}`,
              name: block.id,
            };
            state.messages.push(msg);
            await appendMessage(opts.sessionId, msg);
            yield { type: "tool_result", toolUseId: block.id, content: msg.content, isError: true };
            continue;
          }
          if (perm.data !== "allow") {
            if (perm.data === "ask" && opts.askConfirmCallback) {
              const confirmed = await opts.askConfirmCallback(block.name, parseResult.data);
              if (!confirmed) {
                recordDenial(block.name, "");
                if (shouldFallbackToPrompting(block.name, "")) {
                  pendingDenialHint = buildDenialHint(block.name);
                }
                const msg = {
                  role: "tool_result" as const,
                  content: `Permission level 'ask' for ${block.name}. User denied confirmation.`,
                  name: block.id,
                };
                state.messages.push(msg);
                await appendMessage(opts.sessionId, msg);
                yield { type: "tool_result", toolUseId: block.id, content: msg.content, isError: true };
                continue;
              }
            } else {
              const msg = {
                role: "tool_result" as const,
                content: `Permission level '${perm.data}' for ${block.name}. Execution blocked.`,
                name: block.id,
              };
              state.messages.push(msg);
              await appendMessage(opts.sessionId, msg);
              yield { type: "tool_result", toolUseId: block.id, content: msg.content, isError: true };
              continue;
            }
          }

          safeIgnore(
            saveTraceEvent({
              traceId: block.id,
              sessionId: opts.sessionId,
              turn: state.turnCount,
              timestamp: Date.now(),
              type: "tool_call",
              actor: block.name,
              input: parseResult.data,
            })
          );

          startToolSpan(opts.sessionId, state.turnCount, block.name);
          executor.addTool(block.id, tool, parseResult.data);
        }

        const executionPromise = executor.executeAll();

        // Poll for progress events while tools are executing
        while (true) {
          const done = await Promise.race([
            executionPromise.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
          ]);
          while (progressQueue.length > 0) {
            const ev = progressQueue.shift()!;
            if (ev.toolName === "computer_use") {
              const block = blocks.find((b) => b.name === "computer_use");
              if (block) ev.toolUseId = block.id;
            }
            yield ev;
          }
          if (done) break;
        }
        const results = await executionPromise;

        // Persist snapshot on successful tool execution
        if (results.size > 0 && Array.from(results.values()).every((r) => r.success)) {
          toolSnapshot.metadata = { ...toolSnapshot.metadata, stable: true };
        }
        for (const [toolUseId, result] of results) {
          safeIgnore(
            saveTraceEvent({
              traceId: toolUseId,
              sessionId: opts.sessionId,
              turn: state.turnCount,
              timestamp: Date.now(),
              type: "tool_result",
              actor: blocks.find((b) => b.id === toolUseId)?.name || "unknown",
              output: result.success ? result.data : { error: result.error.message },
            })
          );
          const toolName = blocks.find((b) => b.id === toolUseId)?.name || "unknown";
          endToolSpan(opts.sessionId, toolName, result.success, result.success ? undefined : (result.error?.message || "Error"));
          await hookRegistry.emit("agent:toolCall", {
            sessionId: opts.sessionId,
            turn: state.turnCount,
            toolName,
            success: result.success,
          });

          if (result.success) {
            const toolName = blocks.find((b) => b.id === toolUseId)?.name || "unknown";
            recordSuccess(toolName, "");
          }

          const content = result.success
            ? JSON.stringify(result.data, null, 2)
            : `Error: ${result.error.message}`;
          const toolResultMsg = {
            role: "tool_result" as const,
            content,
            name: toolUseId,
          };
          state.messages.push(toolResultMsg);
          await appendMessage(opts.sessionId, toolResultMsg);
          yield {
            type: "tool_result",
            toolUseId,
            content,
            isError: !result.success,
          };

          // Auto-ingest successful computer_use trajectories into knowledge base
          if (result.success && opts.knowledgeBase) {
            const block = blocks.find((b) => b.id === toolUseId);
            if (block && block.name === "computer_use") {
              try {
                const data = result.data as Record<string, unknown> | undefined;
                const history = Array.isArray(data?.history) ? (data.history as string[]) : [];
                if (history.length > 0) {
                  const md = [
                    `# Computer Use Trajectory`,
                    ``,
                    `- Goal: ${String(data?.goal || "")}`,
                    `- Final URL: ${String(data?.finalUrl || "")}`,
                    `- Summary: ${String(data?.summary || "")}`,
                    `- Steps: ${Number(data?.stepsTaken || 0)}`,
                    ``,
                    `## History`,
                    ...history.map((h, i) => `${i + 1}. ${h}`),
                    ``,
                    `## Learned Pattern`,
                    `To accomplish "${String(data?.goal || "")}", perform the browser actions listed above.`,
                  ].join("\n");
                  await opts.knowledgeBase.ingestDocument(opts.sessionId, md, {
                    isFile: false,
                    filename: `computer-use-${Date.now()}.md`,
                    format: "md",
                  });
                }
              } catch {
                // Ignore ingestion errors to avoid breaking the agent loop
              }
            }
          }
        }
      }

      state.status = "idle";
      const finalProgress: Progress = {
        currentIteration: state.turnCount,
        maxIterations: loopCfg.max_iterations,
        checkpointId: lastCheckpointId,
        status: "idle",
        elapsedMs: Date.now() - loopStartMs,
      };
      if (loopCfg.on_loop_end) await loopCfg.on_loop_end(finalProgress);
      emitProgress({ status: "idle" });
      if (opts.onTurnEnd) {
        await opts.onTurnEnd({ sessionId: opts.sessionId, turnCount: state.turnCount, success: true });
      }
    },
    getState() {
      return structuredClone(state);
    },
  };
}
