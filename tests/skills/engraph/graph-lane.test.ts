import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchGraphLane } from "../../../skills/engraph/graph-lane.ts";

vi.mock("../../../core/db-manager.ts", () => {
  const all = vi.fn().mockReturnValue([]);
  return {
    getDb: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all }),
    }),
    __testDbMocks: { all },
  };
});

describe("graph-lane", () => {
  beforeEach(async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.all.mockReturnValue([]);
  });

  it("returns rows mapped to SearchResult", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.all.mockReturnValue([
      { id: "a", target_id: "b", relation_type: "likes", weight: 0.8, depth: 1 },
    ]);
    const results = searchGraphLane({ text: "a", limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a→b");
    expect(results[0].lane).toBe("graph");
    expect(results[0].score).toBe(0.8);
  });

  it("returns empty array on db error", async () => {
    const { __testDbMocks } = await import("../../../core/db-manager.ts") as any;
    __testDbMocks.all.mockImplementation(() => {
      throw new Error("db error");
    });
    const results = searchGraphLane({ text: "x", limit: 5 });
    expect(results).toEqual([]);
  });
});
