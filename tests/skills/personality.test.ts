import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPersonalityEvolution } from "../../skills/personality/index.ts";
import { resetDbSingleton, getDb } from "../../core/db-manager.ts";

describe("PersonalityEvolution", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec("DELETE FROM personality_anchors;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("initializes with default traits and values", () => {
    const pe = createPersonalityEvolution("s1");
    const state = pe.getState();
    expect(state.traits.curiosity).toBe(0.8);
    expect(state.values.honesty).toBe(0.95);
    expect(state.evolutionStage).toBe(1);
  });

  it("evolves traits from positive feedback", () => {
    const pe = createPersonalityEvolution("s1");
    const before = pe.getState().traits.creativity;
    pe.recordInteraction({
      userId: "u1",
      userMessage: "hi",
      agentResponse: "hello",
      context: {},
      feedback: { type: "like" },
    });
    const after = pe.getState().traits.creativity;
    expect(after).toBeGreaterThan(before);
  });

  it("adds and retrieves anchor memories", () => {
    const pe = createPersonalityEvolution("s1");
    pe.addAnchorMemory({ content: "User prefers concise answers", category: "preference", importance: 0.8 });
    const anchors = pe.getAnchorMemories();
    expect(anchors.length).toBe(1);
    expect(anchors[0].content).toBe("User prefers concise answers");
  });

  it("reinforces anchors", () => {
    const pe = createPersonalityEvolution("s1");
    pe.addAnchorMemory({ content: "Important rule", category: "value", importance: 0.9 });
    const anchor = pe.getAnchorMemories()[0];
    const before = anchor.reinforcementCount;
    pe.reinforceAnchor(anchor.id);
    const after = pe.getAnchorMemories()[0];
    expect(after.reinforcementCount).toBe(before + 1);
  });

  it("finds relevant anchors by query", () => {
    const pe = createPersonalityEvolution("s1");
    pe.addAnchorMemory({ content: "Loves Python", category: "preference", importance: 0.7 });
    pe.addAnchorMemory({ content: "Hates Java", category: "preference", importance: 0.6 });
    const relevant = pe.getRelevantAnchors("python");
    expect(relevant.length).toBe(1);
    expect(relevant[0].content).toBe("Loves Python");
  });

  it("generates a personality description", () => {
    const pe = createPersonalityEvolution("s1");
    const desc = pe.generatePersonalityDescription();
    expect(desc).toContain("阶段");
    expect(desc).toContain("特征:");
    expect(desc).toContain("价值观:");
  });
});
