import { describe, it, expect } from "vitest";
import { EvolutionEngine } from "../../../skills/learning/evolution-engine.ts";

describe("EvolutionEngine", () => {
  it("creates a population of variants", () => {
    const engine = new EvolutionEngine();
    const population = engine.createPopulation("Analyze the input carefully and produce a correct result.", 6);
    expect(population.length).toBe(6);
    for (const variant of population) {
      expect(variant.prompt).toBeTruthy();
      expect(variant.id).toBeTruthy();
    }
  });

  it("runs a generation and selects the best", async () => {
    const engine = new EvolutionEngine();
    engine.createPopulation("Write clean and efficient code.", 6);
    await engine.runGeneration((variant) => {
      return variant.prompt.includes("clean") ? 10 : 1;
    });
    const best = engine.getBest();
    expect(best).not.toBeNull();
    expect(best!.fitness).toBe(10);
  });

  it("improves fitness over multiple generations", async () => {
    const engine = new EvolutionEngine();
    engine.createPopulation("Improve the system performance.", 8);
    for (let i = 0; i < 5; i++) {
      await engine.runGeneration((variant) => {
        return /improve|enhance|optimize/i.test(variant.prompt) ? 10 : 1;
      });
    }
    const best = engine.getBest();
    expect(best).not.toBeNull();
    expect(best!.fitness).toBe(10);
  });
});
