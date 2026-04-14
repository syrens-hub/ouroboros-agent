import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildTool,
  createToolPool,
  assembleToolPool,
  StreamingToolExecutor,
} from "../../core/tool-framework.ts";
import type { ToolCallContext } from "../../types/index.ts";

describe("Tool Framework", () => {
  it("buildTool uses fail-closed defaults", () => {
    const tool = buildTool({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      call: async (input) => input.value,
    });

    expect(tool.name).toBe("test_tool");
    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.checkPermissions({ value: "x" }, { alwaysAllowRules: [], alwaysDenyRules: [], alwaysAskRules: [], mode: "interactive", source: "cli" })).toEqual({ success: true, data: "allow" });
  });

  it("tool pool supports register, get, all, unregister, reload", () => {
    const pool = createToolPool();
    const tool = buildTool({
      name: "t1",
      description: "d",
      inputSchema: z.object({}),
      call: async () => "ok",
    });

    pool.register(tool);
    expect(pool.get("t1")).toBe(tool);
    expect(pool.all().length).toBe(1);

    pool.unregister("t1");
    expect(pool.get("t1")).toBeUndefined();

    pool.register(tool);
    const tool2 = buildTool({ name: "t1", description: "d2", inputSchema: z.object({}), call: async () => "ok2" });
    expect(pool.reload("t1", tool2)).toBe(true);
    expect(pool.get("t1")?.description).toBe("d2");
    expect(pool.reload("missing", tool2)).toBe(false);
  });

  it("assembleToolPool filters by readOnly, denyList, and allowList", () => {
    const readTool = buildTool({ name: "read", description: "r", inputSchema: z.object({}), isReadOnly: true, call: async () => "r" });
    const writeTool = buildTool({ name: "write", description: "w", inputSchema: z.object({}), isReadOnly: false, call: async () => "w" });
    const pool = createToolPool();
    pool.register(readTool);
    pool.register(writeTool);

    const readOnlyPool = assembleToolPool(pool, { allowReadOnlyOnly: true });
    expect(readOnlyPool.all().map((t) => t.name)).toEqual(["read"]);

    const denyPool = assembleToolPool(pool, { denyList: ["write"] });
    expect(denyPool.all().map((t) => t.name)).toEqual(["read"]);

    const allowPool = assembleToolPool(pool, { allowList: ["write"] });
    expect(allowPool.all().map((t) => t.name)).toEqual(["write"]);
  });

  it("StreamingToolExecutor runs tools concurrently and captures results", async () => {
    const ctx: ToolCallContext<unknown> = {
      taskId: "task1",
      abortSignal: new AbortController().signal,
      reportProgress: () => {},
      invokeSubagent: (async () => ({ success: true })) as unknown as ToolCallContext<unknown>["invokeSubagent"],
    };
    const executor = new StreamingToolExecutor(ctx);

    const t1 = buildTool({ name: "t1", description: "d", inputSchema: z.object({}), isConcurrencySafe: true, isReadOnly: true, call: async () => "r1" });
    const t2 = buildTool({ name: "t2", description: "d", inputSchema: z.object({}), isConcurrencySafe: true, isReadOnly: true, call: async () => "r2" });

    executor.addTool("id1", t1, {});
    executor.addTool("id2", t2, {});

    const results = await executor.executeAll();
    expect(results.get("id1")).toEqual({ success: true, data: "r1" });
    expect(results.get("id2")).toEqual({ success: true, data: "r2" });
  });

  it("StreamingToolExecutor aborts siblings on write tool failure", async () => {
    const ctx: ToolCallContext<unknown> = {
      taskId: "task2",
      abortSignal: new AbortController().signal,
      reportProgress: () => {},
      invokeSubagent: (async () => ({ success: true })) as unknown as ToolCallContext<unknown>["invokeSubagent"],
    };
    const executor = new StreamingToolExecutor(ctx);

    const slowRead = buildTool({
      name: "slowRead",
      description: "d",
      inputSchema: z.object({}),
      isReadOnly: true,
      isConcurrencySafe: true,
      call: async (_input, ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          ctx.abortSignal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return "slow";
      },
    });

    const failingWrite = buildTool({
      name: "failingWrite",
      description: "d",
      inputSchema: z.object({}),
      isReadOnly: false,
      call: async () => {
        throw new Error("write failed");
      },
    });

    executor.addTool("slow", slowRead, {});
    executor.addTool("fail", failingWrite, {});

    const results = await executor.executeAll();
    expect(results.get("fail")).toEqual({
      success: false,
      error: { code: "TOOL_EXECUTION_ERROR", message: "write failed" },
    });

    const slowResult = results.get("slow");
    expect(slowResult).toBeDefined();
    if (!slowResult) throw new Error("expected slowResult");
    expect(slowResult.success).toBe(false);
    if (slowResult.success) throw new Error("expected error");
    expect(slowResult.error.code).toBe("TOOL_CANCELLED");
  });
});
