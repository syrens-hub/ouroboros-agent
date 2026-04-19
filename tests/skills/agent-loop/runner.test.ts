import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { BaseMessage, Tool, ToolProgressEvent, ContentBlock } from "../../../types/index.ts";

// ============================================================
// Mock variables
// ============================================================

const mockToolPoolRegister = vi.fn();
const mockToolPoolGet = vi.fn();
const mockToolPoolAll = vi.fn(() => [] as Tool<unknown, unknown, unknown>[]);
const mockExecutorAddTool = vi.fn();
const mockExecutorExecuteAll = vi.fn().mockResolvedValue(new Map());
const mockRunPermissionPipeline = vi.fn().mockReturnValue({ success: true, data: "allow" });
const mockCreateSession = vi.fn().mockResolvedValue(undefined);
const mockAppendMessage = vi.fn().mockResolvedValue(undefined);
const mockUpdateSession = vi.fn().mockResolvedValue(undefined);
const mockSanitizeUserInput = vi.fn((input: string) => input);
const mockMaybeCompressMessages = vi.fn((msgs: BaseMessage[]) => msgs);
const mockBuildContext = vi.fn().mockImplementation(({ messages }: { messages: BaseMessage[] }) => ({
  messages,
  pruningStats: { removedCount: 0 },
}));
const mockContextCompressorCompress = vi.fn().mockResolvedValue({ success: false });
const mockSaveTraceEvent = vi.fn().mockResolvedValue(undefined);
const mockHookRegistryEmit = vi.fn().mockResolvedValue(undefined);
const mockLoggerInfo = vi.fn();
const mockGetCachedProjectMemory = vi.fn().mockReturnValue(null);
const mockGetSessionState = vi.fn().mockReturnValue({ tokenCounters: { totalInput: 0, totalOutput: 0 } });
const mockInsertTokenUsage = vi.fn().mockResolvedValue(undefined);
const mockGetSessionTokenUsage = vi.fn().mockReturnValue(0);
const mockSpawnBackgroundReview = vi.fn();
const mockNotificationBusEmitEvent = vi.fn();
const mockStartTurnSpan = vi.fn();
const mockEndTurnSpan = vi.fn();
const mockStartToolSpan = vi.fn();
const mockEndToolSpan = vi.fn();
const mockCreateSelfHealer = vi.fn().mockReturnValue({
  createSnapshot: vi.fn().mockReturnValue({ id: "snap-1", metadata: {} }),
  attemptRepair: vi.fn().mockResolvedValue({ success: false, rollbackPerformed: false }),
  getSnapshots: vi.fn().mockReturnValue([]),
});
const mockSearchMemoryLayers = vi.fn().mockReturnValue({ success: true, data: [] });
const mockCreatePersonalityEvolution = vi.fn().mockReturnValue({
  getState: vi.fn().mockReturnValue({}),
  getAnchorMemories: vi.fn().mockReturnValue([]),
});
const mockBuildPersonalityPrompt = vi.fn().mockReturnValue(null);
const mockAdaptiveMemoryBudget = vi.fn().mockReturnValue({ topK: 2, maxTokens: 512 });
const mockEstimateInjectionTokens = vi.fn().mockReturnValue(10);
const mockBuildMemoryLayerInjection = vi.fn();
const mockBuildKbInjection = vi.fn();
const mockRecordDenial = vi.fn();
const mockRecordSuccess = vi.fn();
const mockShouldFallbackToPrompting = vi.fn().mockReturnValue(false);
const mockBuildDenialHint = vi.fn().mockReturnValue("denial hint");

// ============================================================
// vi.mock declarations
// ============================================================

vi.mock("../../../core/tool-framework.ts", () => ({
  createToolPool: vi.fn(() => ({
    register: mockToolPoolRegister,
    get: mockToolPoolGet,
    all: mockToolPoolAll,
  })),
  StreamingToolExecutor: vi.fn().mockImplementation(() => ({
    addTool: mockExecutorAddTool,
    executeAll: mockExecutorExecuteAll,
  })),
  buildTool: vi.fn((opts) => ({
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    isReadOnly: opts.isReadOnly ?? false,
    isConcurrencySafe: opts.isConcurrencySafe ?? false,
    checkPermissions: opts.checkPermissions ?? (() => ({ success: true, data: "allow" })),
    call: opts.call,
  })),
}));

vi.mock("../../../core/permission-gate.ts", () => ({
  runPermissionPipeline: (...args: unknown[]) => mockRunPermissionPipeline(...args),
}));

vi.mock("../../../core/session-db.ts", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  appendMessage: (...args: unknown[]) => mockAppendMessage(...args),
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
  resetDbSingleton: vi.fn(),
}));

vi.mock("../../../core/prompt-defense.ts", () => ({
  sanitizeUserInput: (input: string) => mockSanitizeUserInput(input),
}));

vi.mock("../../../skills/agent-loop/trajectory-utils.ts", () => ({
  maybeCompressMessages: (msgs: BaseMessage[], ..._rest: unknown[]) => mockMaybeCompressMessages(msgs),
}));

vi.mock("../../../skills/agent-loop/context-utils.ts", () => ({
  adaptiveMemoryBudget: (...args: unknown[]) => mockAdaptiveMemoryBudget(...args),
  estimateInjectionTokens: (...args: unknown[]) => mockEstimateInjectionTokens(...args),
  buildMemoryLayerInjection: (...args: unknown[]) => mockBuildMemoryLayerInjection(...args),
  buildKbInjection: (...args: unknown[]) => mockBuildKbInjection(...args),
}));

vi.mock("../../../skills/context-management/index.ts", () => ({
  createContextManager: vi.fn(() => ({
    buildContext: (...args: unknown[]) => mockBuildContext(...args),
  })),
}));

vi.mock("../../../skills/context-management/compressor.ts", () => ({
  ContextCompressor: class MockContextCompressor {
    async compress(...args: unknown[]) {
      return mockContextCompressorCompress(...args);
    }
  },
}));

vi.mock("../../../skills/self-healing/index.ts", () => ({
  createSelfHealer: vi.fn(() => mockCreateSelfHealer()),
}));

vi.mock("../../../skills/sandbox/index.ts", () => ({
  createSandboxContext: vi.fn(() => ({})),
  createSandboxToolCallContext: vi.fn(() => ({})),
}));

vi.mock("../../../skills/learning/review-agent.ts", () => ({
  spawnBackgroundReview: vi.fn((...args: unknown[]) => mockSpawnBackgroundReview(...args)),
}));

vi.mock("../../../skills/notification/index.ts", () => ({
  notificationBus: {
    emitEvent: (...args: unknown[]) => mockNotificationBusEmitEvent(...args),
  },
}));

vi.mock("../../../core/logger.ts", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../core/repositories/trajectory.ts", () => ({
  saveTraceEvent: (...args: unknown[]) => mockSaveTraceEvent(...args),
}));

vi.mock("../../../core/repositories/token-usage.ts", () => ({
  insertTokenUsage: (...args: unknown[]) => mockInsertTokenUsage(...args),
  getSessionTokenUsage: (...args: unknown[]) => mockGetSessionTokenUsage(...args),
}));

vi.mock("../../../core/repositories/memory-layers.ts", () => ({
  searchMemoryLayers: (...args: unknown[]) => mockSearchMemoryLayers(...args),
}));

vi.mock("../../../core/hook-system.ts", () => ({
  hookRegistry: {
    emit: (...args: unknown[]) => mockHookRegistryEmit(...args),
  },
}));

vi.mock("../../../core/session-state.ts", () => ({
  getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
}));

vi.mock("../../../core/project-memory.ts", () => ({
  getCachedProjectMemory: (...args: unknown[]) => mockGetCachedProjectMemory(...args),
}));

vi.mock("../../../core/denial-tracker.ts", () => ({
  recordDenial: (...args: unknown[]) => mockRecordDenial(...args),
  recordSuccess: (...args: unknown[]) => mockRecordSuccess(...args),
  shouldFallbackToPrompting: (...args: unknown[]) => mockShouldFallbackToPrompting(...args),
  buildDenialHint: (...args: unknown[]) => mockBuildDenialHint(...args),
}));

vi.mock("../../../skills/telemetry/telemetry-spans.ts", () => ({
  startTurnSpan: (...args: unknown[]) => mockStartTurnSpan(...args),
  endTurnSpan: (...args: unknown[]) => mockEndTurnSpan(...args),
  startToolSpan: (...args: unknown[]) => mockStartToolSpan(...args),
  endToolSpan: (...args: unknown[]) => mockEndToolSpan(...args),
}));

vi.mock("../../../skills/personality/index.ts", () => ({
  createPersonalityEvolution: (...args: unknown[]) => mockCreatePersonalityEvolution(...args),
  buildPersonalityPrompt: (...args: unknown[]) => mockBuildPersonalityPrompt(...args),
}));

// ============================================================
// Import SUT
// ============================================================

import { createAgentLoopRunner, type AgentLoopRunner, type LoopStateSnapshot } from "../../../skills/agent-loop/runner.ts";

describe("createAgentLoopRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunPermissionPipeline.mockReturnValue({ success: true, data: "allow" });
    mockExecutorExecuteAll.mockResolvedValue(new Map());
    mockBuildContext.mockImplementation(({ messages }: { messages: BaseMessage[] }) => ({
      messages,
      pruningStats: { removedCount: 0 },
    }));
  });

  function createMockTool(name: string, schema = z.object({})): Tool<unknown, unknown, unknown> {
    return {
      name,
      description: `mock ${name}`,
      inputSchema: schema,
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ({ success: true, data: "allow" } as const),
      call: vi.fn().mockResolvedValue(`result from ${name}`),
    } as unknown as Tool<unknown, unknown, unknown>;
  }

  function collectEvents(runner: AgentLoopRunner, input: string | ContentBlock[]) {
    return async () => {
      const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
      for await (const ev of runner.run(input)) events.push(ev);
      return events;
    };
  }

  describe("creation and basic interface", () => {
    it("returns an object with all required methods", () => {
      const runner = createAgentLoopRunner({
        sessionId: "sess_1",
        tools: [],
      });

      expect(runner).toHaveProperty("run");
      expect(runner).toHaveProperty("getState");
      expect(runner).toHaveProperty("pause");
      expect(runner).toHaveProperty("resume");
      expect(runner).toHaveProperty("exportState");
      expect(runner).toHaveProperty("importState");

      expect(typeof runner.run).toBe("function");
      expect(typeof runner.getState).toBe("function");
      expect(typeof runner.pause).toBe("function");
      expect(typeof runner.resume).toBe("function");
      expect(typeof runner.exportState).toBe("function");
      expect(typeof runner.importState).toBe("function");
    });

    it("getState() returns initial state with correct sessionId and idle status", () => {
      const runner = createAgentLoopRunner({
        sessionId: "sess_init",
        tools: [],
        skillPrompts: ["test-skill"],
      });

      const state = runner.getState();
      expect(state.sessionId).toBe("sess_init");
      expect(state.status).toBe("idle");
      expect(state.turnCount).toBe(0);
      expect(state.loadedSkills).toEqual([]);
      expect(state.messages[0]!.role).toBe("system");
    });
  });

  describe("pause and resume", () => {
    it("pause() and resume() toggle the running state when enabled", () => {
      const progressCalls: Array<{ status: string }> = [];
      const runner = createAgentLoopRunner({
        sessionId: "sess_pause",
        tools: [],
        loopConfig: {
          enable_pause: true,
          enable_resume: true,
          progress_callback: (p) => progressCalls.push({ status: p.status }),
        },
      });

      runner.pause();
      expect(progressCalls.some((c) => c.status === "paused")).toBe(true);

      runner.resume();
      expect(progressCalls.some((c) => c.status === "running")).toBe(true);
    });

    it("pause() does nothing when enable_pause is false", () => {
      const progressCalls: Array<{ status: string }> = [];
      const runner = createAgentLoopRunner({
        sessionId: "sess_nopause",
        tools: [],
        loopConfig: {
          enable_pause: false,
          progress_callback: (p) => progressCalls.push({ status: p.status }),
        },
      });

      runner.pause();
      expect(progressCalls).toHaveLength(0);
    });

    it("resume() does nothing when enable_resume is false", () => {
      const runner = createAgentLoopRunner({
        sessionId: "sess_noresume",
        tools: [],
        loopConfig: {
          enable_resume: false,
        },
      });

      // Should not throw
      runner.pause();
      runner.resume();
    });
  });

  describe("exportState and importState", () => {
    it("exportState() and importState() are symmetric", () => {
      const runner1 = createAgentLoopRunner({
        sessionId: "sess_export",
        tools: [],
        skillPrompts: ["skill-a"],
      });

      const snapshot1 = runner1.exportState();
      expect(snapshot1.sessionId).toBe("sess_export");
      expect(snapshot1.turnCount).toBe(0);
      expect(snapshot1.status).toBe("idle");
      expect(snapshot1.loadedSkills).toEqual([]);
      expect(snapshot1.exportedAt).toEqual(expect.any(Number));

      const runner2 = createAgentLoopRunner({
        sessionId: "sess_import",
        tools: [],
      });

      runner2.importState(snapshot1);
      const state2 = runner2.getState();

      expect(state2.turnCount).toBe(snapshot1.turnCount);
      expect(state2.status).toBe(snapshot1.status);
      expect(state2.loadedSkills).toEqual(snapshot1.loadedSkills);
      expect(state2.messages).toEqual(snapshot1.messages);
    });

    it("importState restores checkpointId", () => {
      const runner1 = createAgentLoopRunner({
        sessionId: "sess_cp",
        tools: [],
      });

      const snapshot: LoopStateSnapshot = {
        sessionId: "sess_cp",
        turnCount: 5,
        messages: [{ role: "user", content: "hi" }],
        status: "running",
        loadedSkills: ["s1"],
        checkpointId: "cp-123",
        exportedAt: Date.now(),
      };

      runner1.importState(snapshot);
      const exported = runner1.exportState();
      expect(exported.checkpointId).toBe("cp-123");
    });
  });

  describe("run() behavior", () => {
    it("yields expected assistant message from mock LLM caller", async () => {
      const llmCaller = {
        call: vi.fn().mockResolvedValue({
          role: "assistant" as const,
          content: "Hello from mock.",
        }),
      };

      const runner = createAgentLoopRunner({
        sessionId: "sess_run",
        tools: [],
        llmCaller,
      });

      const events = await collectEvents(runner, "hello")();

      expect(events.length).toBe(1);
      expect("role" in events[0] ? events[0].role : undefined).toBe("assistant");
      expect("role" in events[0] ? (events[0] as BaseMessage).content : undefined).toBe("Hello from mock.");
      expect(runner.getState().status).toBe("idle");
      expect(runner.getState().turnCount).toBe(1);
      expect(llmCaller.call).toHaveBeenCalledTimes(1);
    });

    it("invokes progress callback with correct iteration count", async () => {
      const progressCalls: Array<{ currentIteration: number; status: string }> = [];
      const llmCaller = {
        call: vi.fn().mockResolvedValue({
          role: "assistant" as const,
          content: "Done.",
        }),
      };

      const runner = createAgentLoopRunner({
        sessionId: "sess_progress",
        tools: [],
        llmCaller,
        loopConfig: {
          max_iterations: 10,
          progress_callback: (p) => progressCalls.push({ currentIteration: p.currentIteration, status: p.status }),
        },
      });

      await collectEvents(runner, "go")();

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      const runningCall = progressCalls.find((c) => c.status === "running");
      expect(runningCall?.currentIteration).toBe(1);
    });

    it("stops after max_iterations", async () => {
      const llmCaller = {
        call: vi.fn().mockResolvedValue({
          role: "assistant" as const,
          content: [
            { type: "tool_use" as const, id: "tu_1", name: "loop_tool", input: {} },
          ],
        }),
      };

      const loopTool = createMockTool("loop_tool");
      mockToolPoolGet.mockImplementation((name: string) => (name === "loop_tool" ? loopTool : undefined));
      mockToolPoolAll.mockReturnValue([loopTool]);
      mockExecutorExecuteAll.mockResolvedValue(
        new Map([["tu_1", { success: true, data: "ok" }]])
      );

      const runner = createAgentLoopRunner({
        sessionId: "sess_max_iter",
        tools: [loopTool],
        llmCaller,
        loopConfig: {
          max_iterations: 3,
        },
      });

      const events = await collectEvents(runner, "loop")();

      // Turn 1: assistant + tool_result, Turn 2: assistant + tool_result, Turn 3: break before LLM
      expect(events.length).toBe(4);
      expect(runner.getState().turnCount).toBe(3);
      expect(runner.getState().status).toBe("idle");
      expect(llmCaller.call).toHaveBeenCalledTimes(2);
    });

    it("triggers on_loop_end with final progress when max_iterations is reached", async () => {
      const onLoopEnd = vi.fn();
      const llmCaller = {
        call: vi.fn().mockResolvedValue({
          role: "assistant" as const,
          content: [{ type: "tool_use" as const, id: "tu_1", name: "t1", input: {} }],
        }),
      };

      const tool = createMockTool("t1");
      mockToolPoolGet.mockImplementation((name: string) => (name === "t1" ? tool : undefined));
      mockToolPoolAll.mockReturnValue([tool]);
      mockExecutorExecuteAll.mockResolvedValue(
        new Map([["tu_1", { success: true, data: "ok" }]])
      );

      const runner = createAgentLoopRunner({
        sessionId: "sess_loop_end",
        tools: [tool],
        llmCaller,
        loopConfig: {
          max_iterations: 2,
          on_loop_end: onLoopEnd,
        },
      });

      await collectEvents(runner, "go")();

      // on_loop_end is invoked both at the max_iterations break point and at the end of run()
      expect(onLoopEnd).toHaveBeenCalledTimes(2);
      const finalProgress = onLoopEnd.mock.calls[1]![0];
      expect(finalProgress.status).toBe("idle");
      expect(finalProgress.currentIteration).toBe(2);
      expect(finalProgress.maxIterations).toBe(2);
    });

    it("executes tool calls and yields tool results", async () => {
      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: "Calling tool." },
              { type: "tool_use" as const, id: "tu_echo", name: "echo", input: { text: "hi" } },
            ],
          };
        }),
      };

      const echoTool = createMockTool("echo", z.object({ text: z.string() }));
      mockToolPoolGet.mockImplementation((name: string) => (name === "echo" ? echoTool : undefined));
      mockToolPoolAll.mockReturnValue([echoTool]);

      mockExecutorExecuteAll.mockResolvedValue(
        new Map([["tu_echo", { success: true, data: { echoed: "hi" } }]])
      );

      const runner = createAgentLoopRunner({
        sessionId: "sess_tool",
        tools: [echoTool],
        llmCaller,
      });

      const events = await collectEvents(runner, "use echo")();

      // assistant + tool_result + final assistant
      expect(events.length).toBe(3);

      expect("role" in events[0] ? events[0].role : undefined).toBe("assistant");
      expect(isToolResult(events[1])).toBe(true);
      expect(events[1]).toMatchObject({
        type: "tool_result",
        toolUseId: "tu_echo",
        isError: false,
      });
      expect(JSON.parse((events[1] as { content: string }).content)).toEqual({ echoed: "hi" });

      expect("role" in events[2] ? events[2].role : undefined).toBe("assistant");
      expect("role" in events[2] ? (events[2] as BaseMessage).content : undefined).toBe("Done.");

      expect(mockExecutorAddTool).toHaveBeenCalledWith("tu_echo", echoTool, { text: "hi" });
      expect(mockRunPermissionPipeline).toHaveBeenCalled();
    });

    it("blocks tool calls when permission gate denies", async () => {
      mockRunPermissionPipeline.mockReturnValue({ success: true, data: "deny" });

      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: "tu_danger", name: "danger_tool", input: {} }],
          };
        }),
      };

      const dangerTool = createMockTool("danger_tool", z.object({}));
      mockToolPoolGet.mockImplementation((name: string) => (name === "danger_tool" ? dangerTool : undefined));
      mockToolPoolAll.mockReturnValue([dangerTool]);

      const runner = createAgentLoopRunner({
        sessionId: "sess_deny",
        tools: [dangerTool],
        llmCaller,
      });

      const events = await collectEvents(runner, "run danger")();

      // assistant + denied tool_result + final assistant
      expect(events.length).toBe(3);
      expect(isToolResult(events[1])).toBe(true);
      expect((events[1] as { isError?: boolean }).isError).toBe(true);
      expect((events[1] as { content: string }).content).toContain("deny");

      expect(mockExecutorAddTool).not.toHaveBeenCalled();
    });

    it("asks for confirmation when permission level is 'ask' and user denies", async () => {
      mockRunPermissionPipeline.mockReturnValue({ success: true, data: "ask" });
      const askConfirmCallback = vi.fn().mockResolvedValue(false);

      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: "tu_ask", name: "ask_tool", input: {} }],
          };
        }),
      };

      const askTool = createMockTool("ask_tool", z.object({}));
      mockToolPoolGet.mockImplementation((name: string) => (name === "ask_tool" ? askTool : undefined));
      mockToolPoolAll.mockReturnValue([askTool]);

      const runner = createAgentLoopRunner({
        sessionId: "sess_ask",
        tools: [askTool],
        llmCaller,
        askConfirmCallback,
      });

      const events = await collectEvents(runner, "run ask")();

      expect(askConfirmCallback).toHaveBeenCalledWith("ask_tool", {});
      expect(isToolResult(events[1])).toBe(true);
      expect((events[1] as { isError?: boolean }).isError).toBe(true);
      expect((events[1] as { content: string }).content).toContain("denied");
    });

    it("allows tool execution when permission level is 'ask' and user confirms", async () => {
      mockRunPermissionPipeline.mockReturnValue({ success: true, data: "ask" });
      const askConfirmCallback = vi.fn().mockResolvedValue(true);

      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: "tu_ask", name: "ask_tool", input: {} }],
          };
        }),
      };

      const askTool = createMockTool("ask_tool", z.object({}));
      mockToolPoolGet.mockImplementation((name: string) => (name === "ask_tool" ? askTool : undefined));
      mockToolPoolAll.mockReturnValue([askTool]);

      mockExecutorExecuteAll.mockResolvedValue(
        new Map([["tu_ask", { success: true, data: "ok" }]])
      );

      const runner = createAgentLoopRunner({
        sessionId: "sess_ask_allow",
        tools: [askTool],
        llmCaller,
        askConfirmCallback,
      });

      const events = await collectEvents(runner, "run ask")();

      expect(askConfirmCallback).toHaveBeenCalledWith("ask_tool", {});
      expect(mockExecutorAddTool).toHaveBeenCalledWith("tu_ask", askTool, {});
      expect(isToolResult(events[1])).toBe(true);
      expect((events[1] as { isError?: boolean }).isError).toBe(false);
    });

    it("yields error tool_result when tool is not found in pool", async () => {
      mockToolPoolGet.mockReturnValue(undefined);

      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: "tu_missing", name: "missing_tool", input: {} }],
          };
        }),
      };

      const runner = createAgentLoopRunner({
        sessionId: "sess_missing",
        tools: [],
        llmCaller,
      });

      const events = await collectEvents(runner, "run missing")();

      expect(events.length).toBe(3);
      expect(isToolResult(events[1])).toBe(true);
      expect((events[1] as { isError?: boolean }).isError).toBe(true);
      expect((events[1] as { content: string }).content).toContain("not found");
    });

    it("yields error tool_result when input validation fails", async () => {
      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const hadToolResult = messages.some((m) => m.role === "tool_result");
          if (hadToolResult) {
            return { role: "assistant" as const, content: "Done." };
          }
          return {
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: "tu_bad", name: "bad_tool", input: { missing: true } }],
          };
        }),
      };

      const badTool = createMockTool("bad_tool", z.object({ required: z.string() }));
      mockToolPoolGet.mockImplementation((name: string) => (name === "bad_tool" ? badTool : undefined));
      mockToolPoolAll.mockReturnValue([badTool]);

      const runner = createAgentLoopRunner({
        sessionId: "sess_bad_input",
        tools: [badTool],
        llmCaller,
      });

      const events = await collectEvents(runner, "run bad")();

      expect(events.length).toBe(3);
      expect(isToolResult(events[1])).toBe(true);
      expect((events[1] as { isError?: boolean }).isError).toBe(true);
      expect((events[1] as { content: string }).content).toContain("Invalid input");
    });

    it("accepts ContentBlock[] as user input", async () => {
      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "/api/uploads/test.png" } },
      ];

      const llmCaller = {
        call: vi.fn().mockImplementation(async (messages: BaseMessage[]) => {
          const last = messages.findLast((m) => m.role === "user")?.content;
          expect(Array.isArray(last)).toBe(true);
          expect(last).toEqual(contentBlocks);
          return { role: "assistant" as const, content: "It is a test image." };
        }),
      };

      const runner = createAgentLoopRunner({
        sessionId: "sess_multimodal",
        tools: [],
        llmCaller,
      });

      const events = await collectEvents(runner, contentBlocks)();

      expect(events.length).toBe(1);
      expect("role" in events[0] ? (events[0] as BaseMessage).content : undefined).toBe("It is a test image.");
    });

    it("calls onTurnEnd when the loop completes successfully", async () => {
      const onTurnEnd = vi.fn().mockResolvedValue(undefined);
      const llmCaller = {
        call: vi.fn().mockResolvedValue({ role: "assistant" as const, content: "Done." }),
      };

      const runner = createAgentLoopRunner({
        sessionId: "sess_turn_end",
        tools: [],
        llmCaller,
        onTurnEnd,
      });

      await collectEvents(runner, "go")();

      // onTurnEnd is invoked both when the conversation naturally ends and at the end of run()
      expect(onTurnEnd).toHaveBeenCalledTimes(2);
      expect(onTurnEnd).toHaveBeenLastCalledWith({
        sessionId: "sess_turn_end",
        turnCount: 1,
        success: true,
      });
    });
  });
});

function isToolResult(
  ev: BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent
): ev is { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } {
  return !("role" in ev) && ev.type === "tool_result";
}
