import "../../../skills/evolution-core/init.ts";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  initApprovalTables,
} from "../../../skills/approval/index.ts";
import {
  initEvolutionVersionTables,
} from "../../../skills/evolution-version-manager/index.ts";
import {
  initTestRunTables,
} from "../../../skills/incremental-test/index.ts";
import {
  initSafetyControlTables,
  changeFreezePeriod,
} from "../../../skills/safety-controls/index.ts";
import {
  proposeEvolution,
  executeEvolution,
  resolveAndExecute,
} from "../../../skills/evolution-orchestrator/index.ts";

describe("Evolution Orchestrator", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initApprovalTables(db);
    initEvolutionVersionTables(db);
    initTestRunTables(db);
    initSafetyControlTables(db);
    db.exec("DELETE FROM evolution_approvals;");
    db.exec("DELETE FROM evolution_versions;");
    db.exec("DELETE FROM test_runs;");
    db.exec("DELETE FROM daily_spending;");
    db.exec("DELETE FROM monthly_spending;");
    changeFreezePeriod.reset();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("auto-approves low-risk evolution", () => {
    const result = proposeEvolution(
      {
        filesChanged: ["skills/greet/index.ts"],
        description: "Safe update",
        linesAdded: 5,
        linesRemoved: 0,
      },
      "test-owner"
    );
    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
    expect(result.versionId).toBeDefined();
    expect(result.approvalId).toBeDefined();
    expect(result.riskScore).toBeDefined();
  });

  it("blocks evolution of protected paths", () => {
    const result = proposeEvolution(
      {
        filesChanged: ["core/rule-engine.ts"],
        description: "Bad idea",
        linesAdded: 1,
        linesRemoved: 0,
      },
      "test-owner"
    );
    expect(result.success).toBe(false);
    expect(result.stage).toBe("constitution");
    expect(result.violations).toBeDefined();
    expect(result.violations!.length).toBeGreaterThan(0);
  });

  it("auto-approves medium-risk evolution when consensus approves", () => {
    // 12 files triggers MEDIUM "too many files" violation (riskScore = 20)
    // But consensus from testing/cost/security reviewers approves, lowering risk
    const result = proposeEvolution(
      {
        filesChanged: Array.from({ length: 12 }, (_, i) => `skills/mod${i}/index.ts`),
        description: "Big refactor",
        linesAdded: 100,
        linesRemoved: 50,
      },
      "test-owner"
    );
    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
    expect(result.versionId).toBeDefined();
    expect(result.consensus).toBeDefined();
    expect(result.consensus!.recommendation).toBe("approve");
  });

  it("executes approved evolution and runs tests", async () => {
    const proposal = proposeEvolution(
      {
        filesChanged: ["skills/greet/index.ts"],
        description: "Safe update",
        linesAdded: 5,
        linesRemoved: 0,
      },
      "test-owner"
    );
    expect(proposal.success).toBe(true);

    const exec = await executeEvolution(proposal.versionId!, ["skills/greet/index.ts"], "test-owner");
    expect(exec.success).toBe(true);
    expect(exec.stage).toBe("test");
    expect(exec.testRunId).toBeDefined();
  });

  it("resolves approval and executes", async () => {
    const proposal = proposeEvolution(
      {
        filesChanged: Array.from({ length: 12 }, (_, i) => `skills/mod${i}/index.ts`),
        description: "Medium risk",
        linesAdded: 100,
        linesRemoved: 50,
      },
      "test-owner",
      { skipConsensus: true }
    );
    expect(proposal.success).toBe(true);
    expect(proposal.stage).toBe("pending");

    const result = await resolveAndExecute(
      proposal.approvalId!,
      proposal.versionId!,
      ["skills/mod0/index.ts"],
      "test-owner",
      true
    );
    expect(result.success).toBe(true);
    expect(result.stage).toBe("test");
  });

  it("rejects denied approval without executing", async () => {
    const proposal = proposeEvolution(
      {
        filesChanged: Array.from({ length: 12 }, (_, i) => `skills/mod${i}/index.ts`),
        description: "Medium risk",
        linesAdded: 100,
        linesRemoved: 50,
      },
      "test-owner",
      { skipConsensus: true }
    );
    expect(proposal.success).toBe(true);

    const result = await resolveAndExecute(
      proposal.approvalId!,
      proposal.versionId!,
      ["skills/mod0/index.ts"],
      "test-owner",
      false
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("denied");
  });
});
