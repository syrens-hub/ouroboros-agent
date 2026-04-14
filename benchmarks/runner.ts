#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { runLLMRouterBenchmark } from "./llm-router.bench.ts";
import { runRAGRetrievalBenchmark } from "./rag-retrieval.bench.ts";
import { runAgentLoopBenchmark } from "./agent-loop.bench.ts";
import { runToolThroughputBenchmark } from "./tool-throughput.bench.ts";
import { runWorkflowBenchmark } from "./workflow.bench.ts";
import type { BenchmarkResult } from "./types.ts";

const SUITES = ["all", "llm", "rag", "agent", "tool", "workflow"] as const;
type Suite = (typeof SUITES)[number];

function parseArgs(argv: string[]): { suite: Suite } {
  const arg = argv.find((a) => a.startsWith("--suite="));
  const raw = arg ? arg.replace("--suite=", "") : "all";
  if (!SUITES.includes(raw as Suite)) {
    console.error(`Unknown suite: ${raw}. Allowed: ${SUITES.join(" | ")}`);
    process.exit(1);
  }
  return { suite: raw as Suite };
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

function printMarkdownTable(results: BenchmarkResult[]) {
  const nameWidth = 24;
  const metricWidth = 28;
  const valueWidth = 16;

  const header = `| ${pad("Benchmark", nameWidth)} | ${pad("Metric", metricWidth)} | ${pad("Value", valueWidth)} |`;
  const separator = `|${"-".repeat(nameWidth + 2)}|${"-".repeat(metricWidth + 2)}|${"-".repeat(valueWidth + 2)}|`;

  const lines: string[] = [header, separator];

  for (const result of results) {
    const entries = Object.entries(result.metrics);
    if (entries.length === 0) {
      lines.push(`| ${pad(result.name, nameWidth)} | ${pad("(no metrics)", metricWidth)} | ${pad("-", valueWidth)} |`);
      continue;
    }
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const nameCol = i === 0 ? pad(result.name, nameWidth) : " ".repeat(nameWidth);
      lines.push(
        `| ${nameCol} | ${pad(key, metricWidth)} | ${pad(Number(value).toFixed(4), valueWidth)} |`
      );
    }
  }

  const output = lines.join("\n");
  console.log(output);
  return output;
}

export async function runAll(opts?: { suite?: Suite }): Promise<BenchmarkResult[]> {
  const suite = opts?.suite ?? "all";
  const results: BenchmarkResult[] = [];

  const shouldRun = (name: Suite) => suite === "all" || suite === name;

  if (shouldRun("llm")) {
    results.push(await runLLMRouterBenchmark());
  }
  if (shouldRun("rag")) {
    results.push(await runRAGRetrievalBenchmark());
  }
  if (shouldRun("agent")) {
    results.push(await runAgentLoopBenchmark());
  }
  if (shouldRun("tool")) {
    results.push(await runToolThroughputBenchmark());
  }
  if (shouldRun("workflow")) {
    results.push(await runWorkflowBenchmark());
  }

  return results;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const { suite } = parseArgs(argv);
  const results = await runAll({ suite });
  printMarkdownTable(results);

  const outDir = join(process.cwd(), ".ouroboros", "benchmarks");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "summary.json");
  writeFileSync(outPath, JSON.stringify({ results, generatedAt: Date.now() }, null, 2), "utf-8");
  console.log(`\nSummary written to ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
