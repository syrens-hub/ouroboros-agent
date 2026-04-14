import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { AdaptiveOptimizer } from "../../../skills/learning/adaptive-optimizer.ts";

describe("AdaptiveOptimizer", () => {
  let optimizer: AdaptiveOptimizer;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(process.cwd(), ".ouroboros", `test-adaptive-${Date.now()}`, "optimizer.db");
    optimizer = new AdaptiveOptimizer(dbPath);
  });

  afterEach(() => {
    optimizer.close();
    const dir = join(dbPath, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("records results and suggests best config", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );

    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );

    const best = optimizer.suggestConfig("sess-1");
    randomSpy.mockRestore();
    expect(best).not.toBeNull();
    expect(best?.temperature).toBe(0.2);
    expect(best?.pruningStrategy).toBe("aggressive");
  });

  it("returns null when no config has enough samples", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );

    const best = optimizer.suggestConfig("sess-1");
    randomSpy.mockRestore();
    expect(best).toBeNull();
  });

  it("explores via epsilon-greedy when random is below threshold", () => {
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );

    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );

    const randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.05)
      .mockReturnValueOnce(0.99);
    const suggestion = optimizer.suggestConfig("sess-1");
    randomSpy.mockRestore();

    expect(suggestion).not.toBeNull();
    // Exploration should return the suboptimal config (index 1 with 2 rows)
    expect(suggestion?.temperature).toBe(0.8);
  });

  it("exploits best config when random is above threshold", () => {
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.2, maxTokens: 1024, pruningStrategy: "aggressive", contextBudget: 4000 },
      true
    );

    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );
    optimizer.recordResult(
      "sess-1",
      { temperature: 0.8, maxTokens: 2048, pruningStrategy: "conservative", contextBudget: 8000 },
      false
    );

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const suggestion = optimizer.suggestConfig("sess-1");
    randomSpy.mockRestore();

    expect(suggestion).not.toBeNull();
    expect(suggestion?.temperature).toBe(0.2);
  });
});
