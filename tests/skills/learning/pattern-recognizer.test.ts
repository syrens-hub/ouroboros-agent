import { describe, it, expect } from "vitest";
import { PatternRecognizer } from "../../../skills/learning/pattern-recognizer.ts";

describe("PatternRecognizer", () => {
  it("analyzes patterns from trajectories", () => {
    const recognizer = new PatternRecognizer();
    const patterns = recognizer.analyze([
      { toolCalls: ["read_file", "edit_file", "run_test"], success: true },
      { toolCalls: ["read_file", "edit_file", "run_test"], success: true },
      { toolCalls: ["open_file", "edit_file", "run_lint"], success: false },
    ]);

    expect(patterns.length).toBeGreaterThan(0);
    const target = patterns.find((p) =>
      p.sequence.join("→") === "read_file→edit_file→run_test"
    );
    expect(target).toBeDefined();
    if (target) {
      expect(target.successRate).toBe(1);
    }
  });

  it("suggests optimized sequence for task type", () => {
    const recognizer = new PatternRecognizer();
    recognizer.analyze([
      { toolCalls: ["search_web", "fetch_page", "summarize"], success: true },
      { toolCalls: ["search_web", "fetch_page", "summarize"], success: true },
      { toolCalls: ["search_web", "fetch_page", "summarize"], success: false },
    ]);

    const suggestion = recognizer.suggestOptimizedSequence("summarize");
    expect(suggestion).not.toBeNull();
    expect(suggestion?.sequence).toContain("summarize");
  });
});
