import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  parsePersona,
  recordStyleSample,
  getStyleSamples,
  formatStylePrompt,
  initStyleSamplerTables,
  learnFromSamples,
  getStyleProfile,
  adaptStyle,
  initStyleLearnerTables,
} from "../../../skills/personality/v2/index.ts";

describe("Personality v2", () => {
  describe("Persona Parser", () => {
    it("parses Chinese PERSONA.md", () => {
      const md = `
# 我是 Kimi

## 核心身份
本质：一个乐于助人的 AI 助手
名字：Kimi

## 性格特征
- 耐心：面对复杂问题时保持冷静
- 好奇心：喜欢探索新技术

## 说话风格
- 简洁明了，不绕弯子
- 技术讨论时准确使用术语
`;
      const profile = parsePersona(md);
      expect(profile.name).toBe("Kimi");
      expect(profile.essence).toBe("一个乐于助人的 AI 助手");
      expect(profile.traits["耐心"]).toBe("面对复杂问题时保持冷静");
      expect(profile.speechPatterns).toContain("简洁明了，不绕弯子");
    });

    it("parses English PERSONA.md", () => {
      const md = `
# Name: Assistant

## Core Identity
Essence: A helpful AI assistant
Name: Assistant

## Personality Traits
- Patience: stays calm under complex problems
- Curiosity: loves exploring new tech

## Speech Patterns
- Keep it concise
- Use precise terms in technical discussions
`;
      const profile = parsePersona(md);
      expect(profile.name).toBe("Assistant");
      expect(profile.essence).toBe("A helpful AI assistant");
      expect(profile.traits["Patience"]).toBe("stays calm under complex problems");
      expect(profile.speechPatterns).toContain("Keep it concise");
    });

    it("handles empty markdown gracefully", () => {
      const profile = parsePersona("");
      expect(profile.name).toBe("");
      expect(profile.essence).toBe("");
      expect(Object.keys(profile.traits)).toHaveLength(0);
      expect(profile.speechPatterns).toHaveLength(0);
    });
  });

  describe("Style Sampler", () => {
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
      recordStyleSample("How can I help?", 4);

      const samples = getStyleSamples(10);
      expect(samples).toHaveLength(2);
      expect(samples[0].message).toBe("Hello there!");
      expect(samples[0].rating).toBe(5);
    });

    it("returns empty array when no samples", () => {
      expect(getStyleSamples(10)).toHaveLength(0);
    });

    it("formats style prompt from top samples", () => {
      recordStyleSample("Short and sweet.", 5);
      recordStyleSample("Detailed explanation with context.", 4);

      const prompt = formatStylePrompt();
      expect(prompt).toContain("Examples of my style");
      expect(prompt).toContain("Short and sweet.");
    });

    it("returns empty prompt when no samples", () => {
      expect(formatStylePrompt()).toBe("");
    });
  });

  describe("Style Learner", () => {
    beforeEach(() => {
      resetDbSingleton();
      const db = getDb();
      initStyleSamplerTables(db);
      initStyleLearnerTables(db);
      db.exec("DELETE FROM style_samples;");
      db.exec("DELETE FROM style_dimensions;");
    });

    afterEach(() => {
      resetDbSingleton();
    });

    it("learns from high-rated samples", () => {
      recordStyleSample(
        "I would be delighted to assist you with this complex technical problem. Please let me know if you need further clarification.",
        5
      );
      recordStyleSample(
        "The API schema defines a middleware layer that handles async database transactions.",
        5
      );

      const profile = learnFromSamples();
      expect(profile.sampleCount).toBeGreaterThan(0);
      expect(profile.dimensions.formality).toBeGreaterThan(0);
      expect(profile.dimensions.technicality).toBeGreaterThan(0);
      expect(profile.weights.formality).toBeGreaterThan(0);
    });

    it("returns defaults when no high-rated samples", () => {
      const profile = learnFromSamples();
      expect(profile.sampleCount).toBe(0);
      expect(profile.dimensions.formality).toBe(0);
      expect(profile.weights.formality).toBe(0);
    });

    it("retrieves persisted style profile", () => {
      recordStyleSample("Hello! How are you doing today? I hope everything is well.", 5);
      learnFromSamples();

      const profile = getStyleProfile();
      expect(profile.sampleCount).toBeGreaterThan(0);
      expect(profile.updatedAt).toBeGreaterThan(0);
    });

    it("adapts style based on technical context", () => {
      for (let i = 0; i < 5; i++) {
        recordStyleSample(
          "The function returns a Promise<void> and uses async/await for database operations.",
          5
        );
      }
      learnFromSamples();

      const adaptation = adaptStyle("How do I fix this API bug?");
      expect(adaptation.prompt).toContain("technical");
      expect(adaptation.activeDimensions).toContain("technicality");
    });

    it("adapts style for casual context", () => {
      recordStyleSample("Hey! What's up? Let me know if you need anything fun to work on!", 5);
      learnFromSamples();

      const adaptation = adaptStyle("Just chatting about weekend plans");
      expect(adaptation.prompt.length).toBeGreaterThan(0);
    });

    it("adapts style for emotional context", () => {
      for (let i = 0; i < 5; i++) {
        recordStyleSample(
          "I understand how frustrating this must be. Let's work through it together step by step.",
          5
        );
      }
      learnFromSamples();

      const adaptation = adaptStyle("I'm stuck and feeling frustrated");
      expect(adaptation.prompt).toContain("understanding");
      expect(adaptation.activeDimensions).toContain("empathy");
    });

    it("provides fallback prompt when no profile", () => {
      const adaptation = adaptStyle("General question");
      expect(adaptation.prompt).toContain("Respond naturally");
    });
  });
});
