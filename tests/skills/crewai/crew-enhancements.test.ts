import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  initCrewHistoryTables,
  recordCrewRun,
  recordCrewTask,
  getCrewRunHistory,
  getCrewRunTasks,
  getCrewRunMetrics,
  runConsensus,
  createHandoff,
  applyHandoff,
  serializeHandoff,
  deserializeHandoff,
} from "../../../skills/crewai/index.ts";

describe("CrewAI Enhancements", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initCrewHistoryTables(db);
    db.exec("DELETE FROM crew_runs;");
    db.exec("DELETE FROM crew_run_tasks;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("Crew History", () => {
    it("records and retrieves crew runs", () => {
      const run = recordCrewRun({
        crewName: "research-crew",
        process: "sequential",
        context: "Analyze market trends",
        finalOutput: "Market is bullish",
        taskCount: 3,
        durationMs: 5000,
      });
      expect(run.id).toBeDefined();

      const history = getCrewRunHistory();
      expect(history).toHaveLength(1);
      expect(history[0].crewName).toBe("research-crew");
      expect(history[0].taskCount).toBe(3);
    });

    it("records and retrieves crew tasks", () => {
      const run = recordCrewRun({
        crewName: "test-crew",
        process: "parallel",
        context: "test",
        finalOutput: "done",
        taskCount: 2,
        durationMs: 1000,
      });

      recordCrewTask({
        crewRunId: run.id,
        taskId: "t1",
        agentRole: "researcher",
        description: "Research",
        result: "Found data",
      });
      recordCrewTask({
        crewRunId: run.id,
        taskId: "t2",
        agentRole: "writer",
        description: "Write",
        result: "Wrote article",
      });

      const tasks = getCrewRunTasks(run.id);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].agentRole).toBe("researcher");
      expect(tasks[1].result).toBe("Wrote article");
    });

    it("computes aggregate metrics", () => {
      recordCrewRun({
        crewName: "a", process: "sequential", context: "", finalOutput: "", taskCount: 2, durationMs: 1000,
      });
      recordCrewRun({
        crewName: "b", process: "parallel", context: "", finalOutput: "", taskCount: 4, durationMs: 3000,
      });

      const metrics = getCrewRunMetrics();
      expect(metrics.totalRuns).toBe(2);
      expect(metrics.avgDurationMs).toBe(2000);
      expect(metrics.avgTasksPerRun).toBe(3);
    });

    it("returns empty metrics when no runs", () => {
      const metrics = getCrewRunMetrics();
      expect(metrics.totalRuns).toBe(0);
      expect(metrics.avgDurationMs).toBe(0);
    });
  });

  describe("Consensus Engine", () => {
    it("returns winner for unanimous answers", () => {
      const result = runConsensus([
        { agentId: "a1", answer: "Python is the best language", confidence: 0.9 },
        { agentId: "a2", answer: "Python is the best language", confidence: 0.8 },
      ]);
      expect(result).toBeDefined();
      expect(result!.winner).toBe("Python is the best language");
      expect(result!.clusterSize).toBe(2);
      expect(result!.agreementRatio).toBe(100);
    });

    it("selects majority cluster", () => {
      const result = runConsensus([
        { agentId: "a1", answer: "Use SQLite for local storage" },
        { agentId: "a2", answer: "Use SQLite for local storage" },
        { agentId: "a3", answer: "Use PostgreSQL for production" },
      ]);
      expect(result).toBeDefined();
      expect(result!.winner).toBe("Use SQLite for local storage");
      expect(result!.clusterSize).toBe(2);
      expect(result!.runnerUps).toContain("Use PostgreSQL for production");
    });

    it("uses confidence to break ties", () => {
      const result = runConsensus([
        { agentId: "a1", answer: "Option A", confidence: 0.3 },
        { agentId: "a2", answer: "Option B", confidence: 0.9 },
      ]);
      expect(result).toBeDefined();
      expect(result!.winner).toBe("Option B");
    });

    it("returns undefined for empty input", () => {
      expect(runConsensus([])).toBeUndefined();
    });

    it("handles single answer", () => {
      const result = runConsensus([{ agentId: "a1", answer: "Only me" }]);
      expect(result!.winner).toBe("Only me");
      expect(result!.agreementRatio).toBe(100);
    });
  });

  describe("Handoff Protocol", () => {
    it("creates and serializes handoff context", () => {
      const handoff = createHandoff({
        fromAgent: "researcher",
        toAgent: "writer",
        taskId: "t1",
        summary: "Research complete",
        keyFindings: ["Finding A", "Finding B"],
        openQuestions: ["Q1"],
        constraints: ["Budget < $1000"],
        artifacts: [{ name: "data.csv", content: "a,b,c\n1,2,3" }],
      });

      expect(handoff.fromAgent).toBe("researcher");
      expect(handoff.keyFindings).toHaveLength(2);
      expect(handoff.timestamp).toBeGreaterThan(0);

      const serialized = serializeHandoff(handoff);
      const deserialized = deserializeHandoff(serialized);
      expect(deserialized).toBeDefined();
      expect(deserialized!.summary).toBe("Research complete");
      expect(deserialized!.artifacts[0].name).toBe("data.csv");
    });

    it("returns undefined for invalid serialized handoff", () => {
      expect(deserializeHandoff("not json")).toBeUndefined();
      expect(deserializeHandoff("{}")).toBeUndefined();
    });

    it("applies handoff to next task description", () => {
      const handoff = createHandoff({
        fromAgent: "planner",
        toAgent: "executor",
        taskId: "t2",
        summary: "Plan approved",
        keyFindings: ["Use React"],
        constraints: ["No external deps"],
      });

      const prompt = applyHandoff(handoff, "Implement the login page");
      expect(prompt).toContain("Context Handoff from planner → executor");
      expect(prompt).toContain("Plan approved");
      expect(prompt).toContain("Use React");
      expect(prompt).toContain("No external deps");
      expect(prompt).toContain("Implement the login page");
    });
  });
});
