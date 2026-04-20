import { describe, it, expect } from "vitest";
import {
  generateTaskId,
  createBaseTask,
  updateNextRunTime,
  taskToPersistedTask,
  parseOptions,
  restoreTask,
} from "../../../skills/task-scheduler/task-scheduler-internal.ts";

describe("task-scheduler-internal", () => {
  it("generateTaskId returns unique string", () => {
    const id1 = generateTaskId("test");
    const id2 = generateTaskId("test");
    expect(id1).toContain("test-");
    expect(id1).not.toBe(id2);
  });

  it("createBaseTask sets defaults", () => {
    const task = createBaseTask("id-1", "my-task", "delayed", { delay: 1000 } as any);
    expect(task.id).toBe("id-1");
    expect(task.name).toBe("my-task");
    expect(task.status).toBe("pending");
    expect(task.runCount).toBe(0);
  });

  it("createBaseTask uses id as name fallback", () => {
    const task = createBaseTask("id-1", undefined, "delayed", {});
    expect(task.name).toBe("id-1");
  });

  it("updateNextRunTime sets interval", () => {
    const task = createBaseTask("id", "name", "interval", { interval: 5000 } as any);
    updateNextRunTime(task);
    expect(task.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("updateNextRunTime sets cron", () => {
    const task = createBaseTask("id", "name", "cron", { cron: "* * * * *" } as any);
    updateNextRunTime(task);
    expect(task.nextRunAt).toBeDefined();
  });

  it("taskToPersistedTask serializes options", () => {
    const task = createBaseTask("id", "name", "delayed", { delay: 1000 } as any);
    const persisted = taskToPersistedTask(task);
    expect(persisted.options).toBe(JSON.stringify({ delay: 1000 }));
  });

  it("parseOptions returns object for valid JSON", () => {
    expect(parseOptions('{"delay":1000}')).toEqual({ delay: 1000 });
  });

  it("parseOptions returns empty object for invalid JSON", () => {
    expect(parseOptions("not-json")).toEqual({});
  });

  it("restoreTask round-trips persisted task", () => {
    const task = createBaseTask("id", "name", "delayed", { delay: 1000 } as any);
    task.status = "completed";
    task.runCount = 3;
    task.errorCount = 1;
    task.lastError = "oops";
    task.lastRunAt = 12345;
    task.nextRunAt = 67890;
    const persisted = taskToPersistedTask(task);
    const restored = restoreTask(persisted);
    expect(restored.id).toBe("id");
    expect(restored.status).toBe("completed");
    expect(restored.runCount).toBe(3);
    expect(restored.errorCount).toBe(1);
    expect(restored.lastError).toBe("oops");
    expect(restored.lastRunAt).toBe(12345);
    expect(restored.nextRunAt).toBe(67890);
    expect(restored.options).toEqual({ delay: 1000 });
  });
});
