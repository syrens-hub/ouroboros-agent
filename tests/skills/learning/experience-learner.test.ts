import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { ExperienceLearner } from "../../../skills/learning/experience-learner.ts";

describe("ExperienceLearner", () => {
  let learner: ExperienceLearner;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(process.cwd(), ".ouroboros", `test-experience-${Date.now()}`, "experiences.db");
    learner = new ExperienceLearner(dbPath);
  });

  afterEach(() => {
    learner.close();
    const dir = join(dbPath, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("records and retrieves experiences", () => {
    const record = learner.recordExperience("sess-1", "code-review", { file: "main.ts" }, "approved");
    expect(record.sessionId).toBe("sess-1");
    expect(record.taskType).toBe("code-review");
    expect(record.outcome).toBe("approved");
    expect(record.embedding.length).toBe(256);

    const similar = learner.retrieveSimilarExperiences("sess-1", "code review main", 1);
    expect(similar.length).toBe(1);
    expect(similar[0].outcome).toBe("approved");
  });

  it("filters by sessionId", () => {
    learner.recordExperience("sess-a", "bug-fix", { issue: 1 }, "fixed");
    learner.recordExperience("sess-b", "bug-fix", { issue: 2 }, "fixed");

    const results = learner.retrieveSimilarExperiences("sess-a", "bug fix", 5);
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe("sess-a");
  });
});
