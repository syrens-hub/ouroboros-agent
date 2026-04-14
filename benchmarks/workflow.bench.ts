import { StateGraph } from "../core/state-graph.ts";
import { Crew, type CrewAgentRole, type CrewTask } from "../skills/crewai/index.ts";
import type { BenchmarkResult } from "./types.ts";

interface BenchState {
  count: number;
  values: number[];
}

export async function runWorkflowBenchmark(): Promise<BenchmarkResult> {
  const details: Array<{ graph: string; compileMs: number; invokeMs: number; totalMs: number }> = [];

  // 10-node sequential graph
  const seqGraph = new StateGraph<BenchState>();
  for (let i = 0; i < 10; i++) {
    seqGraph.addNode(`node_${i}`, async (state) => ({
      count: state.count + 1,
      values: [...state.values, i],
    }));
  }
  seqGraph.addEdge("__start__", "node_0");
  for (let i = 0; i < 9; i++) {
    seqGraph.addEdge(`node_${i}`, `node_${i + 1}`);
  }

  const seqStartCompile = performance.now();
  const compiledSeq = seqGraph.compile();
  const seqCompileMs = performance.now() - seqStartCompile;

  const seqStartInvoke = performance.now();
  await compiledSeq.invoke({ count: 0, values: [] });
  const seqInvokeMs = performance.now() - seqStartInvoke;

  details.push({
    graph: "sequential-10",
    compileMs: seqCompileMs,
    invokeMs: seqInvokeMs,
    totalMs: seqCompileMs + seqInvokeMs,
  });

  // 4-branch parallel graph
  const parGraph = new StateGraph<BenchState>();
  parGraph.addNode("__start__", (s) => s);
  for (let i = 0; i < 4; i++) {
    parGraph.addNode(`branch_${i}`, async (state) => ({
      count: state.count + 1,
      values: [...state.values, i],
    }));
    parGraph.addEdge("__start__", `branch_${i}`);
  }
  parGraph.addParallel(
    ["branch_0", "branch_1", "branch_2", "branch_3"],
    (states) => ({
      count: states.reduce((sum, s) => sum + s.count, 0),
      values: states.flatMap((s) => s.values),
    })
  );
  parGraph.addNode("merge", (s) => s);
  for (let i = 0; i < 4; i++) {
    parGraph.addEdge(`branch_${i}`, "merge");
  }

  const parStartCompile = performance.now();
  const compiledPar = parGraph.compile();
  const parCompileMs = performance.now() - parStartCompile;

  const parStartInvoke = performance.now();
  await compiledPar.invoke({ count: 0, values: [] });
  const parInvokeMs = performance.now() - parStartInvoke;

  details.push({
    graph: "parallel-4",
    compileMs: parCompileMs,
    invokeMs: parInvokeMs,
    totalMs: parCompileMs + parInvokeMs,
  });

  // Small Crew sequential task
  const roles: CrewAgentRole[] = [
    { name: "worker", backstory: "A worker", goal: "Work", allowDelegation: false, toolsWhitelist: [] },
  ];
  const tasks: CrewTask[] = [
    { id: "task_1", description: "Step 1", expectedOutput: "Done", agentRole: "worker" },
    { id: "task_2", description: "Step 2", expectedOutput: "Done", agentRole: "worker" },
    { id: "task_3", description: "Step 3", expectedOutput: "Done", agentRole: "worker" },
  ];

  const crew = new Crew(roles, tasks, "sequential");
  const crewStart = performance.now();
  await crew.run("Benchmark crew");
  const crewMs = performance.now() - crewStart;

  details.push({
    graph: "crew-sequential-3",
    compileMs: 0,
    invokeMs: crewMs,
    totalMs: crewMs,
  });

  return {
    name: "workflow",
    metrics: {
      sequential_10_compile_ms: seqCompileMs,
      sequential_10_invoke_ms: seqInvokeMs,
      sequential_10_total_ms: seqCompileMs + seqInvokeMs,
      parallel_4_compile_ms: parCompileMs,
      parallel_4_invoke_ms: parInvokeMs,
      parallel_4_total_ms: parCompileMs + parInvokeMs,
      crew_sequential_3_ms: crewMs,
    },
    details,
    timestamp: Date.now(),
  };
}
