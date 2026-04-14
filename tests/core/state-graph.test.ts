import { describe, it, expect } from "vitest";
import {
  StateGraph,
  StateGraphMaxStepsError,
  StateGraphInterruptedError,
} from "../../core/state-graph.ts";

describe("StateGraph", () => {
  it("runs a linear graph (A → B → C)", async () => {
    const graph = new StateGraph<{ values: string[] }>();
    graph
      .addNode("A", (state) => ({ values: [...state.values, "A"] }))
      .addNode("B", (state) => ({ values: [...state.values, "B"] }))
      .addNode("C", (state) => ({ values: [...state.values, "C"] }))
      .addEdge("A", "B")
      .addEdge("B", "C");

    const compiled = graph.compile();
    const result = await compiled.invoke({ values: [] });
    expect(result.values).toEqual(["A", "B", "C"]);
  });

  it("streams a linear graph", async () => {
    const graph = new StateGraph<{ values: string[] }>();
    graph
      .addNode("A", (state) => ({ values: [...state.values, "A"] }))
      .addNode("B", (state) => ({ values: [...state.values, "B"] }))
      .addEdge("A", "B");

    const compiled = graph.compile();
    const events: { nodeId: string; state: { values: string[] } }[] = [];
    for await (const event of compiled.stream({ values: [] })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ nodeId: "A", state: { values: ["A"] } });
    expect(events[1]).toEqual({ nodeId: "B", state: { values: ["A", "B"] } });
  });

  it("follows conditional edges based on state", async () => {
    const graph = new StateGraph<{
      path: "left" | "right";
      visited: string[];
    }>();
    graph
      .addNode("start", (state) => ({
        ...state,
        visited: [...state.visited, "start"],
      }))
      .addNode("left", (state) => ({
        ...state,
        visited: [...state.visited, "left"],
      }))
      .addNode("right", (state) => ({
        ...state,
        visited: [...state.visited, "right"],
      }))
      .addConditionalEdge("start", (state) => state.path, {
        left: "left",
        right: "right",
      });

    const leftResult = await graph.compile().invoke({
      path: "left",
      visited: [],
    });
    expect(leftResult.visited).toEqual(["start", "left"]);

    const rightResult = await graph.compile().invoke({
      path: "right",
      visited: [],
    });
    expect(rightResult.visited).toEqual(["start", "right"]);
  });

  it("enforces maxSteps on cycles", async () => {
    const graph = new StateGraph<{ count: number }>();
    graph.addNode("inc", (state) => ({ count: state.count + 1 }));
    graph.addEdge("inc", "inc");

    await expect(
      graph.compile().invoke({ count: 0 }, { maxSteps: 5 }),
    ).rejects.toThrow(StateGraphMaxStepsError);
  });

  it("runs parallel branches and merges results", async () => {
    const graph = new StateGraph<{ sum: number }>();
    graph
      .addNode("start", (state) => ({ sum: state.sum + 1 }))
      .addNode("branch1", (state) => ({ sum: state.sum + 10 }))
      .addNode("branch2", (state) => ({ sum: state.sum + 100 }))
      .addNode("end", (state) => ({ sum: state.sum * 2 }));
    graph.addParallel(["branch1", "branch2"], (states) => ({
      sum: states.reduce((a, b) => a + b.sum, 0),
    }));
    graph
      .addEdge("start", "branch1")
      .addEdge("start", "branch2")
      .addEdge("branch1", "end")
      .addEdge("branch2", "end");

    const result = await graph.compile().invoke({ sum: 0 });
    // start: sum = 1
    // branch1: sum = 11, branch2: sum = 101 (both from 1)
    // merge: sum = 11 + 101 = 112
    // end: sum = 112 * 2 = 224
    expect(result.sum).toBe(224);
  });

  it("streams parallel branches", async () => {
    const graph = new StateGraph<{ value: number }>();
    graph
      .addNode("start", (state) => ({ value: state.value + 1 }))
      .addNode("branch1", (state) => ({ value: state.value + 10 }))
      .addNode("branch2", (state) => ({ value: state.value + 100 }));
    graph.addParallel(["branch1", "branch2"], (states) => ({
      value: states.reduce((a, b) => a + b.value, 0),
    }));
    graph.addEdge("start", "branch1");
    graph.addEdge("start", "branch2");

    const events: { nodeId: string; state: { value: number } }[] = [];
    for await (const event of graph.compile().stream({ value: 0 })) {
      events.push(event);
    }

    expect(events.find((e) => e.nodeId === "start")).toEqual({
      nodeId: "start",
      state: { value: 1 },
    });

    const branchEvents = events.filter(
      (e) => e.nodeId === "branch1" || e.nodeId === "branch2",
    );
    expect(branchEvents).toHaveLength(2);
    // Both branches see the merged state after parallel execution
    expect(branchEvents.every((e) => e.state.value === 112)).toBe(true);
  });

  it("interrupts and resumes execution via CompiledStateGraph", async () => {
    const graph = new StateGraph<{ values: string[] }>();
    graph
      .addNode("A", (state) => ({ values: [...state.values, "A"] }))
      .addNode("B", (state) => ({ values: [...state.values, "B"] }))
      .addNode("C", (state) => ({ values: [...state.values, "C"] }))
      .addEdge("A", "B")
      .addEdge("B", "C")
      .interruptAt("B");

    const compiled = graph.compile();
    let checkpoint;
    try {
      await compiled.invoke({ values: [] });
    } catch (e) {
      if (e instanceof StateGraphInterruptedError) {
        checkpoint = e.checkpoint;
      } else {
        throw e;
      }
    }

    expect(checkpoint).toBeDefined();
    expect(checkpoint!.nodeId).toBe("B");
    expect(checkpoint!.state).toEqual({ values: ["A"] });
    expect(checkpoint!.visited).toEqual(["A"]);

    const result = await compiled.resume(checkpoint!);
    expect(result).toEqual({ values: ["A", "B", "C"] });
  });

  it("resumes execution via StateGraph", async () => {
    const graph = new StateGraph<{ values: string[] }>();
    graph
      .addNode("A", (state) => ({ values: [...state.values, "A"] }))
      .addNode("B", (state) => ({ values: [...state.values, "B"] }))
      .addNode("C", (state) => ({ values: [...state.values, "C"] }))
      .addEdge("A", "B")
      .addEdge("B", "C")
      .interruptAt("B");

    const compiled = graph.compile();
    let checkpoint;
    try {
      await compiled.invoke({ values: [] });
    } catch (e) {
      if (e instanceof StateGraphInterruptedError) {
        checkpoint = e.checkpoint;
      } else {
        throw e;
      }
    }

    const result = await graph.resume(checkpoint!);
    expect(result).toEqual({ values: ["A", "B", "C"] });
  });

  it("uses __start__ as entry point when present", async () => {
    const graph = new StateGraph<{ values: string[] }>();
    graph
      .addNode("first", (state) => ({
        values: [...state.values, "first"],
      }))
      .addNode("__start__", (state) => ({
        values: [...state.values, "start"],
      }))
      .addNode("end", (state) => ({ values: [...state.values, "end"] }))
      .addEdge("__start__", "end");

    const result = await graph.compile().invoke({ values: [] });
    expect(result.values).toEqual(["start", "end"]);
  });
});
