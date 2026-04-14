import { describe, it, expect, beforeEach } from "vitest";
import { VectorStore } from "../../../skills/knowledge-base/vector-store.ts";
import { getDb } from "../../../core/db-manager.ts";

function vec(dim: number, value: number): number[] {
  const v = new Array(dim).fill(0);
  v[0] = value;
  return v;
}

describe("VectorStore", () => {
  let store: VectorStore;
  const sessionId = "test_session_kb";

  beforeEach(() => {
    store = new VectorStore();
    store.clear(sessionId);
    store.clear("other");
    // Also delete any leftover test ids from previous runs
    getDb().prepare("DELETE FROM vector_embeddings WHERE id LIKE 'v%'").run();
  });

  it("adds and searches entries", () => {
    const v1 = vec(256, 1);
    const v2 = vec(256, 0.5);
    v2[1] = 1; // make v2 point in a different direction so similarity is unambiguous
    store.add({
      id: "v1",
      sessionId,
      content: "hello world",
      embedding: v1,
      createdAt: Date.now(),
    });
    store.add({
      id: "v2",
      sessionId,
      content: "goodbye world",
      embedding: v2,
      createdAt: Date.now(),
    });

    const results = store.search(sessionId, vec(256, 1), 1);
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe("v1");
    expect(results[0].score).toBeGreaterThan(0.99);
  });

  it("addMany works efficiently", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      sessionId,
      content: `content ${i}`,
      embedding: vec(256, i / 10),
      createdAt: Date.now(),
    }));
    store.addMany(entries);
    expect(store.count(sessionId)).toBe(10);
  });

  it("deletes an entry", () => {
    store.add({ id: "v1", sessionId, content: "a", embedding: vec(256, 1), createdAt: Date.now() });
    expect(store.count(sessionId)).toBe(1);
    expect(store.delete(sessionId, "v1")).toBe(true);
    expect(store.count(sessionId)).toBe(0);
    expect(store.delete(sessionId, "v1")).toBe(false);
  });

  it("clears session data", () => {
    store.add({ id: "v1", sessionId, content: "a", embedding: vec(256, 1), createdAt: Date.now() });
    store.add({ id: "v2", sessionId: "other", content: "b", embedding: vec(256, 1), createdAt: Date.now() });
    store.clear(sessionId);
    expect(store.count(sessionId)).toBe(0);
    expect(store.count("other")).toBe(1);
  });
});
