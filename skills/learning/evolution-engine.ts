import { randomUUID } from "crypto";

export interface PromptVariant {
  id: string;
  prompt: string;
  fitness: number;
}

const SYNONYMS: Record<string, string[]> = {
  analyze: ["examine", "inspect", "study", "evaluate"],
  create: ["make", "build", "generate", "produce"],
  fast: ["quick", "rapid", "swift", "speedy"],
  good: ["great", "excellent", "superb", "fine"],
  help: ["assist", "aid", "support", "guide"],
  important: ["crucial", "critical", "essential", "vital"],
  improve: ["enhance", "upgrade", "refine", "optimize"],
  result: ["outcome", "output", "product", "consequence"],
  system: ["framework", "platform", "structure", "environment"],
  tool: ["instrument", "utility", "device", "apparatus"],
  use: ["utilize", "employ", "apply", "operate"],
  write: ["compose", "draft", "author", "record"],
};

function randomSynonym(word: string): string {
  const lower = word.toLowerCase();
  const candidates = SYNONYMS[lower];
  if (!candidates) return word;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  // Preserve original casing roughly
  if (word[0] === word[0].toUpperCase()) {
    return pick.charAt(0).toUpperCase() + pick.slice(1);
  }
  return pick;
}

function mutatePrompt(prompt: string): string {
  const words = prompt.split(" ");
  const result: string[] = [];
  for (const word of words) {
    const r = Math.random();
    if (r < 0.1) {
      // delete word
      continue;
    } else if (r < 0.3) {
      // swap synonym
      result.push(randomSynonym(word));
    } else {
      result.push(word);
    }
  }
  return result.join(" ") || prompt;
}

function crossover(a: string, b: string): string {
  const wordsA = a.split(" ");
  const wordsB = b.split(" ");
  const split = Math.floor(Math.random() * wordsA.length);
  const child = wordsA.slice(0, split).concat(wordsB.slice(split));
  return child.join(" ");
}

export class EvolutionEngine {
  private population: PromptVariant[] = [];

  createPopulation(basePrompt: string, size = 6): PromptVariant[] {
    this.population = [];
    for (let i = 0; i < size; i++) {
      this.population.push({
        id: randomUUID(),
        prompt: mutatePrompt(basePrompt),
        fitness: 0,
      });
    }
    return this.population;
  }

  async runGeneration(evaluateFn: (variant: PromptVariant) => number): Promise<PromptVariant[]> {
    for (const variant of this.population) {
      variant.fitness = evaluateFn(variant);
    }

    this.population.sort((a, b) => b.fitness - a.fitness);

    const keepCount = Math.max(1, Math.floor(this.population.length / 2));
    const survivors = this.population.slice(0, keepCount);

    const offspring: PromptVariant[] = [];
    while (survivors.length + offspring.length < this.population.length) {
      const parentA = survivors[Math.floor(Math.random() * survivors.length)];
      const parentB = survivors[Math.floor(Math.random() * survivors.length)];
      const childPrompt = mutatePrompt(crossover(parentA.prompt, parentB.prompt));
      offspring.push({
        id: randomUUID(),
        prompt: childPrompt,
        fitness: 0,
      });
    }

    this.population = [...survivors, ...offspring];
    return this.population;
  }

  getBest(): PromptVariant | null {
    if (this.population.length === 0) return null;
    return this.population.reduce((best, v) => (v.fitness > best.fitness ? v : best), this.population[0]);
  }
}
