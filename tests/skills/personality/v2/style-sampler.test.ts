import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../../core/db-manager.ts";
import {
  recordStyleSample,
  getStyleSamples,
  formatStylePrompt,
  initStyleSamplerTables,
} from "../../../../skills/personality/v2/style-sampler.ts";

describe("StyleSampler", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initStyleSamplerTables(db);
    db.exec("DELETE FROM style_samples;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("records and retrieves style samples", () => {
    recordStyleSample("Hello there!", 5);
    recordStyleSample("General Kenobi!", 4);

    const samples = getStyleSamples();
    expect(samples).toHaveLength(2);
    expect(samples[0].message).toBe("Hello there!");
    expect(samples[0].rating).toBe(5);
    expect(samples[1].message).toBe("General Kenobi!");
    expect(samples[1].rating).toBe(4);
  });

  it("respects limit parameter", () => {
    recordStyleSample("A", 5);
    recordStyleSample("B", 4);
    recordStyleSample("C", 3);

    expect(getStyleSamples(2)).toHaveLength(2);
  });

  it("orders by rating desc then created desc", () => {
    recordStyleSample("low", 1);
    recordStyleSample("high", 5);
    recordStyleSample("mid", 3);

    const samples = getStyleSamples();
    expect(samples[0].message).toBe("high");
    expect(samples[1].message).toBe("mid");
    expect(samples[2].message).toBe("low");
  });

  it("formats style prompt", () => {
    recordStyleSample("Short and punchy.", 5);
    const prompt = formatStylePrompt();
    expect(prompt).toContain("Examples of my style:");
    expect(prompt).toContain("Short and punchy.");
  });

  it("returns empty string when no samples", () => {
    expect(formatStylePrompt()).toBe("");
  });
});
