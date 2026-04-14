import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

vi.mock("../../benchmarks/llm-router.bench.ts", () => ({
  runLLMRouterBenchmark: vi.fn().mockResolvedValue({
    name: "llm-router",
    metrics: { openai_p50_ms: 123 },
    details: [],
    timestamp: 1,
  }),
}));

vi.mock("../../benchmarks/rag-retrieval.bench.ts", () => ({
  runRAGRetrievalBenchmark: vi.fn().mockResolvedValue({
    name: "rag-retrieval",
    metrics: { recall_at_3: 0.9 },
    details: [],
    timestamp: 2,
  }),
}));

vi.mock("../../benchmarks/agent-loop.bench.ts", () => ({
  runAgentLoopBenchmark: vi.fn().mockResolvedValue({
    name: "agent-loop",
    metrics: { turns_per_sec: 2 },
    details: [],
    timestamp: 3,
  }),
}));

vi.mock("../../benchmarks/tool-throughput.bench.ts", () => ({
  runToolThroughputBenchmark: vi.fn().mockResolvedValue({
    name: "tool-throughput",
    metrics: { concurrency_4_total_ms: 45 },
    details: [],
    timestamp: 4,
  }),
}));

vi.mock("../../benchmarks/workflow.bench.ts", () => ({
  runWorkflowBenchmark: vi.fn().mockResolvedValue({
    name: "workflow",
    metrics: { crew_sequential_3_ms: 67 },
    details: [],
    timestamp: 5,
  }),
}));

import { runAll, main } from "../../benchmarks/runner.ts";

describe("Benchmark Runner", () => {
  const summaryPath = join(process.cwd(), ".ouroboros", "benchmarks", "summary.json");

  beforeEach(() => {
    if (existsSync(summaryPath)) {
      rmSync(summaryPath, { force: true });
    }
  });

  afterEach(() => {
    if (existsSync(summaryPath)) {
      rmSync(summaryPath, { force: true });
    }
  });

  it("runAll runs selected benchmarks and returns results", async () => {
    const results = await runAll({ suite: "all" });
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.name)).toEqual([
      "llm-router",
      "rag-retrieval",
      "agent-loop",
      "tool-throughput",
      "workflow",
    ]);
  });

  it("main prints markdown and writes summary.json", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--suite=all"]);

    const lastLog = logSpy.mock.calls[logSpy.mock.calls.length - 1]?.[0] as string;
    expect(lastLog).toContain("Summary written to");
    expect(lastLog).toContain("summary.json");

    const tableOutput = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("llm-router")
    );
    expect(tableOutput).toBeTruthy();
    const table = tableOutput![0] as string;
    expect(table).toContain("llm-router");
    expect(table).toContain("openai_p50_ms");
    expect(table).toContain("rag-retrieval");
    expect(table).toContain("recall_at_3");
    expect(table).toContain("agent-loop");
    expect(table).toContain("tool-throughput");
    expect(table).toContain("workflow");

    expect(existsSync(summaryPath)).toBe(true);
    const raw = readFileSync(summaryPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.results).toHaveLength(5);
    expect(parsed.generatedAt).toBeTypeOf("number");

    logSpy.mockRestore();
  });

  it("runAll respects suite filtering", async () => {
    const results = await runAll({ suite: "workflow" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("workflow");
  });
});
