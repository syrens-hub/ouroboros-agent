/**
 * Ouroboros Tool Framework
 * ========================
 * Inspired by Claude Code's Tool.ts + tools.ts.
 * Fail-closed defaults, typed schemas, and streaming execution.
 */

import { z } from "zod";
import type {
  Result,
  Tool,
  ToolPermissionContext,
  ToolCallContext,
  ToolPermissionLevel,
} from "../types/index.ts";

export type { Tool } from "../types/index.ts";
import { ok, err } from "../types/index.ts";

// =============================================================================
// Fail-Closed Defaults (Claude Code pattern)
// =============================================================================

export interface ToolBuildOptions<Input, Output, Progress> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;

  /** Defaults to false (fail-closed). */
  isReadOnly?: boolean;

  /** Defaults to false (fail-closed). */
  isConcurrencySafe?: boolean;

  /** Optional custom permission check. Defaults to allow. */
  checkPermissions?: (
    input: Input,
    ctx: ToolPermissionContext
  ) => Result<ToolPermissionLevel>;

  /** The actual implementation. */
  call: (input: Input, ctx: ToolCallContext<Progress>) => Promise<Output>;
}

export function buildTool<Input, Output = unknown, Progress = unknown>(
  opts: ToolBuildOptions<Input, Output, Progress>
): Tool<Input, Output, Progress> {
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    isReadOnly: opts.isReadOnly ?? false,
    isConcurrencySafe: opts.isConcurrencySafe ?? false,
    checkPermissions: opts.checkPermissions ?? (() => ok("allow")),
    call: opts.call,
  };
}

// =============================================================================
// Tool Registry & Pool Assembly
// =============================================================================

export interface ToolPool {
  get(name: string): Tool<unknown, unknown, unknown> | undefined;
  all(): Tool<unknown, unknown, unknown>[];
  register(tool: Tool<unknown, unknown, unknown>): void;
  unregister(name: string): void;
  reload(name: string, tool: Tool<unknown, unknown, unknown>): boolean;
}

export function createToolPool(): ToolPool {
  const registry = new Map<string, Tool<unknown, unknown, unknown>>();
  return {
    get(name) {
      return registry.get(name);
    },
    all() {
      return Array.from(registry.values());
    },
    register(tool) {
      registry.set(tool.name, tool);
    },
    unregister(name) {
      registry.delete(name);
    },
    reload(name, tool) {
      if (!registry.has(name)) return false;
      registry.set(tool.name, tool);
      return true;
    },
  };
}

/** Assemble a filtered tool pool for a subagent or restricted context. */
export function assembleToolPool(
  basePool: ToolPool,
  opts: {
    allowReadOnlyOnly?: boolean;
    denyList?: string[];
    allowList?: string[];
  }
): ToolPool {
  const filtered = createToolPool();
  for (const tool of basePool.all()) {
    if (opts.allowReadOnlyOnly && !tool.isReadOnly) continue;
    if (opts.denyList?.includes(tool.name)) continue;
    if (opts.allowList && !opts.allowList.includes(tool.name)) continue;
    filtered.register(tool);
  }
  return filtered;
}

// =============================================================================
// Streaming Tool Executor
// =============================================================================

type TrackedTool = {
  id: string;
  tool: Tool<unknown, unknown, unknown>;
  input: unknown;
  status: "queued" | "executing" | "completed" | "yielded";
  result?: Result<unknown>;
  error?: Error;
};

export interface StreamingToolExecutorOptions {
  onToolError?: (tracked: TrackedTool, error: Error) => Promise<{ retry: boolean } | void>;
}

export class StreamingToolExecutor {
  private queue: TrackedTool[] = [];
  private activeCount = 0;
  private siblingAbortController = new AbortController();

  constructor(
    private readonly ctx: ToolCallContext<unknown>,
    private readonly opts: StreamingToolExecutorOptions = {}
  ) {}

  addTool(id: string, tool: Tool<unknown, unknown, unknown>, input: unknown): void {
    this.queue.push({ id, tool, input, status: "queued" });
  }

  async executeAll(): Promise<Map<string, Result<unknown>>> {
    const results = new Map<string, Result<unknown>>();

    while (this.queue.some((t) => t.status !== "yielded")) {
      const next = this.findNextExecutable();
      if (!next) {
        // Wait for at least one active task to complete
        await this.waitForActiveCompletion();
        continue;
      }

      this.runTool(next);
    }

    for (const t of this.queue) {
      if (t.result) results.set(t.id, t.result);
      else if (t.error) {
        results.set(
          t.id,
          err({
            code: "TOOL_EXECUTION_ERROR",
            message: t.error.message,
          })
        );
      }
    }

    return results;
  }

  private findNextExecutable(): TrackedTool | undefined {
    const hasExecutingWrite = this.queue.some(
      (t) => t.status === "executing" && !t.tool.isConcurrencySafe
    );
    if (hasExecutingWrite) return undefined;

    return this.queue.find((t) => t.status === "queued");
  }

  private async runTool(tracked: TrackedTool): Promise<void> {
    if (this.siblingAbortController.signal.aborted) {
      tracked.status = "completed";
      tracked.result = err({
        code: "TOOL_CANCELLED",
        message: "Cancelled due to sibling error",
      });
      return;
    }

    tracked.status = "executing";
    this.activeCount++;

    let attempts = 0;
    const maxAttempts = this.opts.onToolError ? 2 : 1;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Create a child abort signal bound to both parent and sibling controllers
        const childController = new AbortController();
        const onAbort = () => childController.abort();
        this.ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
        this.siblingAbortController.signal.addEventListener("abort", onAbort, { once: true });

        const childCtx: ToolCallContext<unknown> = {
          ...this.ctx,
          abortSignal: childController.signal,
        };

        const TOOL_TIMEOUT_MS = 30000;
        const output = await Promise.race([
          tracked.tool.call(tracked.input, childCtx),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error("TOOL_TIMEOUT: tool execution exceeded 30s")), TOOL_TIMEOUT_MS);
            childController.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
          }),
        ]);
        tracked.result = ok(output);
        break;
      } catch (e) {
        const error = e as Error;
        if (attempts < maxAttempts && this.opts.onToolError) {
          const decision = await this.opts.onToolError(tracked, error);
          if (decision?.retry) {
            continue;
          }
        }
        // Bash-like cascade cancellation: if a write tool fails, abort siblings
        if (!tracked.tool.isReadOnly) {
          this.siblingAbortController.abort("sibling_error");
        }
        if (this.siblingAbortController.signal.aborted && tracked.tool.isReadOnly) {
          tracked.result = err({ code: "TOOL_CANCELLED", message: "Cancelled due to sibling error" });
        } else {
          tracked.error = error;
        }
        break;
      } finally {
        if (attempts >= maxAttempts || tracked.result !== undefined || tracked.error !== undefined) {
          this.activeCount--;
          tracked.status = "yielded";
        }
      }
    }
  }

  private async waitForActiveCompletion(): Promise<void> {
    const initialActive = this.activeCount;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.activeCount < initialActive || this.activeCount === 0) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }
}
