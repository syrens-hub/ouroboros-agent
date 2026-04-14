import { describe, it, expect } from "vitest";
import { createInMemoryVectorMemory } from "../../core/vector-memory.ts";

describe("Vector Memory", () => {
  it("stores and retrieves by similarity", async () => {
    const memory = createInMemoryVectorMemory();
    await memory.add("s1", "Ouroboros is a self-modifying agent system.");
    await memory.add("s1", "The agent loop can be replaced by learned skills.");
    await memory.add("s2", "Unrelated session about pizza recipes.");

    const results = await memory.search("s1", "self modifying agent", 2);
    expect(results.length).toBe(2);
    expect(results[0].entry.content).toContain("self-modifying");
  });

  it("deletes an entry", async () => {
    const memory = createInMemoryVectorMemory();
    const id = await memory.add("s1", "test content");
    expect(await memory.delete("s1", id)).toBe(true);
    expect(await memory.delete("s1", id)).toBe(false);
  });

  it("supports custom embedding function", async () => {
    const memory = createInMemoryVectorMemory((text) => {
      // Simple word-count embedding for test determinism
      return [text.split(" ").length, text.length];
    });
    await memory.add("s1", "short");
    await memory.add("s1", "this is a much longer sentence with many words");

    const results = await memory.search("s1", "many words long sentence", 1);
    expect(results.length).toBe(1);
    expect(results[0].entry.content).toContain("longer");
  });
});
