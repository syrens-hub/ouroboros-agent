import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, resetDbSingleton } from "../../../core/db-manager.ts";
import {
  HybridApprovalGenerator,
  initApprovalTables,
  type ApprovalRequest,
  type SafetyStatus,
} from "../../../skills/approval/index.ts";

describe("Hybrid Approval Generator", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initApprovalTables(db);
    db.exec("DELETE FROM evolution_approvals;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("auto-approves low risk", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      description: "Safe greeting update",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("auto");
    expect(result.approvalId).toBeTruthy();

    const record = gen.getApproval(result.approvalId);
    expect(record).toBeDefined();
    expect(record!.status).toBe("approved");
    expect(record!.resolvedAt).toBeDefined();
  });

  it("delays medium risk", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 30,
      description: "Medium risk update",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("delayed");
    expect(result.delayMs).toBe(5 * 60 * 1000);

    const record = gen.getApproval(result.approvalId);
    expect(record!.status).toBe("pending");
  });

  it("requires manual approval for high risk", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["core/config.ts"],
      riskScore: 60,
      description: "High risk update",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("manual");
  });

  it("denies critical risk", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["core/rule-engine.ts"],
      riskScore: 120,
      description: "Critical update",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("denied");
  });

  it("denies when budget exhausted", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      description: "Safe update",
    };
    const safety: SafetyStatus = { frozen: false, budgetExhausted: true, locked: false };
    const result = gen.generateApproval(req, safety);
    expect(result.decision).toBe("denied");
    expect(result.reason).toContain("Budget");
  });

  it("requires manual when frozen", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      description: "Safe update",
    };
    const safety: SafetyStatus = { frozen: true, budgetExhausted: false, locked: false };
    const result = gen.generateApproval(req, safety);
    expect(result.decision).toBe("manual");
    expect(result.reason).toContain("freeze");
  });

  it("requires manual when locked", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      description: "Safe update",
    };
    const safety: SafetyStatus = { frozen: false, budgetExhausted: false, locked: true };
    const result = gen.generateApproval(req, safety);
    expect(result.decision).toBe("manual");
    expect(result.reason).toContain("lock");
  });

  it("resolves a pending approval as approved", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 60,
      description: "High risk",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("manual");

    const ok = gen.resolveApproval(result.approvalId, true);
    expect(ok).toBe(true);

    const record = gen.getApproval(result.approvalId);
    expect(record!.status).toBe("approved");
    expect(record!.resolvedAt).toBeDefined();
  });

  it("resolves a pending approval as denied", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 60,
      description: "High risk",
    };
    const result = gen.generateApproval(req);

    const ok = gen.resolveApproval(result.approvalId, false);
    expect(ok).toBe(true);

    const record = gen.getApproval(result.approvalId);
    expect(record!.status).toBe("denied");
  });

  it("does not resolve already resolved approvals", () => {
    const gen = new HybridApprovalGenerator();
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 10,
      description: "Low risk",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("auto");

    const ok = gen.resolveApproval(result.approvalId, true);
    expect(ok).toBe(false);
  });

  it("detects expired delays", () => {
    const gen = new HybridApprovalGenerator({ defaultDelayMs: 10 });
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 30,
      description: "Medium risk",
    };
    const result = gen.generateApproval(req);
    expect(result.decision).toBe("delayed");

    expect(gen.isDelayExpired(result.approvalId)).toBe(false);

    // Wait for delay to pass
    const start = Date.now();
    while (Date.now() - start < 20) {
      /* busy wait */
    }
    expect(gen.isDelayExpired(result.approvalId)).toBe(true);
  });

  it("processes expired delays in batch", () => {
    const gen = new HybridApprovalGenerator({ defaultDelayMs: 1 });
    const req: ApprovalRequest = {
      filesChanged: ["skills/greet/index.ts"],
      riskScore: 30,
      description: "Medium risk",
    };
    gen.generateApproval(req);

    const start = Date.now();
    while (Date.now() - start < 10) {
      /* busy wait */
    }

    const processed = gen.processExpiredDelays();
    expect(processed).toBe(1);

    const pending = gen.listApprovals("pending");
    expect(pending.length).toBe(0);
  });

  it("lists approvals with status filter", () => {
    const gen = new HybridApprovalGenerator();
    gen.generateApproval({ filesChanged: ["a.ts"], riskScore: 10, description: "low" });
    gen.generateApproval({ filesChanged: ["b.ts"], riskScore: 60, description: "high" });

    expect(gen.listApprovals("approved").length).toBe(1);
    expect(gen.listApprovals("pending").length).toBe(1);
    expect(gen.listApprovals().length).toBe(2);
  });
});
