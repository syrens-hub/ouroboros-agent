/**
 * Ouroboros Sandbox
 * =================
 * Subagent context isolation inspired by Claude Code's forkedAgent.ts.
 * Creates a safe execution bubble for child agents.
 */

import { randomBytes } from "crypto";
import { join, resolve, relative } from "path";
import { mkdirSync, lstatSync, realpathSync } from "fs";
import type {
  TaskId,
  ToolCallContext,
  AgentLoopState,
  BaseMessage,
} from "../../types/index.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

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
  const sandboxDir = join(process.cwd(), ".ouroboros", "sandbox", taskId);
  mkdirSync(sandboxDir, { recursive: true });

  return {
    taskId,
    abortSignal: childAbort.signal,
    messages: structuredClone(parent.loopState.messages),
    loopStateSnapshot: Object.freeze(structuredClone(parent.loopState)),
    readOnly: opts.readOnly ?? false,
    quietMode: opts.quietMode ?? false,
    sandboxDir,
  };
}

/**
 * Resolve a requested path within the sandbox directory.
 * Returns an error if the resolved path escapes the sandbox.
 * SECURITY: 使用 lstatSync 检测 symlink，防止符号链接绕过
 */
export function resolveSandboxPath(sandbox: SandboxContext, requestedPath: string): Result<string> {
  // 检测请求的路径是否是符号链接（攻击者可能通过符号链接逃逸）
  try {
    const lstat = lstatSync(requestedPath);
    if (lstat.isSymbolicLink()) {
      // 如果是符号链接，检查其指向的真实路径是否在沙箱内
      const realPath = realpathSync(requestedPath);
      const realSandboxDir = realpathSync(sandbox.sandboxDir);
      if (!realPath.startsWith(realSandboxDir)) {
        return err({ code: "ESCAPE", message: `Symbolic link '${requestedPath}' points outside the sandbox.` });
      }
      // 符号链接指向沙箱内，使用真实路径
      return ok(realPath);
    }
  } catch (_e) {
    // 文件不存在或有权限问题，继续使用 resolve 处理
  }
  
  const resolved = resolve(sandbox.sandboxDir, requestedPath);
  const rel = relative(sandbox.sandboxDir, resolved);
  if (rel.startsWith("..") || rel === "") {
    return err({ code: "ESCAPE", message: `Path '${requestedPath}' escapes the sandbox directory.` });
  }
  
  // 额外检查：解析真实路径后再次验证
  try {
    const realResolved = realpathSync(resolved);
    const realSandboxDir = realpathSync(sandbox.sandboxDir);
    if (!realResolved.startsWith(realSandboxDir)) {
      return err({ code: "ESCAPE", message: `Path '${requestedPath}' escapes the sandbox via symlink.` });
    }
  } catch (_e) {
    // realpath 失败，忽略（文件可能被删除或有权限问题）
  }
  
  return ok(resolved);
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
