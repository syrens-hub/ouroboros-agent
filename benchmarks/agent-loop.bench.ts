import { appConfig } from "../core/config.ts";
import { resetDbSingleton } from "../core/db-manager.ts";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import type { BenchmarkResult } from "./types.ts";
import type { BaseMessage, AssistantMessage, Tool } from "../types/index.ts";

const TEST_DB_DIR = join(process.cwd(), ".ouroboros", "benchmark-agent-loop-db");

export async function runAgentLoopBenchmark(): Promise<BenchmarkResult> {
  appConfig.db.dir = TEST_DB_DIR;
  resetDbSingleton();

  const [{ createAgentLoopRunner }, { readFileTool }] = await Promise.all([
    import("../skills/agent-loop/index.ts"),
    import("../skills/file-tools.ts"),
  ]);

  let llmCallCount = 0;
  const mockLLMCaller = {
    async call(_messages: BaseMessage[], _tools: Tool<unknown, unknown, unknown>[]): Promise<AssistantMessage> {
      llmCallCount++;
      if (llmCallCount <= 4) {
        return {
          role: "assistant",
          content: [
            { type: "text", text: `Turn ${llmCallCount}: reading file` },
            {
              type: "tool_use",
              id: `tu_${llmCallCount}`,
              name: "read_file",
              input: { path: "package.json" },
            },
          ],
        };
      }
      return {
        role: "assistant",
        content: "Done after 5 turns.",
      };
    },
  };

  const runner = createAgentLoopRunner({
    sessionId: "bench-agent-loop",
    tools: [readFileTool as Tool<unknown, unknown, unknown>],
    llmCaller: mockLLMCaller,
    enableBackgroundReview: false,
  });

  const start = performance.now();
  for await (const _ of runner.run("Start benchmark conversation")) {
    // consume generator
  }
  const totalMs = performance.now() - start;

  // Cleanup
  try {
    resetDbSingleton();
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  return {
    name: "agent-loop",
    metrics: {
      total_ms: totalMs,
      turns_per_sec: 5 / (totalMs / 1000),
      turns: 5,
    },
    details: [{ llmCallCount, totalMs }],
    timestamp: Date.now(),
  };
}
