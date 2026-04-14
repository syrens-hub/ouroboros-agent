/**
 * Ouroboros Sandbox
 * =================
 * Subagent context isolation inspired by Claude Code's forkedAgent.ts.
 * Creates a safe execution bubble for child agents.
 */

import { randomBytes } from "crypto";
import type {
  TaskId,
  ToolCallContext,
  AgentLoopState,
  BaseMessage,
} from "../types/index.ts";

export interface SandboxContext {
  readonly taskId: TaskId;
  readonly parentTaskId?: TaskId;
  readonly abortSignal: AbortSignal;
  /** Isolated message history (clone of parent at fork time). */
  readonly messages: BaseMessage[];
  /** Sandboxed loop state (read-only mirrors). */
  readonly loopStateSnapshot: Readonly<AgentLoopState>;
  /** If true, the subagent cannot modify persistent state. */
  readonly readOnly: boolean;
  /** If true, permission prompts are suppressed (used for background agents). */
  readonly quietMode: boolean;
}

export function generateTaskId(): TaskId {
  return randomBytes(6).toString("hex") as TaskId;
}

export function createChildAbortController(
  parent?: AbortController
): AbortController {
  const child = new AbortController();
  if (parent) {
    parent.signal.addEventListener("abort", () => {
      child.abort("parent_aborted");
    });
  }
  return child;
}

export function createSandboxContext(
  parent: {
    loopState: AgentLoopState;
    abortController: AbortController;
  },
  opts: {
    readOnly?: boolean;
    quietMode?: boolean;
  } = {}
): SandboxContext {
  const taskId = generateTaskId();
  const childAbort = createChildAbortController(parent.abortController);

  return {
    taskId,
    abortSignal: childAbort.signal,
    messages: structuredClone(parent.loopState.messages),
    loopStateSnapshot: Object.freeze(structuredClone(parent.loopState)),
    readOnly: opts.readOnly ?? false,
    quietMode: opts.quietMode ?? false,
  };
}

export function createSandboxToolCallContext(
  sandbox: SandboxContext
): ToolCallContext<unknown> {
  return {
    taskId: sandbox.taskId,
    abortSignal: sandbox.abortSignal,
    reportProgress: () => {
      // In sandbox, progress reporting can be wired to a telemetry bus
    },
    invokeSubagent: async () => {
      throw new Error("Nested subagents are not allowed in sandbox mode.");
    },
  };
}
