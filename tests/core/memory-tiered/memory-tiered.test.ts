import { describe, it, expect, beforeEach } from "vitest";
import {
  setWorkingMemory,
  getWorkingMemory,
  getAllWorkingMemory,
  clearWorkingMemory,
  writeShortTermMemory,
  queryShortTermMemory,
  retrieveMemory,
  runMemoryMaintenance,
} from "../../../core/memory-tiered.ts";
import { getDb } from "../../../core/db-manager.ts";
import { initKGTables } from "../../../skills/engraph/kg-engine.ts";

describe("memory-tiered", () => {
  beforeEach(() => {
    clearWorkingMemory();
    const db = getDb();
    db.prepare("DELETE FROM memory_layers WHERE layer IN ('short_term', 'long_term')").run();
    initKGTables(db);
    db.prepare("DELETE FROM kg_edges").run();
    db.prepare("DELETE FROM kg_nodes").run();
  });

  describe("working memory", () => {
    it("stores and retrieves", () => {
      setWorkingMemory("sess1", "preference", "concise", 0.9);
      expect(getWorkingMemory("sess1", "preference")).toBe("concise");
    });

    it("returns undefined for missing key", () => {
      expect(getWorkingMemory("sess1", "missing")).toBeUndefined();
    });

    it("evicts when over capacity", () => {
      for (let i = 0; i < 15; i++) {
        setWorkingMemory("sess1", `key${i}`, `val${i}`, 0.1);
      }
      const all = getAllWorkingMemory("sess1");
      expect(all.length).toBeLessThanOrEqual(10);
    });

    it("clears per session", () => {
      setWorkingMemory("sess1", "a", "1");
      setWorkingMemory("sess2", "b", "2");
      clearWorkingMemory("sess1");
      expect(getWorkingMemory("sess1", "a")).toBeUndefined();
      expect(getWorkingMemory("sess2", "b")).toBe("2");
    });
  });

  describe("short-term memory", () => {
    it("writes and queries", () => {
      const write = writeShortTermMemory("User likes TypeScript", { sessionId: "s1", importance: 0.8 });
      expect(write.success).toBe(true);

      const query = queryShortTermMemory({ sessionId: "s1" });
      expect(query.success).toBe(true);
      expect(query.data!.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by query text", () => {
      writeShortTermMemory("TypeScript is great", { sessionId: "s1", importance: 0.8 });
      writeShortTermMemory("Python is nice", { sessionId: "s1", importance: 0.8 });

      const result = queryShortTermMemory({ sessionId: "s1", query: "TypeScript" });
      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
    });
  });

  describe("unified retrieval", () => {
    it("retrieves from working memory", () => {
      setWorkingMemory("s1", "lang", "TypeScript", 0.9);
      const result = retrieveMemory("s1", "TypeScript");
      expect(result.sources).toContain("working");
      expect(result.results.some((r) => r.source === "working")).toBe(true);
    });

    it("retrieves from short-term memory", () => {
      writeShortTermMemory("User prefers dark mode", { sessionId: "s1", importance: 0.8 });
      const result = retrieveMemory("s1", "dark mode");
      expect(result.sources).toContain("short_term");
    });

    it("ranks by importance", () => {
      setWorkingMemory("s1", "high", "important", 0.95);
      setWorkingMemory("s1", "low", "less important", 0.2);
      const result = retrieveMemory("s1", "important");
      expect(result.results[0].importance).toBeGreaterThan(result.results[result.results.length - 1].importance);
    });
  });

  describe("maintenance", () => {
    it("runs without error", () => {
      const result = runMemoryMaintenance();
      expect(typeof result.promoted).toBe("number");
      expect(typeof result.pruned).toBe("number");
      expect(typeof result.workingCleared).toBe("number");
    });
  });
});
