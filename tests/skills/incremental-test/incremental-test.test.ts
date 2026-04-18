import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  IncrementalTestRunner,
  mapFileToTests,
  mapFilesToTests,
  initTestRunTables,
  type TestRunRequest,
} from "../../../skills/incremental-test/index.ts";

describe("Incremental Test Runner", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initTestRunTables(db);
    db.exec("DELETE FROM test_runs;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("mapFileToTests", () => {
    it("maps core files to core tests", () => {
      expect(mapFileToTests("core/event-bus.ts")).toEqual(["tests/core/event-bus.test.ts"]);
      expect(mapFileToTests("core/db-manager.ts")).toEqual(["tests/core/db-manager.test.ts"]);
    });

    it("maps skill index to skill tests", () => {
      expect(mapFileToTests("skills/greet/index.ts")).toEqual([
        "tests/skills/greet/greet.test.ts",
        "tests/skills/greet/index.test.ts",
      ]);
    });

    it("maps skill files to skill tests", () => {
      expect(mapFileToTests("skills/greet/utils.ts")).toEqual(["tests/skills/greet/utils.test.ts"]);
    });

    it("maps web src files to web tests", () => {
      expect(mapFileToTests("web/src/components/Button.tsx")).toEqual([
        "tests/web/components/Button.test.ts",
      ]);
    });

    it("returns empty for unmapped files", () => {
      expect(mapFileToTests("docs/readme.md")).toEqual([]);
      expect(mapFileToTests("assets/logo.png")).toEqual([]);
    });
  });

  describe("mapFilesToTests", () => {
    it("deduplicates mapped tests", () => {
      const result = mapFilesToTests([
        "core/event-bus.ts",
        "core/event-bus.ts",
        "skills/greet/index.ts",
      ]);
      expect(result).toContain("tests/core/event-bus.test.ts");
      expect(result).toContain("tests/skills/greet/greet.test.ts");
      expect(result).toContain("tests/skills/greet/index.test.ts");
      expect(result.length).toBe(3);
    });
  });

  describe("run", () => {
    it("runs incremental and records result", async () => {
      const runner = new IncrementalTestRunner();
      const req: TestRunRequest = {
        changedFiles: ["core/event-bus.ts"],
        mode: "incremental",
      };
      const result = await runner.run(req);

      expect(result.mode).toBe("incremental");
      expect(result.targetTests).toEqual(["tests/core/event-bus.test.ts"]);
      expect(result.runId).toBeTruthy();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("runs full mode targeting all tests", async () => {
      const runner = new IncrementalTestRunner();
      const req: TestRunRequest = {
        changedFiles: [],
        mode: "full",
      };
      const result = await runner.run(req);

      expect(result.mode).toBe("full");
      expect(result.targetTests).toEqual(["tests/"]);
    });

    it("returns unknown status when no test mapping found", async () => {
      const runner = new IncrementalTestRunner();
      const req: TestRunRequest = {
        changedFiles: ["docs/readme.md"],
        mode: "incremental",
      };
      const result = await runner.run(req);

      expect(result.targetTests).toEqual([]);
      expect(result.status).toBe("unknown");
    });

    it("records passed/failed/skipped from executor", async () => {
      const runner = new IncrementalTestRunner();
      runner["_execute"] = vi.fn().mockResolvedValue({
        passed: 5,
        failed: 1,
        skipped: 2,
        logs: "mock output",
      });

      const req: TestRunRequest = {
        changedFiles: ["core/event-bus.ts"],
        mode: "incremental",
      };
      const result = await runner.run(req);

      expect(result.passed).toBe(5);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.status).toBe("failed");
      expect(result.logs).toBe("mock output");
    });

    it("marks status passed when no failures", async () => {
      const runner = new IncrementalTestRunner();
      runner["_execute"] = vi.fn().mockResolvedValue({
        passed: 3,
        failed: 0,
        skipped: 0,
      });

      const req: TestRunRequest = {
        changedFiles: ["core/event-bus.ts"],
        mode: "incremental",
      };
      const result = await runner.run(req);

      expect(result.status).toBe("passed");
    });

    it("retrieves a result by id", async () => {
      const runner = new IncrementalTestRunner();
      const req: TestRunRequest = {
        changedFiles: ["core/event-bus.ts"],
        mode: "incremental",
      };
      const result = await runner.run(req);

      const fetched = runner.getResult(result.runId);
      expect(fetched).toBeDefined();
      expect(fetched!.runId).toBe(result.runId);
    });

    it("returns the last result", async () => {
      const runner = new IncrementalTestRunner();
      await runner.run({ changedFiles: ["core/a.ts"], mode: "incremental" });
      await new Promise((r) => setTimeout(r, 5));
      const second = await runner.run({ changedFiles: ["core/b.ts"], mode: "incremental" });

      const last = runner.getLastResult();
      expect(last).toBeDefined();
      expect(last!.runId).toBe(second.runId);
    });

    it("lists results", async () => {
      const runner = new IncrementalTestRunner();
      await runner.run({ changedFiles: ["core/a.ts"], mode: "incremental" });
      await runner.run({ changedFiles: ["core/b.ts"], mode: "incremental" });

      const list = runner.listResults();
      expect(list.length).toBe(2);
    });
  });
});
