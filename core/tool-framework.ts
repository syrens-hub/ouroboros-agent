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
import { hookRegistry } from "./hook-system.ts";
import { classifyToolError } from "./errors.ts";

// =============================================================================
// Fail-Closed Defaults (Claude Code pattern)
// =============================================================================

export interface ToolBuildOptions<Input, Output, Progress> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;

  /** Defaults to false (fail-closed). */
  isReadOnly?: boolean;

  /** Defaults to false (fail-closed). Can be a static boolean or a function of the parsed input. */
  isConcurrencySafe?: boolean | ((input: Input) => boolean);

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
  const concurrencySafe = opts.isConcurrencySafe ?? false;
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    isReadOnly: opts.isReadOnly ?? false,
    isConcurrencySafe: typeof concurrencySafe === "function"
      ? (concurrencySafe as (input: unknown) => boolean)
      : () => concurrencySafe,
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

const MAX_TOOL_CONCURRENCY = 10;

type TrackedTool = {
  id: string;
  tool: Tool<unknown, unknown, unknown>;
  input: unknown;
  status: "queued" | "executing" | "completed" | "yielded";
  result?: Result<unknown>;
  error?: Error;
  errorClass?: string;
  parsedInput?: unknown;
};

type Batch = {
  isConcurrencySafe: boolean;
  tools: TrackedTool[];
};

export interface StreamingToolExecutorOptions {
  onToolError?: (tracked: TrackedTool, error: Error) => Promise<{ retry: boolean } | void>;
  sessionId?: string;
  turn?: number;
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

    // Parse inputs and partition into batches
    const batches = this.partitionBatches();

    for (const batch of batches) {
      await hookRegistry.emit("tool:batchStart", {
        sessionId: this.opts.sessionId,
        turn: this.opts.turn,
        toolNames: batch.tools.map((t) => t.tool.name),
        isConcurrencySafe: batch.isConcurrencySafe,
      });

      if (batch.isConcurrencySafe) {
        await this.runBatchConcurrently(batch.tools);
      } else {
        await this.runBatchSerially(batch.tools);
      }

      await hookRegistry.emit("tool:batchEnd", {
        sessionId: this.opts.sessionId,
        turn: this.opts.turn,
        toolNames: batch.tools.map((t) => t.tool.name),
        isConcurrencySafe: batch.isConcurrencySafe,
      });
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

  private partitionBatches(): Batch[] {
    return this.queue.reduce<Batch[]>((acc, tracked) => {
      const parsed = tracked.tool.inputSchema.safeParse(tracked.input);
      tracked.parsedInput = parsed.success ? parsed.data : undefined;

      const isSafe = parsed.success
        ? (() => {
            try {
              return typeof tracked.tool.isConcurrencySafe === "function"
              ? Boolean(tracked.tool.isConcurrencySafe(parsed.data))
              : Boolean(tracked.tool.isConcurrencySafe);
            } catch {
              return false;
            }
          })()
        : false;

      if (isSafe && acc.length > 0 && acc[acc.length - 1]!.isConcurrencySafe) {
        acc[acc.length - 1]!.tools.push(tracked);
      } else {
        acc.push({ isConcurrencySafe: isSafe, tools: [tracked] });
      }
      return acc;
    }, []);
  }

  private async runBatchSerially(tools: TrackedTool[]): Promise<void> {
    for (const tracked of tools) {
      if (this.siblingAbortController.signal.aborted) {
        tracked.status = "completed";
        tracked.result = err({
          code: "TOOL_CANCELLED",
          message: "Cancelled due to sibling error",
        });
        continue;
      }
      await this.runTool(tracked);
    }
  }

  private async runBatchConcurrently(tools: TrackedTool[]): Promise<void> {
    const running: Promise<void>[] = [];
    for (const tracked of tools) {
      if (this.siblingAbortController.signal.aborted) {
        tracked.status = "completed";
        tracked.result = err({
          code: "TOOL_CANCELLED",
          message: "Cancelled due to sibling error",
        });
        continue;
      }
      const p = this.runTool(tracked);
      running.push(p);
      if (running.length >= MAX_TOOL_CONCURRENCY) {
        await Promise.race(running);
        // Clean up completed promises to keep memory bounded
        for (let i = running.length - 1; i >= 0; i--) {
          const reflect = await Promise.resolve(running[i]!).then(() => true, () => true);
          if (reflect) running.splice(i, 1);
        }
      }
    }
    await Promise.all(running);
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
        const childController = new AbortController();
        const onAbort = () => childController.abort();
        this.ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
        this.siblingAbortController.signal.addEventListener("abort", onAbort, { once: true });

        const progressCtx: ToolCallContext<unknown> = {
          ...this.ctx,
          abortSignal: childController.signal,
          reportProgress: (p) => {
            void hookRegistry.emit("tool:progress", {
              sessionId: this.opts.sessionId,
              turn: this.opts.turn,
              toolName: tracked.tool.name,
              progress: p,
            });
            this.ctx.reportProgress(p);
          },
        };

        const TOOL_TIMEOUT_MS = 30000;
        const output = await Promise.race([
          tracked.tool.call(tracked.input, progressCtx),
          new Promise<never>((_, reject) => {
            const t = setTimeout(
              () => reject(new Error("TOOL_TIMEOUT: tool execution exceeded 30s")),
              TOOL_TIMEOUT_MS
            );
            childController.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
          }),
        ]);
        tracked.result = ok(output);
        break;
      } catch (e) {
        const error = e as Error;
        tracked.errorClass = classifyToolError(error);
        if (attempts < maxAttempts && this.opts.onToolError) {
          const decision = await this.opts.onToolError(tracked, error);
          if (decision?.retry) {
            continue;
          }
        }
        // Cascade cancellation: write tools or shell/bash tools trigger sibling abort
        const shouldCascade =
          !tracked.tool.isReadOnly ||
          tracked.tool.name.toLowerCase().startsWith("bash") ||
          tracked.tool.name.toLowerCase() === "shell";
        if (shouldCascade) {
          this.siblingAbortController.abort("sibling_error");
        }
        if (this.siblingAbortController.signal.aborted && tracked.tool.isReadOnly) {
          tracked.result = err({
            code: "TOOL_CANCELLED",
            message: "Cancelled due to sibling error",
          });
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


}
