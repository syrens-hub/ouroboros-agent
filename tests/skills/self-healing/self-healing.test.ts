import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AnomalyClassifier,
  SnapshotManager,
  RollbackManager,
  createSelfHealer,
} from "../../../skills/self-healing/index.ts";
import { resetDbSingleton, getDb } from "../../../core/db-manager.ts";
import type { BaseMessage } from "../../../types/index.ts";

describe("AnomalyClassifier", () => {
  const classifier = new AnomalyClassifier();

  it("classifies tool_execution errors", () => {
    const info = classifier.classify(new Error("Tool execution failed"));
    expect(info.category).toBe("tool_execution");
    expect(info.severity).toBe("medium");
    expect(info.recoverable).toBe(true);
  });

  it("classifies model_call errors", () => {
    const info = classifier.classify(new Error("Rate limit exceeded"));
    expect(info.category).toBe("model_call");
    expect(info.severity).toBe("high");
  });

  it("classifies memory_failure as non-recoverable", () => {
    const info = classifier.classify(new Error("Out of memory"));
    expect(info.category).toBe("memory_failure");
    expect(info.severity).toBe("critical");
    expect(classifier.isRecoverable(info)).toBe(false);
  });

  it("classifies unknown errors with medium severity", () => {
    const info = classifier.classify(new Error("Something weird happened"));
    expect(info.category).toBe("unknown");
    expect(info.severity).toBe("medium");
  });
});

describe("SnapshotManager", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec(`DELETE FROM snapshots;`);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("creates and retrieves snapshots", () => {
    const manager = new SnapshotManager();
    const messages: BaseMessage[] = [{ role: "user", content: "hello" }];
    const snapshot = manager.createSnapshot({
      sessionId: "s1",
      messages,
      memoryState: {},
      toolStates: {},
      config: {},
    });

    expect(snapshot.id).toBeDefined();
    expect(snapshot.sessionId).toBe("s1");

    const retrieved = manager.getSnapshot(snapshot.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.messages).toEqual(messages);
  });

  it("returns latest snapshot for a session", async () => {
    const manager = new SnapshotManager();
    const first = manager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    await new Promise((r) => setTimeout(r, 10));
    const latest = manager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });

    const retrieved = manager.getLatestSnapshot("s1");
    expect(retrieved?.id).toBe(latest.id);
    expect(retrieved?.timestamp).toBeGreaterThanOrEqual(first.timestamp);
  });

  it("evicts old snapshots beyond max", () => {
    const manager = new SnapshotManager(2);
    const s1 = manager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    const s2 = manager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    const s3 = manager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });

    expect(manager.getSnapshot(s1.id)).toBeUndefined();
    expect(manager.getSnapshot(s2.id)).toBeDefined();
    expect(manager.getSnapshot(s3.id)).toBeDefined();
  });
});

describe("RollbackManager", () => {
  it("performs rollback to snapshot", async () => {
    const snapshotManager = new SnapshotManager();
    const snapshot = snapshotManager.createSnapshot({
      sessionId: "s1",
      messages: [],
      memoryState: {},
      toolStates: {},
      config: {},
    });

    const rollbackManager = new RollbackManager(snapshotManager);
    const point = rollbackManager.createRollbackPoint({
      snapshotId: snapshot.id,
      description: "test rollback",
    });

    const result = await rollbackManager.performRollback(point.id);
    expect(result.success).toBe(true);
    expect(result.snapshot?.id).toBe(snapshot.id);
  });

  it("chains parent rollbacks", async () => {
    const snapshotManager = new SnapshotManager();
    const s1 = snapshotManager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    const s2 = snapshotManager.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });

    const rollbackManager = new RollbackManager(snapshotManager);
    const parent = rollbackManager.createRollbackPoint({ snapshotId: s1.id, description: "parent" });
    const child = rollbackManager.createRollbackPoint({ snapshotId: s2.id, description: "child", parentId: parent.id });

    const chain = rollbackManager.getRollbackChain(child.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(parent.id);
    expect(chain[1].id).toBe(child.id);
  });
});

describe("SelfHealer", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    db.exec(`DELETE FROM snapshots; DELETE FROM rollback_points; DELETE FROM repair_history;`);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("diagnoses errors", () => {
    const healer = createSelfHealer();
    const info = healer.diagnose(new Error("operation timed out"));
    expect(info.category).toBe("timeout");
  });

  it("attempts repair with tool_retry strategy", async () => {
    const healer = createSelfHealer();
    const snapshot = healer.createSnapshot({
      sessionId: "s1",
      messages: [],
      memoryState: {},
      toolStates: {},
      config: {},
    });

    const result = await healer.attemptRepair({
      error: new Error("tool execution failed"),
      currentSnapshot: snapshot,
    });

    expect(result.success).toBe(true);
    expect(result.errorCategory).toBe("tool_execution");
    expect(result.rollbackPerformed).toBe(false);
  });

  it("performs rollback when failure threshold exceeded", async () => {
    const healer = createSelfHealer({ rollbackThreshold: 2, enableAutoRollback: true });
    healer.registerStrategy({
      name: "tool_retry",
      applicableCategories: ["tool_execution"],
      execute: async () => ({
        success: false,
        errorCategory: "tool_execution",
        attempts: 1,
        rollbackPerformed: false,
      }),
    });

    healer.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    await new Promise((r) => setTimeout(r, 10));
    const s2 = healer.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });

    // First failure (maxRepairAttempts=3, all fail, then failureCount=1)
    await healer.attemptRepair({ error: new Error("tool execution failed"), currentSnapshot: s2 });
    // Second attempt reaches threshold=2, triggers rollback
    const result = await healer.attemptRepair({ error: new Error("tool execution failed"), currentSnapshot: s2 });


    expect(result.rollbackPerformed).toBe(true);
    expect(result.success).toBe(true);
  });

  it("does not rollback non-recoverable errors", async () => {
    const healer = createSelfHealer();
    const snapshot = healer.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });

    const result = await healer.attemptRepair({
      error: new Error("out of memory"),
      currentSnapshot: snapshot,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
  });

  it("tracks repair history", async () => {
    const healer = createSelfHealer();
    const snapshot = healer.createSnapshot({ sessionId: "s1", messages: [], memoryState: {}, toolStates: {}, config: {} });
    await healer.attemptRepair({ error: new Error("timeout"), currentSnapshot: snapshot });

    const history = healer.getRepairHistory();
    expect(history.length).toBe(1);
    expect(history[0].result.errorCategory).toBe("timeout");
  });
});
