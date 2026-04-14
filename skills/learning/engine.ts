import { ExperienceLearner } from "./experience-learner.ts";
import { PatternRecognizer, type ToolCallPattern } from "./pattern-recognizer.ts";
import { AdaptiveOptimizer, type AdaptiveConfig } from "./adaptive-optimizer.ts";
import { EvolutionEngine, type PromptVariant } from "./evolution-engine.ts";

export interface LearningSuggestion {
  experiences: ReturnType<ExperienceLearner["retrieveSimilarExperiences"]>;
  pattern: ToolCallPattern | null;
  config: AdaptiveConfig | null;
}

export class LearningEngine {
  public readonly experienceLearner: ExperienceLearner;
  public readonly patternRecognizer: PatternRecognizer;
  public readonly adaptiveOptimizer: AdaptiveOptimizer;
  public readonly evolutionEngine: EvolutionEngine;

  constructor(dbPath?: string) {
    this.experienceLearner = new ExperienceLearner(dbPath);
    this.patternRecognizer = new PatternRecognizer();
    this.adaptiveOptimizer = new AdaptiveOptimizer(dbPath);
    this.evolutionEngine = new EvolutionEngine();
  }

  recordOutcome(
    sessionId: string,
    trajectory: { toolCalls: string[]; success: boolean }[],
    config: AdaptiveConfig,
    success: boolean
  ): void {
    this.patternRecognizer.analyze(trajectory);
    this.adaptiveOptimizer.recordResult(sessionId, config, success);
  }

  getSuggestions(sessionId: string, query: string): LearningSuggestion {
    return {
      experiences: this.experienceLearner.retrieveSimilarExperiences(sessionId, query),
      pattern: this.patternRecognizer.suggestOptimizedSequence(query),
      config: this.adaptiveOptimizer.suggestConfig(sessionId),
    };
  }

  async evolvePrompts(
    basePrompt: string,
    evaluateFn: (variant: PromptVariant) => number,
    generations = 3
  ): Promise<PromptVariant> {
    this.evolutionEngine.createPopulation(basePrompt);
    for (let i = 0; i < generations; i++) {
      await this.evolutionEngine.runGeneration(evaluateFn);
    }
    const best = this.evolutionEngine.getBest();
    if (!best) throw new Error("Evolution failed to produce a variant");
    return best;
  }
}
