import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insertAnchor,
  reinforceAnchor,
  getAnchors,
  getRelevantAnchors,
  deleteSessionAnchors,
  rowToAnchorMemory,
} from "../../../skills/personality/anchor-store.ts";

vi.mock("../../../core/db-manager.ts", () => {
  const run = vi.fn();
  const get = vi.fn().mockReturnValue(null);
  const all = vi.fn().mockReturnValue([]);
  return {
    getDb: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run, get, all }),
    }),
    __testDbMocks: { run, get, all },
  };
});

describe("anchor-store", () => {
  beforeEach(async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.run.mockClear();
    __testDbMocks.get.mockReturnValue(null);
    __testDbMocks.all.mockReturnValue([]);
  });

  it("insertAnchor creates anchor", () => {
    const anchor = insertAnchor("s1", { content: "likes tea", category: "preference", importance: 0.8 });
    expect(anchor.content).toBe("likes tea");
    expect(anchor.category).toBe("preference");
    expect(anchor.reinforcementCount).toBe(1);
  });

  it("reinforceAnchor returns null when not found", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.get.mockReturnValue(null);
    const result = reinforceAnchor("s1", "a1");
    expect(result).toBeNull();
  });

  it("reinforceAnchor increments count when found", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.get.mockReturnValue({
      id: "a1",
      session_id: "s1",
      content: "likes tea",
      category: "preference",
      importance: 0.8,
      created_at: 1000,
      reinforcement_count: 3,
      last_accessed_at: 1000,
    });
    const result = reinforceAnchor("s1", "a1");
    expect(result).not.toBeNull();
    expect(result!.reinforcementCount).toBe(4);
  });

  it("getAnchors filters by category", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.all.mockReturnValue([
      { id: "a1", session_id: "s1", content: "x", category: "value", importance: 0.5, created_at: 1, reinforcement_count: 1, last_accessed_at: 1 },
    ]);
    const anchors = getAnchors("s1", "value");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].category).toBe("value");
  });

  it("getRelevantAnchors filters by query", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.all.mockReturnValue([
      { id: "a1", session_id: "s1", content: "likes green tea", category: "preference", importance: 0.9, created_at: 1, reinforcement_count: 1, last_accessed_at: 1 },
      { id: "a2", session_id: "s1", content: "likes coffee", category: "preference", importance: 0.5, created_at: 1, reinforcement_count: 1, last_accessed_at: 1 },
    ]);
    const anchors = getRelevantAnchors("s1", "tea");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].content).toBe("likes green tea");
  });

  it("deleteSessionAnchors calls delete", () => {
    deleteSessionAnchors("s1");
  });

  it("rowToAnchorMemory maps fields", () => {
    const row = {
      id: "a1",
      content: "test",
      category: "value",
      importance: 0.5,
      created_at: 1000,
      reinforcement_count: 2,
      last_accessed_at: 2000,
    };
    const anchor = rowToAnchorMemory(row);
    expect(anchor.id).toBe("a1");
    expect(anchor.reinforcementCount).toBe(2);
    expect(anchor.lastAccessedAt).toBe(2000);
  });
});
