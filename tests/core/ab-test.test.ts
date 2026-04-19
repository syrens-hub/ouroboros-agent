import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appConfig } from "../../core/config.ts";

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), "ouroboros-ab-test-"));
appConfig.db.dir = TEST_DB_DIR;

import {
  resetDbSingleton,
} from "../../core/db-manager.ts";

import {
  DbABTestFramework,
  djb2Hash,
  type ABTestFramework,
} from "../../core/ab-test.ts";

import { checkAutoRollback } from "../../skills/self-modify/ab-integration.ts";
import { abTestingConfig } from "../../core/config-extension.ts";

describe("ABTestFramework", () => {
  let framework: ABTestFramework;

  beforeEach(() => {
    try {
      const oldDir = appConfig.db.dir;
      if (existsSync(oldDir)) rmSync(oldDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    resetDbSingleton();
    appConfig.db.dir = mkdtempSync(join(tmpdir(), "ouroboros-ab-test-"));
    framework = new DbABTestFramework();
  });

  afterEach(() => {
    try {
      const dir = appConfig.db.dir;
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates a test in draft status", () => {
    const test = framework.createTest({
      name: "Test A",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.1,
    });
    expect(test.id).toBeDefined();
    expect(test.status).toBe("draft");
    expect(test.metrics.controlRequests).toBe(0);
    expect(test.metrics.treatmentRequests).toBe(0);

    const retrieved = framework.getTest(test.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("Test A");
    expect(retrieved!.trafficSplit).toBe(0.1);
  });

  it("starts, pauses, completes and rolls back a test", () => {
    const test = framework.createTest({
      name: "Lifecycle Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.2,
    });

    framework.startTest(test.id);
    expect(framework.getTest(test.id)!.status).toBe("running");
    expect(framework.getTest(test.id)!.startedAt).toBeGreaterThan(0);

    framework.pauseTest(test.id);
    expect(framework.getTest(test.id)!.status).toBe("paused");

    framework.completeTest(test.id, "treatment");
    expect(framework.getTest(test.id)!.status).toBe("completed");
    expect(framework.getTest(test.id)!.endedAt).toBeGreaterThan(0);

    const test2 = framework.createTest({
      name: "Rollback Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.2,
    });
    framework.startTest(test2.id);
    framework.rollbackTest(test2.id);
    expect(framework.getTest(test2.id)!.status).toBe("rolled_back");
  });

  it("lists tests in descending creation order", async () => {
    const uniq = Date.now().toString(36);
    framework.createTest({ name: `First-${uniq}`, controlVersion: "v1", treatmentVersion: "v2", trafficSplit: 0.1 });
    await new Promise((r) => setTimeout(r, 10));
    framework.createTest({ name: `Second-${uniq}`, controlVersion: "v1", treatmentVersion: "v2", trafficSplit: 0.1 });
    const list = framework.listTests();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const names = list.map((t) => t.name);
    expect(names).toContain(`First-${uniq}`);
    expect(names).toContain(`Second-${uniq}`);
    // Descending order check for the two we just created
    const idxFirst = list.findIndex((t) => t.name === `First-${uniq}`);
    const idxSecond = list.findIndex((t) => t.name === `Second-${uniq}`);
    expect(idxFirst).toBeGreaterThanOrEqual(0);
    expect(idxSecond).toBeGreaterThanOrEqual(0);
    expect(idxSecond).toBeLessThan(idxFirst);
  });

  it("assigns the same variant for the same userId consistently", () => {
    const test = framework.createTest({
      name: "Consistency Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.5,
    });
    framework.startTest(test.id);

    const userId = "user-123";
    const variant1 = framework.assignVariant(test.id, userId);
    const variant2 = framework.assignVariant(test.id, userId);
    const variant3 = framework.assignVariant(test.id, userId);

    expect(variant1).toBe(variant2);
    expect(variant2).toBe(variant3);
  });

  it("splits traffic close to the configured ratio over many assignments", () => {
    const test = framework.createTest({
      name: "Split Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.3,
    });
    framework.startTest(test.id);

    let treatmentCount = 0;
    const total = 10000;
    for (let i = 0; i < total; i++) {
      const variant = framework.assignVariant(test.id, `user-${i}`);
      if (variant === "treatment") treatmentCount++;
    }

    const ratio = treatmentCount / total;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("falls back to control when test is not running", () => {
    const test = framework.createTest({
      name: "Draft Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.5,
    });
    // status is draft, not running
    const variant = framework.assignVariant(test.id, "user-abc");
    expect(variant).toBe("control");
  });

  it("falls back to control when userId is missing (random)", () => {
    const test = framework.createTest({
      name: "Random Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.5,
    });
    framework.startTest(test.id);

    const variant = framework.assignVariant(test.id);
    expect(["control", "treatment"]).toContain(variant);
  });

  it("records and aggregates metrics correctly", () => {
    const test = framework.createTest({
      name: "Metrics Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.1,
    });

    framework.recordMetric(test.id, "control", {
      controlRequests: 2,
      controlErrors: 1,
      controlLatencyMs: 100,
    });

    framework.recordMetric(test.id, "control", {
      controlRequests: 3,
      controlErrors: 0,
      controlLatencyMs: 200,
    });

    framework.recordMetric(test.id, "treatment", {
      treatmentRequests: 1,
      treatmentErrors: 0,
      treatmentLatencyMs: 150,
    });

    const updated = framework.getTest(test.id)!;
    expect(updated.metrics.controlRequests).toBe(5);
    expect(updated.metrics.controlErrors).toBe(1);
    expect(updated.metrics.treatmentRequests).toBe(1);
    expect(updated.metrics.treatmentErrors).toBe(0);
    expect(updated.metrics.treatmentLatencyMs).toBe(150);
  });

  it("returns safe fallback when framework operations fail", () => {
    // Simulate failure by passing a non-existent test id to assignVariant
    const variant = framework.assignVariant("non-existent-id", "user-x");
    expect(variant).toBe("control");
  });

  it("djb2Hash is deterministic and produces stable numbers", () => {
    const h1 = djb2Hash("hello");
    const h2 = djb2Hash("hello");
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);

    const h3 = djb2Hash("world");
    expect(h3).not.toBe(h1);
  });

  it("supports targetModule in creation", () => {
    const test = framework.createTest({
      name: "Module Test",
      controlVersion: "v1.0.0",
      treatmentVersion: "v1.1.0",
      trafficSplit: 0.05,
      targetModule: "chat-handler",
    });
    expect(test.targetModule).toBe("chat-handler");
    expect(framework.getTest(test.id)!.targetModule).toBe("chat-handler");
  });

  it("auto-rollback triggers when treatment error rate exceeds threshold", () => {
    const originalEnabled = abTestingConfig.enabled;
    abTestingConfig.enabled = true;
    try {
      const test = framework.createTest({
        name: "AutoRollback Test",
        controlVersion: "v1.0.0",
        treatmentVersion: "v1.1.0",
        trafficSplit: 0.1,
      });
      framework.startTest(test.id);

      // Control: 100 requests, 1 error (1%)
      framework.recordMetric(test.id, "control", {
        controlRequests: 100,
        controlErrors: 1,
        controlLatencyMs: 50,
      });

      // Treatment: 100 requests, 15 errors (15%)
      framework.recordMetric(test.id, "treatment", {
        treatmentRequests: 100,
        treatmentErrors: 15,
        treatmentLatencyMs: 50,
      });

      const result = checkAutoRollback(test.id, framework);
      expect(result.shouldRollback).toBe(true);
      expect(result.reason).toContain("Treatment error rate");
    } finally {
      abTestingConfig.enabled = originalEnabled;
    }
  });

  it("auto-rollback does not trigger when treatment error rate is within threshold", () => {
    const originalEnabled = abTestingConfig.enabled;
    abTestingConfig.enabled = true;
    try {
      const test = framework.createTest({
        name: "NoRollback Test",
        controlVersion: "v1.0.0",
        treatmentVersion: "v1.1.0",
        trafficSplit: 0.1,
      });
      framework.startTest(test.id);

      // Control: 100 requests, 5 errors (5%)
      framework.recordMetric(test.id, "control", {
        controlRequests: 100,
        controlErrors: 5,
        controlLatencyMs: 50,
      });

      // Treatment: 100 requests, 10 errors (10%) — diff is 5%, threshold is 10%
      framework.recordMetric(test.id, "treatment", {
        treatmentRequests: 100,
        treatmentErrors: 10,
        treatmentLatencyMs: 50,
      });

      const result = checkAutoRollback(test.id, framework);
      expect(result.shouldRollback).toBe(false);
    } finally {
      abTestingConfig.enabled = originalEnabled;
    }
  });
});
