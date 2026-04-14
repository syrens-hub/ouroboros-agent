/**
 * Ouroboros Agent Loop Skill
 * ==========================
 * The main agent loop is NOT sacred. It is a Skill that can be learned,
 * patched, and even replaced by a better loop.
 *
 * This version integrates:
 *   - Real LLM routing (OpenAI / Anthropic / Local)
 *   - SessionDB persistence
 *   - Background review trigger
 */

import { z } from "zod";
import { buildTool, createToolPool, StreamingToolExecutor } from "../../core/tool-framework.ts";
import { createSelfHealer, type SelfHealer } from "../../core/self-healing.ts";
import { runPermissionPipeline } from "../../core/permission-gate.ts";
import { createSandboxContext, createSandboxToolCallContext } from "../../core/sandbox.ts";
import { callLLMWithResilience, type LLMConfig } from "../../core/llm-resilience.ts";
import {
  createSession,
  appendMessage,
  updateSession,
} from "../../core/session-db.ts";
import { spawnBackgroundReview } from "../learning/review-agent.ts";
import { notificationBus } from "../../core/notification-bus.ts";
import { logger } from "../../core/logger.ts";
import { sanitizeUserInput } from "../../core/prompt-defense.ts";
import { createTrajectoryCompressor } from "../learning/index.ts";
import type {
  AgentLoopState,
  BaseMessage,
  Tool,
  ToolPermissionContext,
  ToolUseBlock,
  AssistantMessage,
  TaskId,
  ContentBlock,
  TrajectoryEntry,
  ToolProgressEvent,
} from "../../types/index.ts";
import { createContextManager, type ContextManager, type InjectionItem, type PruningStrategy } from "../context-management/index.ts";
import { AdaptiveOptimizer } from "../learning/adaptive-optimizer.ts";
import { KnowledgeBase } from "../knowledge-base/index.ts";
import { searchMemoryLayers, type MemoryLayerEntry } from "../../core/repositories/memory-layers.ts";
import { insertTokenUsage, getSessionTokenUsage } from "../../core/repositories/token-usage.ts";

// =============================================================================
// Context Compression Helpers
// =============================================================================

function estimateMessageTokens(messages: BaseMessage[]): number {
  const text = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("");
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount + otherCount / 4);
}

function baseMessagesToTrajectoryEntries(messages: BaseMessage[]): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = [];
  let current: TrajectoryEntry | null = null;
  let turn = 1;

  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      if (current) entries.push(current);
      current = { turn: turn++, messages: [msg], toolCalls: [], outcome: "success" };
    } else if (msg.role === "assistant") {
      if (!current) current = { turn: turn++, messages: [], toolCalls: [], outcome: "success" };
      current.messages.push(msg);
      if (Array.isArray(msg.content)) {
        const tcs = msg.content.filter(
          (b): b is ToolUseBlock => typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use"
        );
        current.toolCalls.push(...tcs);
      }
    } else if (msg.role === "tool_result") {
      if (!current) current = { turn: turn++, messages: [], toolCalls: [], outcome: "success" };
      current.messages.push(msg);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function flattenTrajectoryEntries(entries: TrajectoryEntry[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const e of entries) {
    for (const m of e.messages) out.push(m);
  }
  return out;
}

async function maybeCompressMessages(
  messages: BaseMessage[],
  threshold: number,
  targetBudget: number
): Promise<BaseMessage[]> {
  const totalTokens = estimateMessageTokens(messages);
  if (totalTokens <= threshold) return messages;

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const entries = baseMessagesToTrajectoryEntries(nonSystem);
  if (entries.length <= 4) return messages;

  const systemTokens = estimateMessageTokens(systemMessages);
  const compressor = createTrajectoryCompressor();
  const result = await compressor.compress(entries, targetBudget - systemTokens);
  if (!result.success) {
    logger.warn("Agent loop context compression failed", { error: result.error.message });
    return messages;
  }
  if (result.data === entries) return messages; // no compression occurred

  const compressedNonSystem = flattenTrajectoryEntries(result.data);
  logger.info("Agent loop context compressed", { originalMessages: messages.length, compressedMessages: systemMessages.length + compressedNonSystem.length });
  return [...systemMessages, ...compressedNonSystem];
}

// =============================================================================
// Agent Loop State Manager
// =============================================================================

export function createAgentLoopState(
  sessionId: string,
  skillPrompts: string[] = [],
  mode: "orchestrator" | "worker" = "worker"
): AgentLoopState {
  const orchestratorPrompt =
    "You are the Orchestrator. You do NOT execute tasks directly. " +
    "Your ONLY job is to:\n" +
    "1) Understand the user's high-level request.\n" +
    "2) Decompose it into concrete subtasks.\n" +
    "3) Delegate EACH subtask to a specialized worker via the `delegate_task` tool.\n" +
    "4) Wait for results, verify completeness, and report a concise summary to the user.\n\n" +
    "CRITICAL RULES:\n" +
    "- You MUST NOT write code, read files, browse the web, or perform any concrete work yourself.\n" +
    "- For EVERY user request, no matter how simple, you MUST call `delegate_task`.\n" +
    "- Never output code, file contents, or search results directly. Only the Worker may do so.\n" +
    "- Your response to the user must be a brief summary of what the worker accomplished.";

  const workerPrompt =
    "You are Ouroboros, a self-modifying agent. " +
    "You may use tools. After complex successes, consider saving knowledge as a skill. " +
    "You may also propose improvements to your own agent loop via self_modify.";

  const systemContent =
    (mode === "orchestrator" ? orchestratorPrompt : workerPrompt) +
    (skillPrompts.length > 0
      ? "\n\nLoaded skills:\n" + skillPrompts.map((s) => `- ${s}`).join("\n")
      : "");
  return {
    sessionId,
    messages: [{ role: "system", content: systemContent }],
    status: "idle",
    activeTaskIds: [],
    loadedSkills: [],
    turnCount: 0,
    maxTurns: 32,
    contextBudget: 8000,
    compressThreshold: 6400,
  };
}

// =============================================================================
// LLM Caller using real router
// =============================================================================

export interface LLMCaller {
  call(messages: BaseMessage[], tools: Tool<unknown, unknown, unknown>[]): Promise<AssistantMessage>;
}

export function createRealLLMCaller(cfg: LLMConfig): LLMCaller {
  return {
    async call(messages, tools) {
      const result = await callLLMWithResilience(cfg, messages, tools);
      if (!result.success) {
        throw new Error(`LLM error: ${result.error.message}`);
      }
      return result.data;
    },
  };
}

export function createMockLLMCaller(): LLMCaller {
  return {
    async call(messages, tools) {
      const lastUser = messages.findLast((m) => m.role === "user");
      const text = (lastUser?.content as string) || "";

      // Detect if we already successfully wrote a skill in the previous turn
      const lastAssistant = messages.findLast((m) => m.role === "assistant");
      const lastToolResult = messages.findLast((m) => m.role === "tool_result");
      let alreadyWroteSkill = false;
      if (lastAssistant && Array.isArray(lastAssistant.content)) {
        const hadWriteSkill = lastAssistant.content.some(
          (b: unknown) =>
            typeof b === "object" &&
            b !== null &&
            (b as { type?: string; name?: string }).type === "tool_use" &&
            (b as { type?: string; name?: string }).name === "write_skill"
        );
        const hadSuccessResult =
          lastToolResult &&
          typeof lastToolResult.content === "string" &&
          lastToolResult.content.includes('"success": true');
        alreadyWroteSkill = hadWriteSkill && !!hadSuccessResult;
      }

      if (alreadyWroteSkill) {
        return {
          role: "assistant",
          content: "Skill saved successfully. The system has learned this pattern.",
        };
      }

      if (text.includes("learn") && tools.some((t) => t.name === "write_skill")) {
        // Embed the user's directive into the skill body for demo realism
        const directive = text.replace(/learn this:?\s*/i, "").trim();
        const skillBody = directive || "This skill was generated by the Ouroboros learning loop.";
        return {
          role: "assistant",
          content: [
            { type: "text", text: "I will save this pattern as a skill." },
            {
              type: "tool_use",
              id: "tu_1",
              name: "write_skill",
              input: {
                name: "example-pattern",
                markdown:
                  "---\n" +
                  "name: example-pattern\n" +
                  `description: ${skillBody.slice(0, 60)}\n` +
                  "version: 0.1.0\n" +
                  "---\n\n" +
                  skillBody,
              },
            },
          ],
        };
      }

      if (text.includes("hello") || text.includes("你好")) {
        return {
          role: "assistant",
          content: "Hello. I am Ouroboros. How may I assist your evolution today?",
        };
      }

      // Simulate skill-aware behavior for demo purposes
      const systemMsg = messages.find((m) => m.role === "system")?.content as string;
      if (text.includes("nihao") && systemMsg?.includes("Chinese")) {
        return {
          role: "assistant",
          content: "你好！我是 Ouroboros。今天想如何进化？",
        };
      }

      return {
        role: "assistant",
        content: `I received: "${text}". Available tools: ${tools.map((t) => t.name).join(", ")}`,
      };
    },
  };
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return String(Math.abs(hash));
}

function adaptiveMemoryBudget(contextBudget: number): { topK: number; maxTokens: number } {
  if (contextBudget < 4000) return { topK: 1, maxTokens: 256 };
  if (contextBudget < 8000) return { topK: 3, maxTokens: 512 };
  return { topK: 5, maxTokens: 1024 };
}

function estimateInjectionTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const otherChars = text.length - chineseChars - englishWords;
  return Math.ceil(chineseChars / 2) + Math.ceil(englishWords / 4) + Math.ceil(otherChars / 8);
}

// =============================================================================
// Agent Loop Runner
// =============================================================================

export interface AgentLoopRunner {
  run(userInput: string | ContentBlock[]): AsyncGenerator<BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent, void, unknown>;
  getState(): AgentLoopState;
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
  enableActiveMemory?: boolean;
  activeMemoryTopK?: number;
  activeMemoryMinScore?: number;
  knowledgeBase?: KnowledgeBase;
  mode?: "orchestrator" | "worker";
}): AgentLoopRunner {
  const state = createAgentLoopState(opts.sessionId, opts.skillPrompts, opts.mode);
  const toolPool = createToolPool();
  for (const t of opts.tools) toolPool.register(t);
  const llmCaller = opts.llmCaller || (opts.llm ? createRealLLMCaller(opts.llm) : createMockLLMCaller());
  const llmCfg: LLMConfig = opts.llm || { provider: "local" as const, model: "mock" };
  const selfHealer = opts.selfHealer || createSelfHealer();
  const contextManager = opts.contextManager || createContextManager();
  const permCtx: ToolPermissionContext = opts.permissionCtx || {
    alwaysAllowRules: ["write_skill", "read_skill", "discover_skills", "compress_trajectory", "read_file", "delegate_task"],
    alwaysDenyRules: [],
    alwaysAskRules: ["self_modify", "rule_engine_override", "write_file"],
    mode: "interactive",
    source: "session",
  };

  const abortController = new AbortController();
  let sessionInitialized = false;

  return {
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

        // Adaptive optimizer: suggest config before LLM call
        const adaptiveConfig = opts.adaptiveOptimizer ? opts.adaptiveOptimizer.suggestConfig(opts.sessionId) : null;
        const pruningStrategy = (adaptiveConfig?.pruningStrategy as PruningStrategy | undefined) || "balanced";
        const contextBudget = (adaptiveConfig?.contextBudget as number) || (state.contextBudget ?? 8000);
        if (adaptiveConfig && llmCfg.provider !== "local") {
          llmCfg.temperature = adaptiveConfig.temperature ?? llmCfg.temperature;
          llmCfg.maxTokens = adaptiveConfig.maxTokens ?? llmCfg.maxTokens;
        }

        // Adaptive context compression before pruning
        const compressedMessages = await maybeCompressMessages(state.messages, state.compressThreshold ?? 6400, state.contextBudget ?? 8000);

        // Build active-memory injections for this turn
        let contextResult: Awaited<ReturnType<ContextManager["buildContext"]>>;
        const memoryInjections: InjectionItem[] = [];
        if (opts.enableActiveMemory && (memoryLayerHits.length > 0 || kbHits.length > 0)) {
          const { topK, maxTokens } = adaptiveMemoryBudget(contextBudget);

          if (memoryLayerHits.length > 0) {
            const selected = memoryLayerHits.slice(0, topK);
            const content = "Relevant historical memory:\n" +
              selected.map((r, i) => `${i + 1}. [${r.layer}] ${r.summary || r.content.slice(0, 200)}`).join("\n---\n");
            memoryInjections.push({
              id: `memory-layers-${simpleHash(content)}`,
              content,
              tokenCount: estimateInjectionTokens(content),
              priority: 0.7,
              enabled: true,
              point: "system",
              maxFrequency: 1,
            });
          }

          if (kbHits.length > 0) {
            const selected = kbHits.slice(0, topK);
            const content = "Relevant knowledge base context:\n" +
              selected.map((r, i) => `${i + 1}. ${r.content}`).join("\n---\n");
            memoryInjections.push({
              id: `kb-context-${simpleHash(content)}`,
              content,
              tokenCount: estimateInjectionTokens(content),
              priority: 0.6,
              enabled: true,
              point: "system",
              maxFrequency: 1,
            });
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
            injections: [...memoryInjections, ...(opts.contextInjections || [])],
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
            injections: opts.contextInjections,
            maxInjectionTokens: 512,
          });
        }
        if (contextResult.pruningStats && contextResult.pruningStats.removedCount > 0) {
          logger.info("Agent loop context pruned", { sessionId: opts.sessionId, ...contextResult.pruningStats });
        }

        const assistantMsg = await llmCaller.call(contextResult.messages, toolPool.all());

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
      if (opts.onTurnEnd) {
        await opts.onTurnEnd({ sessionId: opts.sessionId, turnCount: state.turnCount, success: true });
      }
    },
    getState() {
      return structuredClone(state);
    },
  };
}

// =============================================================================
// Agent Loop as a Tool (meta-level: run the loop as a subagent)
// =============================================================================

export const agentLoopTool = buildTool({
  name: "run_agent_loop",
  description:
    "Run a subagent with its own Ouroboros agent loop. " +
    "The subagent has isolated state and restricted tool access.",
  inputSchema: z.object({
    directive: z.string(),
    allowedTools: z.array(z.string()).optional(),
    readOnly: z.boolean().default(true),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ directive, allowedTools, readOnly }, _ctx) {
    return {
      success: true,
      message: `Subagent loop would run with directive: ${directive}`,
      sandboxMode: readOnly ? "read-only" : "full",
      allowedTools: allowedTools || "all safe",
    };
  },
});
