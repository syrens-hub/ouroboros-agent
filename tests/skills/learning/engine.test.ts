import { describe, it, expect } from "vitest";
import { LearningEngine } from "../../../skills/learning/engine.ts";

describe("LearningEngine", () => {
  it("constructs with default dbPath", () => {
    const engine = new LearningEngine();
    expect(engine.experienceLearner).toBeDefined();
    expect(engine.patternRecognizer).toBeDefined();
    expect(engine.adaptiveOptimizer).toBeDefined();
    expect(engine.evolutionEngine).toBeDefined();
  });

  it("records outcome without throwing", () => {
    const engine = new LearningEngine();
    expect(() =>
      engine.recordOutcome("sess-1", [{ toolCalls: ["bash"], success: true }], { temperature: 0.7, maxTokens: 1000, pruningStrategy: "default", contextBudget: 4000 }, true)
    ).not.toThrow();
  });

  it("getSuggestions returns structure", () => {
    const engine = new LearningEngine();
    const suggestions = engine.getSuggestions("sess-1", "how to list files");
    expect(suggestions).toHaveProperty("experiences");
    expect(suggestions).toHaveProperty("pattern");
    expect(suggestions).toHaveProperty("config");
  });

  it("evolvePrompts runs generations and returns best variant", async () => {
    const engine = new LearningEngine();
    const best = await engine.evolvePrompts("base prompt", () => Math.random(), 2);
    expect(typeof best.prompt).toBe("string");
  });
});
