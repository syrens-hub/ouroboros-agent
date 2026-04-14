import { z } from "zod";
import { buildTool, StreamingToolExecutor } from "../core/tool-framework.ts";
import type { Tool, ToolCallContext } from "../types/index.ts";
import type { BenchmarkResult } from "./types.ts";

function createReadOnlyTool(index: number): Tool<{ id: number }, number, unknown> {
  return buildTool({
    name: `read_tool_${index}`,
    description: `Lightweight read-only tool ${index}`,
    inputSchema: z.object({ id: z.number() }),
    isReadOnly: true,
    isConcurrencySafe: true,
    async call(input: { id: number }) {
      // simulate trivial work
      return input.id * 2;
    },
  });
}

async function runBatch(
  tools: Tool<{ id: number }, number, unknown>[],
  concurrency: number,
  totalCalls: number
): Promise<{ concurrency: number; totalMs: number }> {
  const callsPerExecutor = concurrency;
  const numExecutors = Math.ceil(totalCalls / callsPerExecutor);

  const start = performance.now();
  const executorPromises: Promise<void>[] = [];

  for (let e = 0; e < numExecutors; e++) {
    const ctx: ToolCallContext<unknown> = {
      taskId: `bench-task-${e}`,
      abortSignal: new AbortController().signal,
      reportProgress: () => {},
      invokeSubagent: async () => ({} as never),
    };
    const executor = new StreamingToolExecutor(ctx);

    const startIdx = e * callsPerExecutor;
    const endIdx = Math.min(startIdx + callsPerExecutor, totalCalls);
    for (let i = startIdx; i < endIdx; i++) {
      const tool = tools[i % tools.length];
      executor.addTool(`call_${i}`, tool, { id: i });
    }

    executorPromises.push(
      executor.executeAll().then(() => {
        // result consumed
      })
    );
  }

  await Promise.all(executorPromises);
  const totalMs = performance.now() - start;
  return { concurrency, totalMs };
}

export async function runToolThroughputBenchmark(opts?: {
  toolCount?: number;
  totalCalls?: number;
}): Promise<BenchmarkResult> {
  const toolCount = opts?.toolCount ?? 16;
  const totalCalls = opts?.totalCalls ?? 16;
  const tools = Array.from({ length: toolCount }, (_, i) => createReadOnlyTool(i));

  const details: Array<{ concurrency: number; totalMs: number }> = [];

  for (const concurrency of [1, 4, 8]) {
    const result = await runBatch(tools, concurrency, totalCalls);
    details.push(result);
  }

  const metrics: Record<string, number> = {};
  for (const d of details) {
    metrics[`concurrency_${d.concurrency}_total_ms`] = d.totalMs;
    metrics[`concurrency_${d.concurrency}_calls_per_sec`] = totalCalls / (d.totalMs / 1000);
  }

  return {
    name: "tool-throughput",
    metrics,
    details,
    timestamp: Date.now(),
  };
}
