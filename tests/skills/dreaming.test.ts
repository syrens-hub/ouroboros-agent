import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDreamingMemory } from "../../skills/dreaming/index.ts";
import { resetDbSingleton, getDb } from "../../core/db-manager.ts";

describe("DreamingMemory", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec("DELETE FROM dreaming_entries;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("starts disabled by default", () => {
    const dm = createDreamingMemory("s1");
    const status = dm.getStatus();
    expect(status.enabled).toBe(false);
  });

  it("adds memory entries after enabled", () => {
    const dm = createDreamingMemory("s1");
    dm.enable();
    const id = dm.addMemoryEntry("User likes coffee", "morning chat", "preference");
    expect(id).not.toBe("");
    const status = dm.getStatus();
    expect(status.lightPhaseEntries).toBe(1);
  });

  it("deduplicates similar entries", () => {
    const dm = createDreamingMemory("s1");
    dm.enable();
    dm.addMemoryEntry("User likes coffee", "chat", "preference");
    const dup = dm.addMemoryEntry("User likes coffee", "chat2", "preference");
    expect(dup).toBe("");
  });

  it("runs consolidation and promotes entries", async () => {
    const dm = createDreamingMemory("s1", { enabled: true, deepPhase: { promotionThreshold: 0.1, weights: { relevance: 0.3, frequency: 0.24, queryDiversity: 0.15, recency: 0.15, consolidation: 0.1, conceptualRichness: 0.06 } } });
    for (let i = 0; i < 5; i++) {
      dm.addMemoryEntry(`machine learning is fascinating`, "machine learning chat", "fact");
    }
    dm.runConsolidation();
    const promoted = dm.getPromotedMemories();
    expect(promoted.length).toBeGreaterThan(0);
  });

  it("resets status correctly", async () => {
    const dm = createDreamingMemory("s1", { enabled: true });
    dm.addMemoryEntry("Test", "chat", "fact");
    await dm.runConsolidation();
    dm.reset();
    const status = dm.getStatus();
    expect(status.lightPhaseEntries).toBe(0);
    expect(status.promotedEntries).toBe(0);
  });
});
