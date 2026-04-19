import type { TaskId } from "./core.ts";
import type { BaseMessage } from "./messages.ts";
import type { AgentLoopState } from "./agent.ts";

/**
 * SandboxContext
 * ==============
 * Isolated execution context for subagents.
 * Defined in types/ to avoid core -> skills circular dependencies.
 */
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
  /** Filesystem sandbox directory for this subagent. */
  readonly sandboxDir: string;
}
