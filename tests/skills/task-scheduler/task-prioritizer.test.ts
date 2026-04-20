import { describe, it, expect } from "vitest";
import { TaskPrioritizer } from "../../../skills/task-scheduler/task-prioritizer.ts";
import type { Task } from "../../../skills/task-scheduler/task-scheduler-types.ts";

describe("TaskPrioritizer", () => {
  function makeTask(id: string, status: Task["status"] = "pending", type: Task["type"] = "delayed", deps?: string[]): Task {
    return {
      id,
      name: id,
      type,
      status,
      createdAt: Date.now(),
      runCount: 0,
      errorCount: 0,
      options: { dependencies: deps },
    };
  }

  it("getRunningTasks filters running", () => {
    const tasks = new Map<string, Task>();
    tasks.set("t1", makeTask("t1", "running"));
    tasks.set("t2", makeTask("t2", "pending"));
    const tp = new TaskPrioritizer(tasks);
    tp.markRunning("t1");
    expect(tp.getRunningTasks()).toHaveLength(1);
    expect(tp.getRunningTasks()[0].id).toBe("t1");
  });

  it("getAllTasks returns all tasks", () => {
    const tasks = new Map<string, Task>();
    tasks.set("t1", makeTask("t1"));
    tasks.set("t2", makeTask("t2"));
    const tp = new TaskPrioritizer(tasks);
    expect(tp.getAllTasks()).toHaveLength(2);
  });

  it("getRunningTasks handles missing tasks gracefully", () => {
    const tasks = new Map<string, Task>();
    const tp = new TaskPrioritizer(tasks);
    tp["runningTasks"].add("missing");
    expect(tp.getRunningTasks()).toHaveLength(0);
  });

  it("getRunningCount returns size", () => {
    const tasks = new Map<string, Task>();
    const tp = new TaskPrioritizer(tasks);
    tp.markRunning("t1");
    expect(tp.getRunningCount()).toBe(1);
  });

  it("getRunningTaskIds returns ids", () => {
    const tasks = new Map<string, Task>();
    const tp = new TaskPrioritizer(tasks);
    tp.markRunning("t1");
    expect(tp.getRunningTaskIds()).toEqual(["t1"]);
  });
});
